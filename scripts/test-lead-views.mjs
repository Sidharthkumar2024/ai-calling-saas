import assert from 'node:assert/strict';

import {
  BULK_ACTIONS,
  applyFilters,
  filterOptions,
  findDuplicates,
  isBulkAction,
  matchesFilters,
  normaliseEmail,
  normalisePhone,
  planMerge,
  toCsv,
} from '../lib/lead-views.ts';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

const lead = (over = {}) => ({
  id: 'l1',
  name: 'Priya Mehta',
  phone: '+91 98123 45678',
  email: 'priya@example.com',
  score: 68,
  intent: 'site_visit',
  status: 'nurture',
  stage: 'hot_lead',
  owner: 'Asha',
  source_type: 'meta_ads',
  source_name: 'Meta Lead Ads',
  campaign_name: 'Monsoon',
  product_interest: '3BHK',
  estimated_value: 9200000,
  captured_at: '2026-09-04T23:50:00Z',
  ...over,
});

console.log('normalisePhone');

check('the same number written five ways is one number', () => {
  // A dedupe that compares stored strings finds none of these.
  const forms = [
    '+91 98123 45678',
    '098123-45678',
    '9812345678',
    '+919812345678',
    '(98123) 45678',
  ];
  const keys = new Set(forms.map(normalisePhone));
  assert.equal(keys.size, 1, [...keys].join(' | '));
  assert.equal([...keys][0], '9812345678');
});

check('a short or empty number is not coerced into a match key', () => {
  assert.equal(normalisePhone(''), '');
  assert.equal(normalisePhone('123'), '123');
  assert.equal(normalisePhone(null), '');
});

check('a non-scalar field does not become [object Object]', () => {
  // These records come off a JSON API and can change shape upstream.
  assert.equal(normalisePhone({ phone: '9812345678' }), '');
  assert.equal(normaliseEmail(['a@b.c']), '');
});

console.log('matchesFilters');

check('an empty filter set matches everything', () => {
  assert.equal(matchesFilters(lead(), {}), true);
  assert.equal(applyFilters([lead(), lead({ id: 'l2' })], {}).length, 2);
});

check('free text searches the fields a person would type into it', () => {
  for (const query of ['priya', 'MONSOON', '3bhk', 'meta lead'])
    assert.equal(matchesFilters(lead(), { query }), true, query);
  assert.equal(matchesFilters(lead(), { query: 'rohan' }), false);
});

check('a digits-only search finds the number however it is punctuated', () => {
  assert.equal(matchesFilters(lead(), { query: '9812345678' }), true);
  assert.equal(matchesFilters(lead(), { query: '4567' }), true);
  assert.equal(matchesFilters(lead(), { query: '9999999999' }), false);
});

check("'all' means unfiltered, not a value to match", () => {
  assert.equal(matchesFilters(lead(), { stage: 'all', owner: 'all' }), true);
});

check('each dimension filters independently', () => {
  assert.equal(matchesFilters(lead(), { stage: 'hot_lead' }), true);
  assert.equal(matchesFilters(lead(), { stage: 'won' }), false);
  assert.equal(matchesFilters(lead(), { owner: 'Asha' }), true);
  assert.equal(matchesFilters(lead(), { owner: 'Vikram' }), false);
  assert.equal(matchesFilters(lead(), { sourceType: 'meta_ads' }), true);
  assert.equal(matchesFilters(lead(), { intent: 'site_visit' }), true);
  assert.equal(matchesFilters(lead(), { status: 'lost' }), false);
});

check('score range is inclusive at both ends', () => {
  assert.equal(matchesFilters(lead({ score: 68 }), { minScore: 68 }), true);
  assert.equal(matchesFilters(lead({ score: 68 }), { maxScore: 68 }), true);
  assert.equal(matchesFilters(lead({ score: 67 }), { minScore: 68 }), false);
  assert.equal(matchesFilters(lead({ score: 69 }), { maxScore: 68 }), false);
  // Null means "not set", which must not behave like zero.
  assert.equal(
    matchesFilters(lead({ score: 0 }), { minScore: null, maxScore: null }),
    true,
  );
});

check('a date filter includes the whole of its last day', () => {
  // Captured at 23:50 on the 4th must match a filter ending on the 4th.
  assert.equal(
    matchesFilters(lead(), {
      capturedFrom: '2026-09-04',
      capturedTo: '2026-09-04',
    }),
    true,
  );
  assert.equal(matchesFilters(lead(), { capturedTo: '2026-09-03' }), false);
  assert.equal(matchesFilters(lead(), { capturedFrom: '2026-09-05' }), false);
});

check('filters combine as AND', () => {
  const rows = [
    lead({ id: 'a', owner: 'Asha', score: 80 }),
    lead({ id: 'b', owner: 'Asha', score: 20 }),
    lead({ id: 'c', owner: 'Vikram', score: 90 }),
  ];
  const found = applyFilters(rows, { owner: 'Asha', minScore: 50 });
  assert.deepEqual(
    found.map((r) => r.id),
    ['a'],
  );
});

console.log('filterOptions');

check('dropdown options come from the data, deduplicated and sorted', () => {
  const options = filterOptions([
    lead({ owner: 'Vikram' }),
    lead({ id: 'l2', owner: 'Asha' }),
    lead({ id: 'l3', owner: 'Asha' }),
    lead({ id: 'l4', owner: '' }),
  ]);
  assert.deepEqual(options.owners, ['Asha', 'Vikram']);
});

console.log('findDuplicates');

check('the same person captured twice is found by phone', () => {
  const groups = findDuplicates([
    lead({ id: 'a', phone: '+91 98123 45678' }),
    lead({ id: 'b', phone: '9812345678', email: 'other@example.com' }),
    lead({ id: 'c', phone: '9000000000', email: 'unrelated@example.com' }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].on, 'phone');
  assert.deepEqual(groups[0].leads.map((l) => l.id).sort(), ['a', 'b']);
});

check(
  'overlapping phone and email groups are kept separate, not chained',
  () => {
    // a shares a phone with b and an email with c. Transitively that makes all
    // three one person, and chaining is exactly how a shared family or office
    // email merges strangers. Two groups is the reviewable answer: a person
    // decides each, and neither decision is made for them.
    const groups = findDuplicates([
      lead({ id: 'a', phone: '9811111111', email: 'shared@example.com' }),
      lead({ id: 'b', phone: '9811111111', email: 'b@example.com' }),
      lead({ id: 'c', phone: '9833333333', email: 'shared@example.com' }),
    ]);
    assert.equal(groups.length, 2);
    const phoneGroup = groups.find((g) => g.on === 'phone');
    const emailGroup = groups.find((g) => g.on === 'email');
    assert.deepEqual(phoneGroup.leads.map((l) => l.id).sort(), ['a', 'b']);
    assert.deepEqual(emailGroup.leads.map((l) => l.id).sort(), ['a', 'c']);
  },
);

check('email catches a pair whose numbers differ', () => {
  const groups = findDuplicates([
    lead({ id: 'a', phone: '9811111111' }),
    lead({ id: 'b', phone: '9822222222' }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].on, 'email');
});

check('one pair is never reported twice', () => {
  // Same phone AND same email: one group, not two.
  const groups = findDuplicates([lead({ id: 'a' }), lead({ id: 'b' })]);
  assert.equal(groups.length, 1);
});

check('blank contact details never group unrelated people', () => {
  // Half the rows in a bad import share an empty phone; grouping those would
  // offer to merge strangers.
  const groups = findDuplicates([
    lead({ id: 'a', phone: '', email: '' }),
    lead({ id: 'b', phone: '', email: '' }),
    lead({ id: 'c', phone: '   ', email: 'not-an-email' }),
  ]);
  assert.deepEqual(groups, []);
});

check('the biggest mess is offered first', () => {
  const groups = findDuplicates([
    lead({ id: 'a', phone: '9811111111', email: 'a@x.com' }),
    lead({ id: 'b', phone: '9811111111', email: 'b@x.com' }),
    lead({ id: 'c', phone: '9811111111', email: 'c@x.com' }),
    lead({ id: 'd', phone: '9822222222', email: 'd@x.com' }),
    lead({ id: 'e', phone: '9822222222', email: 'e@x.com' }),
  ]);
  assert.equal(groups[0].leads.length, 3);
});

console.log('planMerge');

check('a field the survivor lacks is filled from the duplicate', () => {
  const plan = planMerge(lead({ id: 'a', email: '' }), [
    lead({ id: 'b', email: 'priya@example.com' }),
  ]);
  assert.equal(plan.fill.email, 'priya@example.com');
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(plan.mergedIds, ['b']);
});

check('a genuine disagreement is reported, never resolved', () => {
  // A merge that silently picks one of two email addresses is how a business
  // loses the one it was actually reaching somebody on.
  const plan = planMerge(lead({ id: 'a', email: 'priya@work.com' }), [
    lead({ id: 'b', email: 'priya@home.com' }),
  ]);
  assert.equal(plan.fill.email, undefined);
  const conflict = plan.conflicts.find((c) => c.field === 'email');
  assert.ok(conflict);
  assert.deepEqual(conflict.values, ['priya@work.com', 'priya@home.com']);
});

check(
  'an empty survivor field with two different candidates is a conflict',
  () => {
    const plan = planMerge(lead({ id: 'a', email: '' }), [
      lead({ id: 'b', email: 'one@x.com' }),
      lead({ id: 'c', email: 'two@x.com' }),
    ]);
    assert.equal(plan.fill.email, undefined);
    assert.ok(plan.conflicts.some((c) => c.field === 'email'));
  },
);

check('the same number written differently is not a conflict', () => {
  // Reporting these as a disagreement would make the module contradict the
  // normalisation its own duplicate detection is built on, and bury the real
  // conflicts in noise.
  const plan = planMerge(lead({ id: 'a', phone: '+91 98765 43210' }), [
    lead({ id: 'b', phone: '9876543210' }),
  ]);
  assert.ok(
    !plan.conflicts.some((c) => c.field === 'phone'),
    JSON.stringify(plan.conflicts),
  );
});

check('the same value written differently is not a conflict', () => {
  const plan = planMerge(lead({ id: 'a', email: 'Priya@Example.com' }), [
    lead({ id: 'b', email: 'priya@example.com' }),
  ]);
  assert.deepEqual(plan.conflicts, []);
});

check('the merge keeps the best score in the group', () => {
  // A score is evidence accumulated from calls; merging must not discard it.
  const plan = planMerge(lead({ id: 'a', score: 40 }), [
    lead({ id: 'b', score: 91 }),
    lead({ id: 'c', score: 12 }),
  ]);
  assert.equal(plan.score, 91);
});

check('the survivor is never listed among the merged', () => {
  const plan = planMerge(lead({ id: 'a' }), [
    lead({ id: 'a' }),
    lead({ id: 'b' }),
  ]);
  assert.deepEqual(plan.mergedIds, ['b']);
});

check('merging with nothing is a no-op plan', () => {
  const plan = planMerge(lead({ id: 'a' }), []);
  assert.deepEqual(plan.mergedIds, []);
  assert.deepEqual(plan.conflicts, []);
  assert.equal(plan.score, 68);
});

console.log('bulk actions and export');

check('only the three named bulk actions are accepted', () => {
  assert.deepEqual(
    [...BULK_ACTIONS],
    ['assign_owner', 'move_stage', 'archive'],
  );
  assert.equal(isBulkAction('assign_owner'), true);
  assert.equal(isBulkAction('delete'), false);
  assert.equal(isBulkAction(''), false);
  assert.equal(isBulkAction(null), false);
});

check('CSV carries a header and one row per lead', () => {
  const csv = toCsv([lead(), lead({ id: 'l2', name: 'Rohan' })]);
  const lines = csv.split('\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[0].startsWith('name,phone,email,score'));
  assert.ok(lines[1].includes('Priya Mehta'));
});

check('a comma or quote in a value cannot shift the columns', () => {
  const csv = toCsv([lead({ name: 'Mehta, Priya "P"' })]);
  assert.ok(csv.includes('"Mehta, Priya ""P"""'));
  // One header line plus one data line, despite the embedded comma.
  assert.equal(csv.split('\n').length, 2);
});

check('a value that looks like a formula is neutralised', () => {
  // Otherwise opening the export in a spreadsheet executes it.
  for (const dangerous of ['=1+1', '+cmd', '-2+3', '@SUM(A1)']) {
    const csv = toCsv([lead({ name: dangerous })]);
    assert.ok(csv.includes(`'${dangerous}`), dangerous);
  }
});

check('a newline in a value stays inside its cell', () => {
  const csv = toCsv([lead({ product_interest: '3BHK\nsea facing' })]);
  assert.ok(csv.includes('"3BHK\nsea facing"'));
});

check('no leads still produces a usable header', () => {
  assert.equal(toCsv([]).split('\n').length, 1);
  assert.ok(toCsv(undefined).startsWith('name,'));
});

console.log(`\n${passed} assertions passed.`);
