/**
 * What a minute of conversation costs, and what a plan has to charge for it.
 *
 * The platform already measures what it *has* spent: `provider_usage_events`
 * carries real token counts and priced them against `provider_rate_cards`, and
 * the admin panel divides revenue by cost over 30 days. That is a rear-view
 * mirror. It cannot answer the question you actually need answered before
 * setting a price — *what does one minute cost me, and what must a plan charge
 * to survive it?*
 *
 * This is that model. Three rules it keeps:
 *
 * **A missing rate is never a zero.** If any component of a minute has no rate
 * card, the total is reported as a floor with the missing pieces named. A cost
 * model that quietly treats an unpriced provider as free will tell you every
 * plan is profitable.
 *
 * **Assumptions are labelled as assumptions.** How many turns happen in a
 * minute, how many tokens a turn costs — these are measured from this
 * deployment's own usage where there is enough of it, and stated as estimates
 * where there is not. Every figure carries where it came from.
 *
 * **Fixed costs are shared, not ignored.** A server bill does not care how many
 * calls you made. It is amortised per workspace and shown separately, because
 * the break-even on a plan moves entirely with how many workspaces carry it.
 */

import { UNIT_BATCH, type UsageUnit } from './rate-cards.ts';

/** Micros of one rupee: the unit `provider_rate_cards.price_micros` uses. */
const MICROS = 1_000_000;

/**
 * A rate is quoted per batch — per million tokens, per thousand characters,
 * per *hour* of audio. Read from `rate-cards.ts` rather than restated here: I
 * had written 1000 for seconds and undercounted every minute of transcription
 * by a factor of 3.6.
 */
function priceFor(micros: number | null, unit: UsageUnit, quantity: number) {
  return micros === null
    ? null
    : Math.round((micros * quantity) / UNIT_BATCH[unit]);
}

export type CostComponent = {
  key: 'stt' | 'llm_input' | 'llm_output' | 'tts' | 'telephony';
  label: string;
  /** Cost in micros, or null when nothing prices it. */
  micros: number | null;
  /** What was consumed, for the reader to sanity-check the arithmetic. */
  quantity: string;
};

export type MinuteCost = {
  components: CostComponent[];
  /** The sum of what could be priced. */
  micros: number;
  /** True when every component had a rate. */
  complete: boolean;
  /** Components with no rate card, by label. */
  missing: string[];
  summary: string;
};

/**
 * How a minute of conversation is spent.
 *
 * `source` travels with the numbers so nobody mistakes a default for a
 * measurement. `measured` means it came from this deployment's own
 * `provider_usage_events`.
 */
export type Assumptions = {
  turnsPerMinute: number;
  inputTokensPerTurn: number;
  outputTokensPerTurn: number;
  ttsCharactersPerTurn: number;
  /** Seconds of audio transcribed per minute of call. */
  sttSecondsPerMinute: number;
  source: 'measured' | 'estimated' | 'mixed';
  note: string;
};

/**
 * Defaults, and where they come from.
 *
 * The token and character figures are the averages this deployment has
 * actually recorded. `turnsPerMinute` is an estimate: a 46-second average call
 * carrying a handful of exchanges works out near six turns a minute, but that
 * is arithmetic on a small sample rather than a measurement, and it is the
 * number worth overriding first.
 */
export const DEFAULT_ASSUMPTIONS: Assumptions = {
  turnsPerMinute: 6,
  inputTokensPerTurn: 1283,
  outputTokensPerTurn: 158,
  ttsCharactersPerTurn: 420,
  sttSecondsPerMinute: 60,
  source: 'mixed',
  note: 'Token counts are averages measured from this deployment; turns per minute and characters per turn are estimates. Override them with your own figures before pricing anything.',
};

/** A rate lookup: micros per one unit, or null when nothing prices it. */
export type RateLookup = (
  category:
    | 'llm'
    | 'stt'
    | 'tts'
    | 'telephony'
    | 'messaging'
    | 'infrastructure',
  unit: string,
) => number | null;

const round = (value: number) => Math.round(value);

/**
 * What one minute of conversation costs.
 *
 * Rates are per the unit's own batch — LLM per million tokens, TTS per
 * thousand characters — because that is how providers quote and how the rate
 * cards store them.
 */
export function costPerMinute(
  rate: RateLookup,
  assumptions: Assumptions = DEFAULT_ASSUMPTIONS,
): MinuteCost {
  const turns = Math.max(0, assumptions.turnsPerMinute);
  const inputTokens = turns * assumptions.inputTokensPerTurn;
  const outputTokens = turns * assumptions.outputTokensPerTurn;
  const characters = turns * assumptions.ttsCharactersPerTurn;

  const components: CostComponent[] = [
    {
      key: 'stt',
      label: 'Speech to text',
      micros: priceFor(
        rate('stt', 'seconds'),
        'seconds',
        assumptions.sttSecondsPerMinute,
      ),
      quantity: `${assumptions.sttSecondsPerMinute}s of audio`,
    },
    {
      key: 'llm_input',
      label: 'Model input',
      micros: priceFor(
        rate('llm', 'input_tokens'),
        'input_tokens',
        inputTokens,
      ),
      quantity: `${inputTokens.toLocaleString('en-IN')} tokens`,
    },
    {
      key: 'llm_output',
      label: 'Model output',
      micros: priceFor(
        rate('llm', 'output_tokens'),
        'output_tokens',
        outputTokens,
      ),
      quantity: `${outputTokens.toLocaleString('en-IN')} tokens`,
    },
    {
      key: 'tts',
      label: 'Text to speech',
      micros: priceFor(rate('tts', 'characters'), 'characters', characters),
      quantity: `${characters.toLocaleString('en-IN')} characters`,
    },
    {
      key: 'telephony',
      label: 'Carrier',
      micros: priceFor(rate('telephony', 'minutes'), 'minutes', 1),
      quantity: '1 minute',
    },
  ];

  const missing = components
    .filter((component) => component.micros === null)
    .map((component) => component.label);
  const micros = components.reduce(
    (total, component) => total + (component.micros ?? 0),
    0,
  );

  return {
    components,
    micros,
    complete: missing.length === 0,
    missing,
    summary: missing.length
      ? // Said as a floor, not a total. A model that treats an unpriced provider
        // as free reports every plan as profitable.
        `At least ${formatRupees(micros)} per minute — ${missing.join(' and ')} ${missing.length === 1 ? 'has' : 'have'} no rate card, so the real cost is higher.`
      : `${formatRupees(micros)} per minute of conversation.`,
  };
}

/** A whole call, at the average length this workspace actually sees. */
export function costPerCall(minute: MinuteCost, averageMinutes: number) {
  const minutes = Math.max(0, averageMinutes);
  return {
    minutes,
    micros: round(minute.micros * minutes),
    complete: minute.complete,
    summary: `${minute.complete ? '' : 'At least '}${formatRupees(round(minute.micros * minutes))} for an average ${minutes.toFixed(1)}-minute call.`,
  };
}

/** One WhatsApp message, priced per message rather than per conversation. */
export function costPerMessage(rate: RateLookup) {
  const micros = rate('messaging', 'messages');
  return {
    micros,
    summary:
      micros === null
        ? 'No rate card for WhatsApp messages, so message cost is not counted anywhere.'
        : `${formatRupees(micros)} per message.`,
  };
}

/**
 * The server bill, divided by the workspaces carrying it.
 *
 * Returns null rather than zero with no workspaces: dividing a fixed cost by
 * nobody is not free, it is undefined.
 */
export function fixedCostPerWorkspace(
  monthlyMicros: number | null,
  activeWorkspaces: number,
) {
  if (monthlyMicros === null)
    return {
      micros: null,
      summary:
        'No infrastructure rate card, so the server bill is not in any of these numbers.',
    };
  if (activeWorkspaces <= 0)
    return {
      micros: null,
      summary: `${formatRupees(monthlyMicros)} a month, carried by no workspaces yet.`,
    };
  const micros = round(monthlyMicros / activeWorkspaces);
  return {
    micros,
    summary: `${formatRupees(micros)} a month per workspace, from ${formatRupees(monthlyMicros)} across ${activeWorkspaces}.`,
  };
}

export type PlanEconomics = {
  planPriceMicros: number;
  includedMinutes: number;
  variableMicros: number;
  fixedMicros: number;
  totalCostMicros: number;
  grossProfitMicros: number;
  /** 0–1, or null when the plan is free. */
  margin: number | null;
  /** Minutes at which this plan stops making money. */
  breakEvenMinutes: number | null;
  complete: boolean;
  summary: string;
};

/**
 * Whether a plan survives a customer who uses everything they paid for.
 *
 * Priced at the *included* minutes, not at average use: a plan that only works
 * while customers under-use it is not a plan, it is a hope.
 */
export function planEconomics(input: {
  planPriceMicros: number;
  includedMinutes: number;
  costPerMinuteMicros: number;
  fixedMicros?: number | null;
  complete?: boolean;
}): PlanEconomics {
  const fixed = Math.max(0, input.fixedMicros ?? 0);
  const variable = round(
    input.costPerMinuteMicros * Math.max(0, input.includedMinutes),
  );
  const total = variable + fixed;
  const profit = input.planPriceMicros - total;
  const margin =
    input.planPriceMicros > 0 ? profit / input.planPriceMicros : null;
  const breakEven =
    input.costPerMinuteMicros > 0
      ? Math.max(
          0,
          Math.floor(
            (input.planPriceMicros - fixed) / input.costPerMinuteMicros,
          ),
        )
      : null;

  const complete = input.complete !== false && input.fixedMicros !== null;
  return {
    planPriceMicros: input.planPriceMicros,
    includedMinutes: input.includedMinutes,
    variableMicros: variable,
    fixedMicros: fixed,
    totalCostMicros: total,
    grossProfitMicros: profit,
    margin,
    breakEvenMinutes: breakEven,
    complete,
    summary: summarisePlan({
      profit,
      margin,
      breakEven,
      includedMinutes: input.includedMinutes,
      complete,
    }),
  };
}

function summarisePlan(input: {
  profit: number;
  margin: number | null;
  breakEven: number | null;
  includedMinutes: number;
  complete: boolean;
}): string {
  const hedge = input.complete
    ? ''
    : ' Some costs have no rate card, so the real margin is lower.';
  if (input.margin === null)
    return `Free plan — every minute is a cost with no revenue against it.${hedge}`;
  if (input.profit < 0)
    return `Loses ${formatRupees(-input.profit)} if a customer uses all ${input.includedMinutes} included minutes.${hedge}`;
  const percent = Math.round(input.margin * 100);
  const cushion =
    input.breakEven === null
      ? ''
      : ` Break-even at ${input.breakEven.toLocaleString('en-IN')} minutes.`;
  return `${percent}% gross margin at full use.${cushion}${hedge}`;
}

/**
 * What to charge for a target margin.
 *
 * `sell = cost / (1 - margin)`. Refuses a margin of 1 or more rather than
 * dividing by zero and returning Infinity as a price.
 */
export function priceForMargin(
  costMicros: number,
  targetMargin: number,
): number | null {
  if (!Number.isFinite(targetMargin) || targetMargin >= 1 || targetMargin < 0)
    return null;
  return round(costMicros / (1 - targetMargin));
}

/** Micros to a readable rupee figure, with paise where they matter. */
export function formatRupees(micros: number): string {
  const rupees = micros / MICROS;
  if (rupees === 0) return '₹0';
  if (Math.abs(rupees) < 1) return `₹${rupees.toFixed(rupees < 0.01 ? 4 : 2)}`;
  return `₹${rupees.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/* ------------------------------------------------------------------ *
 * What to charge
 * ------------------------------------------------------------------ */

/**
 * Credits are the per-minute currency, so a credit has a price on both sides.
 *
 * A workspace buys credits in packs and spends ten of them a minute. That
 * makes the sell price of a minute a fact already sitting in the credit
 * packages — nobody had ever compared it to what a minute costs.
 */
export const CREDITS_PER_MINUTE = 10;

export type CreditEconomics = {
  packName: string;
  credits: number;
  pricePaidMicros: number;
  /** What one minute sells for, in micros. */
  sellPerMinuteMicros: number;
  costPerMinuteMicros: number;
  marginPerMinute: number | null;
  complete: boolean;
  summary: string;
};

export function creditEconomics(input: {
  packName: string;
  credits: number;
  pricePaidMicros: number;
  costPerMinuteMicros: number;
  complete?: boolean;
}): CreditEconomics {
  const minutes = input.credits / CREDITS_PER_MINUTE;
  const sell = minutes > 0 ? Math.round(input.pricePaidMicros / minutes) : 0;
  const margin = sell > 0 ? (sell - input.costPerMinuteMicros) / sell : null;
  const complete = input.complete !== false;
  return {
    packName: input.packName,
    credits: input.credits,
    pricePaidMicros: input.pricePaidMicros,
    sellPerMinuteMicros: sell,
    costPerMinuteMicros: input.costPerMinuteMicros,
    marginPerMinute: margin,
    complete,
    summary:
      margin === null
        ? `${input.packName} has no minutes in it to price.`
        : `${formatRupees(sell)} a minute against ${formatRupees(input.costPerMinuteMicros)} of cost — ${Math.round(margin * 100)}% on the variable cost alone.${complete ? '' : ' Some costs have no rate card, so the real margin is lower.'}`,
  };
}

export type PriceSuggestion = {
  targetMargin: number;
  /** What the plan should charge, in micros. Null when the target is invalid. */
  suggestedMicros: number | null;
  currentMicros: number;
  /** Positive means it is underpriced against the target. */
  shortfallMicros: number | null;
  summary: string;
};

/**
 * What a plan would have to charge to hit a target margin.
 *
 * Costed at the minutes the plan includes plus its share of the fixed bill,
 * because that is what a customer is entitled to consume.
 */
export function suggestPlanPrice(input: {
  planName: string;
  currentPriceMicros: number;
  includedMinutes: number;
  costPerMinuteMicros: number;
  fixedMicros?: number | null;
  targetMargin: number;
  complete?: boolean;
}): PriceSuggestion {
  const cost =
    Math.round(input.costPerMinuteMicros * Math.max(0, input.includedMinutes)) +
    Math.max(0, input.fixedMicros ?? 0);
  const suggested = priceForMargin(cost, input.targetMargin);
  const shortfall =
    suggested === null ? null : suggested - input.currentPriceMicros;
  const hedge =
    input.complete === false || input.fixedMicros === null
      ? ' Some costs have no rate card, so this is a floor.'
      : '';

  if (suggested === null)
    return {
      targetMargin: input.targetMargin,
      suggestedMicros: null,
      currentMicros: input.currentPriceMicros,
      shortfallMicros: null,
      summary:
        'A margin of 100% or more has no price that satisfies it — every sale would have to be free to us and paid for by the customer at once.',
    };

  return {
    targetMargin: input.targetMargin,
    suggestedMicros: suggested,
    currentMicros: input.currentPriceMicros,
    shortfallMicros: shortfall,
    summary:
      shortfall === null || shortfall <= 0
        ? `${input.planName} already clears ${Math.round(input.targetMargin * 100)}% — ${formatRupees(input.currentPriceMicros)} against a ${formatRupees(suggested)} floor.${hedge}`
        : `${input.planName} needs ${formatRupees(suggested)} to hold ${Math.round(input.targetMargin * 100)}%, which is ${formatRupees(shortfall)} above the ${formatRupees(input.currentPriceMicros)} it charges today.${hedge}`,
  };
}
