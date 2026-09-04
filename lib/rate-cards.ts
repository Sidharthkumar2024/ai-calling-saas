/**
 * Versioned provider rate cards (§13), and the model registry they carry (§34).
 *
 * Two problems this solves.
 *
 * **Nothing knew what anything cost.** `recordUsage` wrote
 * `units = 1, provider_cost_micros = 0, billed_credits = 0` on every provider
 * call, so the admin panel titled "Provider cost and margin" summed columns
 * that were structurally always zero. Metering existed as a table name.
 *
 * **Model ids were string literals in code** — `'claude-sonnet-5'` in
 * `lib/llm-router.ts`, `'gpt-5.4-mini'` in `lib/provider-adapters.ts`. §34 asks
 * for a registry the operator manages; a rate card row *is* that registry
 * entry, because the thing you want to configure per model and the thing you
 * want to price per model are the same thing.
 *
 * Rate cards are **versioned by effective date**, never edited in place. A call
 * made last month must still price at last month's rate, or the margin history
 * rewrites itself every time a provider changes its pricing.
 *
 * Pure: selection and arithmetic only.
 */

export type UsageUnit =
  | 'input_tokens'
  | 'cached_input_tokens'
  | 'output_tokens'
  | 'characters'
  | 'seconds'
  | 'minutes'
  | 'messages'
  | 'gb_month'
  | 'requests';

/** How many of a unit make up the quantity a price is quoted against. */
const UNIT_BATCH: Record<UsageUnit, number> = {
  input_tokens: 1_000_000,
  cached_input_tokens: 1_000_000,
  output_tokens: 1_000_000,
  characters: 1_000,
  seconds: 3_600,
  minutes: 1,
  messages: 1,
  gb_month: 1,
  requests: 1_000,
};

export const USAGE_UNITS = Object.keys(UNIT_BATCH) as UsageUnit[];

export function isUsageUnit(value: unknown): value is UsageUnit {
  return typeof value === 'string' && value in UNIT_BATCH;
}

export type RateCard = {
  id?: string;
  provider: string;
  /** null for a provider-wide rate such as telephony minutes. */
  model: string | null;
  category:
    | 'llm'
    | 'stt'
    | 'tts'
    | 'telephony'
    | 'messaging'
    | 'storage'
    | 'payments';
  unit: UsageUnit;
  /**
   * Price in micros of `currency` for one *batch* of the unit — per million
   * tokens, per thousand characters, per hour of audio. Micros because a
   * millionth of a rupee still matters when multiplied by a million tokens.
   */
  priceMicros: number;
  currency: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  /** Where the figure came from, so nobody mistakes a reference for a quote. */
  source?: string | null;
  version?: number;
};

export type RateSelection = { field: string; at?: string };

/**
 * The card in force for a provider/model/unit at a moment in time.
 *
 * Falls back from an exact model match to the provider-wide card, because a
 * new model on a known provider should price at something rather than nothing —
 * but never falls back across providers, which would price one vendor at
 * another's rates.
 */
export function selectRate(
  cards: RateCard[],
  query: {
    provider: string;
    model?: string | null;
    unit: UsageUnit;
    at?: Date;
  },
): RateCard | null {
  const at = (query.at ?? new Date()).toISOString();
  const eligible = (cards ?? []).filter(
    (card) =>
      card.provider === query.provider &&
      card.unit === query.unit &&
      card.effectiveFrom <= at &&
      (!card.effectiveTo || card.effectiveTo > at),
  );
  if (!eligible.length) return null;
  const exact = eligible.filter(
    (card) => card.model && card.model === query.model,
  );
  const wide = eligible.filter((card) => !card.model);
  const pool = exact.length ? exact : wide;
  if (!pool.length) return null;
  // Latest effective date wins, so a mid-month price change takes effect
  // without deleting the card it replaces.
  return pool.reduce((best, card) =>
    card.effectiveFrom > best.effectiveFrom ? card : best,
  );
}

export type PricedUsage = {
  costMicros: number;
  currency: string;
  rateCardId: string | null;
  /** True when no card matched, so the caller can record zero *and say so*. */
  unpriced: boolean;
};

/**
 * Prices a quantity of usage.
 *
 * When no card matches, the cost is zero *and* `unpriced` is true. That
 * distinction is the whole point: a zero that means "free" and a zero that
 * means "we do not know" look identical in a sum, and the old metering could
 * only produce the second kind.
 */
export function priceUsage(card: RateCard | null, units: number): PricedUsage {
  if (!card || !Number.isFinite(units) || units < 0)
    return { costMicros: 0, currency: 'INR', rateCardId: null, unpriced: true };
  const batch = UNIT_BATCH[card.unit] ?? 1;
  return {
    costMicros: Math.round((units / batch) * card.priceMicros),
    currency: card.currency,
    rateCardId: card.id ?? null,
    unpriced: false,
  };
}

const USD = (dollars: number) => Math.round(dollars * 1_000_000);
const INR = (rupees: number) => Math.round(rupees * 1_000_000);
const FROM = '2026-09-01T00:00:00.000Z';

/**
 * Seed rate cards, from the September 2026 figures in the architecture
 * document (§13).
 *
 * `source` says exactly that. These are **published reference prices, not a
 * negotiated quote and not a live feed** — a workspace on a committed-spend
 * contract pays something else. They are seeded so the cost engine has
 * somewhere to start and are editable by a platform admin, which is what §13
 * means by "store editable versioned rate cards".
 */
const REFERENCE =
  'AI_Calling_OS FINAL Master Architecture §13, Sept 2026 reference';
const TELEPHONY_REFERENCE =
  'AI_Calling_OS FINAL Master Architecture §15, Twilio India public reference';

export const SEED_RATE_CARDS: RateCard[] = [
  // Reasoning. Model ids are the operator's to correct: the document names
  // them, this repository has not verified them against a live API.
  {
    provider: 'openai',
    model: 'gpt-5.6-luna',
    category: 'llm',
    unit: 'input_tokens',
    priceMicros: USD(0.2),
    currency: 'USD',
    effectiveFrom: FROM,
    source: REFERENCE,
  },
  {
    provider: 'openai',
    model: 'gpt-5.6-luna',
    category: 'llm',
    unit: 'output_tokens',
    priceMicros: USD(1.2),
    currency: 'USD',
    effectiveFrom: FROM,
    source: REFERENCE,
  },
  {
    provider: 'openai',
    model: 'gpt-5.6-terra',
    category: 'llm',
    unit: 'input_tokens',
    priceMicros: USD(2),
    currency: 'USD',
    effectiveFrom: FROM,
    source: REFERENCE,
  },
  {
    provider: 'openai',
    model: 'gpt-5.6-terra',
    category: 'llm',
    unit: 'output_tokens',
    priceMicros: USD(12),
    currency: 'USD',
    effectiveFrom: FROM,
    source: REFERENCE,
  },
  {
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    category: 'llm',
    unit: 'input_tokens',
    priceMicros: USD(1),
    currency: 'USD',
    effectiveFrom: FROM,
    source: REFERENCE,
  },
  {
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    category: 'llm',
    unit: 'output_tokens',
    priceMicros: USD(5),
    currency: 'USD',
    effectiveFrom: FROM,
    source: REFERENCE,
  },
  {
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    category: 'llm',
    unit: 'input_tokens',
    priceMicros: USD(2),
    currency: 'USD',
    effectiveFrom: FROM,
    source: REFERENCE,
  },
  {
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    category: 'llm',
    unit: 'output_tokens',
    priceMicros: USD(10),
    currency: 'USD',
    effectiveFrom: FROM,
    source: REFERENCE,
  },
  {
    provider: 'sarvam',
    model: 'sarvam-105b',
    category: 'llm',
    unit: 'input_tokens',
    priceMicros: INR(29.28),
    currency: 'INR',
    effectiveFrom: FROM,
    source: REFERENCE,
  },
  {
    provider: 'sarvam',
    model: 'sarvam-105b',
    category: 'llm',
    unit: 'cached_input_tokens',
    priceMicros: INR(10.98),
    currency: 'INR',
    effectiveFrom: FROM,
    source: REFERENCE,
  },
  {
    provider: 'sarvam',
    model: 'sarvam-105b',
    category: 'llm',
    unit: 'output_tokens',
    priceMicros: INR(73.2),
    currency: 'INR',
    effectiveFrom: FROM,
    source: REFERENCE,
  },

  // Speech in.
  {
    provider: 'sarvam',
    model: null,
    category: 'stt',
    unit: 'seconds',
    priceMicros: INR(30),
    currency: 'INR',
    effectiveFrom: FROM,
    source: REFERENCE,
  },
  {
    provider: 'elevenlabs',
    model: 'scribe-realtime',
    category: 'stt',
    unit: 'seconds',
    priceMicros: USD(0.39),
    currency: 'USD',
    effectiveFrom: FROM,
    source: REFERENCE,
  },

  // Speech out.
  {
    provider: 'sarvam',
    model: 'bulbul:v3',
    category: 'tts',
    unit: 'characters',
    priceMicros: INR(3),
    currency: 'INR',
    effectiveFrom: FROM,
    source: `${REFERENCE} (₹30 per 10K characters)`,
  },
  {
    provider: 'elevenlabs',
    model: null,
    category: 'tts',
    unit: 'characters',
    priceMicros: USD(0.05),
    currency: 'USD',
    effectiveFrom: FROM,
    source: REFERENCE,
  },

  // Telephony.
  {
    provider: 'twilio',
    model: 'outbound_local_in',
    category: 'telephony',
    unit: 'minutes',
    priceMicros: USD(0.0699),
    currency: 'USD',
    effectiveFrom: FROM,
    source: TELEPHONY_REFERENCE,
  },
  {
    provider: 'twilio',
    model: 'outbound_mobile_in',
    category: 'telephony',
    unit: 'minutes',
    priceMicros: USD(0.0496),
    currency: 'USD',
    effectiveFrom: FROM,
    source: TELEPHONY_REFERENCE,
  },
  {
    provider: 'twilio',
    model: 'browser_sip',
    category: 'telephony',
    unit: 'minutes',
    priceMicros: USD(0.004),
    currency: 'USD',
    effectiveFrom: FROM,
    source: TELEPHONY_REFERENCE,
  },
];
