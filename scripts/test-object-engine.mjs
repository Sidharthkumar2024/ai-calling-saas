import {
  FIELD_TYPES,
  buildFilterPlan,
  normaliseFieldValue,
  slugifyKey,
  summariseRecord,
  validateRecord,
} from '../lib/object-engine.ts';

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) pass++;
  else fail++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
};

const f = (key, type, extra = {}) => ({
  key,
  label: key.replace(/_/g, ' '),
  type,
  filterable: true,
  ...extra,
});

console.log('field values:');
ok(
  'a number accepts digits with separators',
  normaliseFieldValue(f('price', 'number'), '2,50,000').value === 250000,
);
ok(
  'a number REJECTS prose rather than guessing',
  normaliseFieldValue(f('price', 'number'), 'about twenty').ok === false,
);
ok(
  'inventory cannot be negative',
  normaliseFieldValue(f('stock', 'inventory'), -3).ok === false,
);
ok(
  'inventory rounds to whole units',
  normaliseFieldValue(f('stock', 'inventory'), 4.7).value === 5,
);
ok(
  'a date needs a real date',
  normaliseFieldValue(f('when', 'date'), '30/09/2026').ok === false,
);
ok(
  'an ISO date is accepted',
  normaliseFieldValue(f('when', 'date'), '2026-09-30').ok === true,
);
ok(
  'a geo point parses "lat, lng"',
  JSON.stringify(normaliseFieldValue(f('at', 'geo'), '28.61, 77.20').value) ===
    '{"lat":28.61,"lng":77.2}',
);
ok(
  'a geo point off Earth is rejected',
  normaliseFieldValue(f('at', 'geo'), '128.6, 77.2').ok === false,
);
ok(
  'a select rejects a value outside its options',
  normaliseFieldValue(
    f('facing', 'select', { options: ['east', 'west'] }),
    'north',
  ).ok === false,
);
ok(
  'a boolean takes yes/no',
  normaliseFieldValue(f('parking', 'boolean'), 'yes').value === true,
);
ok(
  'a boolean rejects anything else',
  normaliseFieldValue(f('parking', 'boolean'), 'maybe').ok === false,
);

console.log('media URLs:');
ok(
  'THE ONE THAT MATTERS: javascript: is refused in a media field',
  normaliseFieldValue(f('tour', 'model_3d'), 'javascript:alert(1)').ok ===
    false,
);
ok(
  'data: is refused too',
  normaliseFieldValue(f('photo', 'image'), 'data:text/html,<script>').ok ===
    false,
);
ok(
  'a bare hostname is refused',
  normaliseFieldValue(f('photo', 'image'), 'example.com/a.jpg').ok === false,
);
ok(
  'https is accepted',
  normaliseFieldValue(f('photo', 'image'), 'https://cdn.example.com/a.jpg')
    .ok === true,
);

console.log('records:');
const fields = [
  f('title', 'text', { required: true }),
  f('price', 'currency', { currency: 'INR' }),
  f('bhk', 'number'),
  f('brochure', 'file', { filterable: false }),
  f('notes', 'long_text', { filterable: true }),
];
const good = validateRecord(fields, {
  title: 'Dwarka Expressway 3BHK',
  price: 20000000,
  bhk: 3,
  brochure: 'https://cdn.example.com/b.pdf',
  notes: 'Corner unit',
  colour: 'blue',
});
ok('a valid record passes', good.ok);
ok('unknown keys are dropped, not stored', !('colour' in good.values));
ok(
  'only filterable, storable fields are projected',
  good.projection
    .map((p) => p.key)
    .sort()
    .join(',') === 'bhk,price,title',
);
ok(
  'long_text is filterable-flagged but has no storage, so it is not projected',
  !good.projection.some((p) => p.key === 'notes'),
);
ok(
  'search text is lower-cased and joined',
  good.searchText.includes('dwarka expressway 3bhk'),
);
const bad = validateRecord(fields, { price: 'lots' });
ok(
  'a missing required field is an error',
  bad.errors.some((e) => e.field === 'title'),
);
ok(
  'the error names the field by its label',
  bad.errors.some((e) => e.message.startsWith('price ')),
);

console.log('filter planning:');
const plan = buildFilterPlan(fields, [
  { field: 'price', operator: 'lte', value: 25000000 },
  { field: 'bhk', operator: 'eq', value: 3 },
  { field: 'title', operator: 'contains', value: 'dwarka' },
]);
ok('three usable filters make three clauses', plan.clauses.length === 3);
ok('nothing was skipped', plan.skipped.length === 0);
ok(
  'every clause is parameterised — no value reaches SQL as text',
  plan.clauses.every((c) => !/\d{4,}/.test(c)) &&
    plan.bindings.includes(25000000),
);
ok(
  'each filter binds its field key too, so a key cannot be interpolated',
  plan.bindings.filter((b) => b === 'price').length === 1,
);
ok(
  'numbers filter on the numeric column',
  plan.clauses[0].includes('number_value'),
);
ok(
  'text search filters on the text column',
  plan.clauses[2].includes('text_value'),
);

const injected = buildFilterPlan(fields, [
  { field: "price') OR 1=1 --", operator: 'eq', value: 1 },
]);
ok(
  'THE INJECTION GUARD: an unknown field name is refused, not interpolated',
  injected.clauses.length === 0 &&
    injected.skipped[0].reason === 'no such field',
);
const wildcard = buildFilterPlan(fields, [
  { field: 'title', operator: 'contains', value: '100% off_er' },
]);
ok(
  'LIKE wildcards in user text are escaped, so "100%" means 100%',
  wildcard.bindings[1] === '%100\\% off\\_er%',
);

const unfilterable = buildFilterPlan(fields, [
  { field: 'brochure', operator: 'eq', value: 'x' },
]);
ok(
  'HONEST: a non-filterable field is reported, not silently ignored',
  unfilterable.clauses.length === 0 &&
    unfilterable.skipped[0].reason === 'field is not filterable',
);
const badOperator = buildFilterPlan(fields, [
  { field: 'price', operator: 'contains', value: 'x' },
]);
ok(
  'contains on a number is reported',
  badOperator.skipped[0].reason === 'contains only applies to text',
);
const badValue = buildFilterPlan(fields, [
  { field: 'price', operator: 'gte', value: 'cheap' },
]);
ok(
  'an unparseable filter value is reported',
  badValue.skipped[0].reason === 'must be a number',
);
const inPlan = buildFilterPlan(fields, [
  { field: 'bhk', operator: 'in', value: [2, 3] },
]);
ok(
  'an IN filter binds every value',
  inPlan.bindings.length === 3 && inPlan.clauses[0].includes('IN (?, ?)'),
);

console.log('keys and summaries:');
ok(
  'a key is slugified',
  slugifyKey('Carpet Area (sq ft)') === 'carpet_area_sq_ft',
);
ok('an unusable key falls back', slugifyKey('!!!') === 'field');
ok(
  'a summary reads as a sentence and skips media',
  summariseRecord(fields, good.values).startsWith(
    'title: Dwarka Expressway 3BHK',
  ) && !summariseRecord(fields, good.values).includes('brochure'),
);
ok(
  'currency is formatted with its code',
  summariseRecord(fields, good.values).includes('INR 2,00,00,000'),
);
ok(
  'every field type has a storage rule',
  Object.values(FIELD_TYPES).every((s) => !!s.storage && !!s.label),
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
