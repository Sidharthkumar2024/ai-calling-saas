import {
  applyRounding,
  convert,
  formatMoney,
  grossMargin,
  isCurrency,
  minorUnits,
  sellPriceFromMargin,
} from '../lib/currency.ts';
import {
  SEED_RATE_CARDS,
  priceUsage,
  selectRate,
} from '../lib/rate-cards.ts';

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) pass++;
  else fail++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
};

console.log('currency basics:');
ok('known currencies are recognised', isCurrency('INR') && isCurrency('usd'));
ok('an invented currency is not', !isCurrency('XYZ') && !isCurrency(null));
ok('rupees have 100 minor units', minorUnits('INR') === 100);
ok(
  'THE ZERO-DECIMAL TRAP: a yen is already the minor unit',
  minorUnits('JPY') === 1,
);

console.log('conversion:');
const usdToInr = convert({ amountMinor: 10000, from: 'USD', to: 'INR', rate: 83 });
ok('$100 at 83 is ₹8,300', usdToInr.ok && usdToInr.amountMinor === 830000);
ok('the rate used is carried with the result', usdToInr.ok && usdToInr.rate === 83);
ok('the source amount is carried too', usdToInr.ok && usdToInr.sourceAmountMinor === 10000);
const toYen = convert({ amountMinor: 10000, from: 'USD', to: 'JPY', rate: 150 });
ok(
  'differing exponents are handled: $100 at 150 is ¥15,000, not ¥1,500,000',
  toYen.ok && toYen.amountMinor === 15000,
);
ok(
  'THE ONE THAT MATTERS: a missing rate is refused, not treated as parity',
  convert({ amountMinor: 10000, from: 'USD', to: 'INR' }).ok === false,
);
ok(
  'and it says why',
  convert({ amountMinor: 100, from: 'USD', to: 'INR', rate: 0 }).reason === 'no_rate_available',
);
ok('same-currency needs no rate', convert({ amountMinor: 500, from: 'INR', to: 'INR' }).ok === true);
ok('an unsupported currency is refused', convert({ amountMinor: 1, from: 'USD', to: 'XYZ', rate: 1 }).ok === false);
const marked = convert({ amountMinor: 10000, from: 'USD', to: 'INR', rate: 83, markupPercent: 3 });
ok('a 3% markup is applied', marked.ok && marked.amountMinor === 854900);
ok('the markup is recorded, not folded into the rate', marked.ok && marked.rate === 83 && marked.markupPercent === 3);
ok('a same-currency markup still applies', convert({ amountMinor: 10000, from: 'INR', to: 'INR', markupPercent: 10 }).amountMinor === 11000);

console.log('rounding:');
ok('none keeps the exact minor amount', applyRounding(124749, 'INR', 'none') === 124749);
ok('nearest rounds to the major unit', applyRounding(124749, 'INR', 'nearest') === 124700);
ok('up never rounds down', applyRounding(124701, 'INR', 'up') === 124800);
ok(
  'psychological lands on a …99 price',
  applyRounding(124700, 'INR', 'psychological') === 129900,
);

console.log('margin:');
ok('sell price from cost and margin', sellPriceFromMargin(7000, 0.3).sellMinor === 10000);
ok(
  'a 100% margin has no finite answer and is refused',
  sellPriceFromMargin(7000, 1).ok === false,
);
ok('a negative margin is refused', sellPriceFromMargin(7000, -0.1).ok === false);
ok('gross margin is a fraction', Math.abs(grossMargin(10000, 7000) - 0.3) < 1e-9);
ok('no revenue means no margin, not zero', grossMargin(0, 7000) === null);
ok('a loss is a negative margin, not an error', grossMargin(5000, 7000) < 0);

console.log('rate cards:');
const at = new Date('2026-09-15T00:00:00.000Z');
const haiku = selectRate(SEED_RATE_CARDS, {
  provider: 'anthropic',
  model: 'claude-haiku-4-5',
  unit: 'input_tokens',
  at,
});
ok('an exact model match is found', haiku?.priceMicros === 1_000_000);
ok('every seeded card names its source', SEED_RATE_CARDS.every((c) => !!c.source));
ok(
  'a provider-wide card covers an unknown model on that provider',
  selectRate(SEED_RATE_CARDS, { provider: 'elevenlabs', model: 'some-new-voice', unit: 'characters', at })
    ?.priceMicros === 50_000,
);
ok(
  'NEVER across providers: an unknown provider gets nothing',
  selectRate(SEED_RATE_CARDS, { provider: 'acme', model: 'x', unit: 'input_tokens', at }) === null,
);
ok(
  'a card not yet effective is not used',
  selectRate(SEED_RATE_CARDS, { provider: 'anthropic', model: 'claude-haiku-4-5', unit: 'input_tokens', at: new Date('2026-01-01T00:00:00.000Z') }) === null,
);
const superseded = [
  { provider: 'p', model: null, category: 'llm', unit: 'input_tokens', priceMicros: 100, currency: 'USD', effectiveFrom: '2026-01-01T00:00:00.000Z' },
  { provider: 'p', model: null, category: 'llm', unit: 'input_tokens', priceMicros: 200, currency: 'USD', effectiveFrom: '2026-06-01T00:00:00.000Z' },
];
ok(
  'the latest effective card wins today',
  selectRate(superseded, { provider: 'p', unit: 'input_tokens', at }).priceMicros === 200,
);
ok(
  'HISTORY IS NOT REWRITTEN: a call in March still prices at Marchrates',
  selectRate(superseded, { provider: 'p', unit: 'input_tokens', at: new Date('2026-03-01T00:00:00.000Z') }).priceMicros === 100,
);
ok(
  'an expired card is not used',
  selectRate(
    [{ ...superseded[0], effectiveTo: '2026-02-01T00:00:00.000Z' }],
    { provider: 'p', unit: 'input_tokens', at },
  ) === null,
);

console.log('pricing usage:');
const priced = priceUsage(haiku, 12_000);
ok('12,000 tokens at $1 per million is 12,000 micros', priced.costMicros === 12_000);
ok('the currency comes from the card', priced.currency === 'USD');
const tts = selectRate(SEED_RATE_CARDS, { provider: 'sarvam', model: 'bulbul:v3', unit: 'characters', at });
ok('characters are priced per thousand', priceUsage(tts, 2_000).costMicros === 6_000_000);
const stt = selectRate(SEED_RATE_CARDS, { provider: 'sarvam', unit: 'seconds', at });
ok('seconds are priced per hour', priceUsage(stt, 1_800).costMicros === 15_000_000);
const unpriced = priceUsage(null, 5000);
ok(
  'THE DISTINCTION: unpriced is flagged, not silently zero',
  unpriced.costMicros === 0 && unpriced.unpriced === true,
);
ok('a real card is not flagged unpriced', priced.unpriced === false);
ok('negative usage is refused', priceUsage(haiku, -5).unpriced === true);
ok('zero usage costs zero and is still priced', priceUsage(haiku, 0).unpriced === false);

console.log('formatting:');
ok('rupees group the Indian way', formatMoney(12345678, 'INR').includes('1,23,456'));
ok('yen show no decimals', !formatMoney(1500, 'JPY').includes('.'));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
