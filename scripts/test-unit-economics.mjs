import assert from 'node:assert/strict';

import {
  costPerCall,
  costPerMessage,
  costPerMinute,
  DEFAULT_ASSUMPTIONS,
  fixedCostPerWorkspace,
  formatRupees,
  planEconomics,
  priceForMargin,
} from '../lib/unit-economics.ts';

let checks = 0;
const check = (fn) => {
  fn();
  checks += 1;
};

// A rate table in the same micros-per-batch units the rate cards use.
const rates = {
  'stt:seconds': 30_000,      // per 1000 seconds
  'llm:input_tokens': 1_000_000,   // per million
  'llm:output_tokens': 5_000_000,
  'tts:characters': 12_000,   // per thousand
  'telephony:minutes': 600_000,
  'messaging:messages': 800_000,
  'infrastructure:months': 40_000_000_000,
};
const lookup = (category, unit) => rates[`${category}:${unit}`] ?? null;
const partial = (category, unit) =>
  category === 'telephony' || category === 'tts' ? null : lookup(category, unit);

// --- a minute ---------------------------------------------------------------

const minute = costPerMinute(lookup);
check(() => assert.equal(minute.complete, true));
check(() => assert.equal(minute.components.length, 5));
check(() => assert.equal(minute.missing.length, 0));
// 6 turns x 1283 input tokens = 7698 tokens at ₹1/million = 7698 micros.
check(() =>
  assert.equal(
    minute.components.find((c) => c.key === 'llm_input').micros,
    Math.round((1_000_000 * 6 * 1283) / 1_000_000),
  ),
);
check(() =>
  assert.equal(
    minute.components.find((c) => c.key === 'telephony').micros,
    600_000,
  ),
);
// Every component is quantified so the arithmetic can be checked by eye.
check(() =>
  assert.ok(minute.components.every((c) => c.quantity.length > 0)),
);
// Each rate is quoted per its own batch, taken from `rate-cards.ts` rather
// than restated here. Speech-to-text is priced per HOUR: writing 1000 instead
// of 3600 undercounted every minute of transcription by a factor of 3.6.
check(() =>
  assert.equal(
    minute.components.find((c) => c.key === 'stt').micros,
    Math.round((30_000 * 60) / 3_600),
  ),
);
check(() =>
  assert.equal(
    minute.components.find((c) => c.key === 'tts').micros,
    Math.round((12_000 * 6 * 420) / 1_000),
  ),
);

// THE RULE THAT MATTERS: a missing rate is never a zero. A cost model that
// treats an unpriced provider as free reports every plan as profitable.
const incomplete = costPerMinute(partial);
check(() => assert.equal(incomplete.complete, false));
check(() => assert.deepEqual(incomplete.missing, ['Text to speech', 'Carrier']));
check(() => assert.match(incomplete.summary, /^At least /));
check(() => assert.match(incomplete.summary, /the real cost is higher/));
check(() => assert.ok(incomplete.micros < minute.micros));

// Assumptions travel with their provenance, so a default is never mistaken for
// a measurement.
check(() => assert.equal(DEFAULT_ASSUMPTIONS.source, 'mixed'));
check(() => assert.match(DEFAULT_ASSUMPTIONS.note, /Override them/));
check(() =>
  assert.equal(
    costPerMinute(lookup, { ...DEFAULT_ASSUMPTIONS, turnsPerMinute: 0 })
      .components.find((c) => c.key === 'llm_input').micros,
    0,
  ),
);

// --- a call -----------------------------------------------------------------

const call = costPerCall(minute, 2.5);
check(() => assert.equal(call.micros, Math.round(minute.micros * 2.5)));
check(() => assert.match(call.summary, /2\.5-minute call/));
check(() => assert.match(costPerCall(incomplete, 2).summary, /^At least /));

// --- a message --------------------------------------------------------------

check(() => assert.equal(costPerMessage(lookup).micros, 800_000));
check(() =>
  assert.match(costPerMessage(() => null).summary, /not counted anywhere/),
);

// --- the server bill --------------------------------------------------------

check(() =>
  assert.equal(fixedCostPerWorkspace(40_000_000_000, 100).micros, 400_000_000),
);
// Dividing a fixed cost by nobody is not free, it is undefined.
check(() => assert.equal(fixedCostPerWorkspace(40_000_000_000, 0).micros, null));
check(() =>
  assert.match(fixedCostPerWorkspace(null, 10).summary, /not in any of these numbers/),
);

// --- a plan -----------------------------------------------------------------

// Priced at the minutes a customer paid for, not at average use: a plan that
// only works while customers under-use it is not a plan.
const healthy = planEconomics({
  planPriceMicros: 800_000_000,
  includedMinutes: 500,
  costPerMinuteMicros: minute.micros,
  fixedMicros: 0,
});
check(() => assert.ok(healthy.margin > 0));
check(() => assert.match(healthy.summary, /% gross margin at full use/));
check(() => assert.match(healthy.summary, /Break-even at/));

const losing = planEconomics({
  planPriceMicros: 100_000_000,
  includedMinutes: 5000,
  costPerMinuteMicros: minute.micros,
  fixedMicros: 0,
});
check(() => assert.ok(losing.grossProfitMicros < 0));
check(() => assert.match(losing.summary, /^Loses /));

// A free plan is every minute a cost with no revenue against it — not a
// division by zero, and not a 100% margin.
const free = planEconomics({
  planPriceMicros: 0,
  includedMinutes: 100,
  costPerMinuteMicros: minute.micros,
  fixedMicros: 0,
});
check(() => assert.equal(free.margin, null));
check(() => assert.match(free.summary, /^Free plan/));

// An unpriced component makes the stated margin optimistic, and it says so.
const hedged = planEconomics({
  planPriceMicros: 800_000_000,
  includedMinutes: 500,
  costPerMinuteMicros: incomplete.micros,
  fixedMicros: 0,
  complete: false,
});
check(() => assert.match(hedged.summary, /real margin is lower/));
check(() => assert.equal(hedged.complete, false));

// The server bill moves the break-even, so it is in the arithmetic.
const withFixed = planEconomics({
  planPriceMicros: 800_000_000,
  includedMinutes: 500,
  costPerMinuteMicros: minute.micros,
  fixedMicros: 400_000_000,
});
check(() => assert.ok(withFixed.breakEvenMinutes < healthy.breakEvenMinutes));
check(() => assert.ok(withFixed.margin < healthy.margin));

// --- pricing for a margin ---------------------------------------------------

check(() => assert.equal(priceForMargin(1000, 0.5), 2000));
check(() => assert.equal(priceForMargin(1000, 0.8), 5000));
check(() => assert.equal(priceForMargin(1000, 0), 1000));
// A 100% margin is a division by zero, not an infinite price.
check(() => assert.equal(priceForMargin(1000, 1), null));
check(() => assert.equal(priceForMargin(1000, 1.5), null));
check(() => assert.equal(priceForMargin(1000, -0.2), null));

// --- money ------------------------------------------------------------------

check(() => assert.equal(formatRupees(0), '₹0'));
check(() => assert.equal(formatRupees(1_000_000), '₹1'));
check(() => assert.equal(formatRupees(2_500_000), '₹2.5'));
// Sub-paise figures are the normal case per minute, so they keep their digits
// rather than rounding to ₹0.
check(() => assert.equal(formatRupees(500), '₹0.0005'));
check(() => assert.equal(formatRupees(50_000), '₹0.05'));

console.log(`unit-economics: ${checks} assertions passed`);
