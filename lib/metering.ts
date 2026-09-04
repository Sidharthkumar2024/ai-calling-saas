import { getRawDb } from '@/db/index';
import { convert } from '@/lib/currency';
import {
  SEED_RATE_CARDS,
  priceUsage,
  selectRate,
  type RateCard,
  type UsageUnit,
} from '@/lib/rate-cards';

/**
 * Real metering (§27, §28).
 *
 * `recordUsage` used to write `units = 1, provider_cost_micros = 0,
 * billed_credits = 0` on every provider call. It was latency telemetry wearing
 * a metering table's name, and the admin panel titled "Provider cost and
 * margin" summed columns that were structurally always zero.
 *
 * This records what was actually consumed — tokens, characters, seconds — and
 * prices it against the rate card in force *at the time of the call*, then
 * normalises to the platform's base currency so costs from a dollar-priced
 * model and a rupee-priced one can be added together.
 *
 * The honest part: when nothing prices a call, the row is written with
 * `unpriced = 1`. A zero that means "free" and a zero that means "we don't
 * know" are indistinguishable in a sum, and every zero the old code wrote was
 * the second kind.
 */

export const BASE_CURRENCY = 'INR';

type CachedCards = { at: number; cards: RateCard[] };
let cache: CachedCards | null = null;

/**
 * Rate cards, cached briefly per isolate. They change when an operator edits
 * them, which is rare; a per-call query for every token count would not be.
 */
async function rateCards(): Promise<RateCard[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.cards;
  try {
    const rows = await getRawDb()
      .prepare(
        `SELECT id, provider, model, category, unit, price_micros, currency,
           effective_from, effective_to, source
         FROM provider_rate_cards`,
      )
      .all<{
        id: string;
        provider: string;
        model: string | null;
        category: string;
        unit: string;
        price_micros: number;
        currency: string;
        effective_from: string;
        effective_to: string | null;
        source: string | null;
      }>();
    const cards = (rows.results ?? []).map<RateCard>((row) => ({
      id: row.id,
      provider: row.provider,
      model: row.model,
      category: row.category as RateCard['category'],
      unit: row.unit as UsageUnit,
      priceMicros: row.price_micros,
      currency: row.currency,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      source: row.source,
    }));
    // An empty table before the seed has run should not silently price
    // everything at zero.
    cache = { at: Date.now(), cards: cards.length ? cards : SEED_RATE_CARDS };
    return cache.cards;
  } catch {
    return SEED_RATE_CARDS;
  }
}

/** Called after an operator edits a card, so the next call sees it. */
export function invalidateRateCards() {
  cache = null;
}

type FxCache = { at: number; rates: Map<string, number> };
let fxCache: FxCache | null = null;

async function fxRate(from: string, to: string): Promise<number | null> {
  if (from === to) return 1;
  if (!fxCache || Date.now() - fxCache.at > 300_000) {
    const rates = new Map<string, number>();
    try {
      const rows = await getRawDb()
        .prepare(
          `SELECT base_currency, quote_currency, rate, effective_from FROM fx_rates
           WHERE effective_from <= ? ORDER BY effective_from`,
        )
        .bind(new Date().toISOString())
        .all<{ base_currency: string; quote_currency: string; rate: number }>();
      // Later rows overwrite earlier ones, so the most recent effective rate
      // for each pair wins.
      for (const row of rows.results ?? [])
        rates.set(`${row.base_currency}>${row.quote_currency}`, row.rate);
    } catch {
      /* no table yet; fall through to null */
    }
    fxCache = { at: Date.now(), rates };
  }
  const direct = fxCache.rates.get(`${from}>${to}`);
  if (direct) return direct;
  const inverse = fxCache.rates.get(`${to}>${from}`);
  // An inverse is a real rate, not a guess: 1/83 dollars per rupee is exactly
  // as true as 83 rupees per dollar.
  return inverse ? 1 / inverse : null;
}

export type UsageRecord = {
  organizationId: string;
  provider: string;
  model?: string | null;
  category: string;
  operation: string;
  unit: UsageUnit;
  units: number;
  latencyMs: number;
  referenceId?: string | null;
  status?: string;
};

/**
 * Records one metered provider call and returns what it cost in the base
 * currency, so a caller can attribute it to a call.
 */
export async function recordMeteredUsage(input: UsageRecord) {
  const cards = await rateCards();
  const card = selectRate(cards, {
    provider: input.provider,
    model: input.model ?? null,
    unit: input.unit,
    at: new Date(),
  });
  const priced = priceUsage(card, input.units);

  let baseCostMicros = priced.costMicros;
  let usedRate: number | null = 1;
  if (!priced.unpriced && priced.currency !== BASE_CURRENCY) {
    const rate = await fxRate(priced.currency, BASE_CURRENCY);
    const converted = convert({
      amountMinor: priced.costMicros,
      from: priced.currency,
      to: BASE_CURRENCY,
      rate,
    });
    if (converted.ok) {
      baseCostMicros = converted.amountMinor;
      usedRate = converted.rate;
    } else {
      // Priced but not convertible. The provider cost is still true in its own
      // currency; the base figure is unknown, and says so rather than being
      // added to a rupee total as if it were rupees.
      baseCostMicros = 0;
      usedRate = null;
    }
  }

  await getRawDb()
    .prepare(
      `INSERT INTO provider_usage_events
        (id, organization_id, provider_id, category, operation, model, unit, units,
         provider_cost_micros, cost_currency, base_cost_micros, fx_rate, rate_card_id,
         unpriced, billed_credits, latency_ms, status, reference_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    )
    .bind(
      `usage_${crypto.randomUUID()}`,
      input.organizationId,
      input.provider,
      input.category,
      input.operation,
      input.model ?? null,
      input.unit,
      Math.round(input.units),
      priced.costMicros,
      priced.currency,
      usedRate === null ? null : baseCostMicros,
      usedRate,
      priced.rateCardId,
      priced.unpriced ? 1 : 0,
      Math.round(input.latencyMs),
      input.status ?? 'success',
      input.referenceId ?? null,
    )
    .run();

  return {
    costMicros: priced.costMicros,
    currency: priced.currency,
    baseCostMicros: usedRate === null ? null : baseCostMicros,
    unpriced: priced.unpriced,
  };
}

/**
 * Per-call cost decomposition (§28): telephony + STT + LLM + TTS + messaging +
 * storage, summed in the base currency from the events the call produced.
 */
export async function callCostBreakdown(
  organizationId: string,
  callId: string,
) {
  const rows = await getRawDb()
    .prepare(
      `SELECT category, sum(coalesce(base_cost_micros, 0)) AS cost,
         sum(CASE WHEN unpriced = 1 THEN 1 ELSE 0 END) AS unpriced_events,
         count(*) AS events
       FROM provider_usage_events
       WHERE organization_id = ? AND reference_id = ?
       GROUP BY category`,
    )
    .bind(organizationId, callId)
    .all<{
      category: string;
      cost: number;
      unpriced_events: number;
      events: number;
    }>();
  const byCategory: Record<string, number> = {};
  let total = 0;
  let unpricedEvents = 0;
  for (const row of rows.results ?? []) {
    byCategory[row.category] = Number(row.cost ?? 0);
    total += Number(row.cost ?? 0);
    unpricedEvents += Number(row.unpriced_events ?? 0);
  }
  return {
    totalMicros: total,
    byCategory,
    unpricedEvents,
    // Surfaced rather than buried: a total that is missing some of its parts
    // must not be presented as complete.
    complete: unpricedEvents === 0,
  };
}
