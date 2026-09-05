import assert from 'node:assert/strict';

import {
  boundedPage,
  buildWhere,
  emptyKind,
  emptyMessage,
  EMPTY_FILTERS,
  isFiltered,
  MAX_PAGE_SIZE,
  PAGE_SIZE,
  parseFilters,
  rangeLabel,
  RECORDING_PRESENT,
  totalPages,
} from '../lib/call-history.ts';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

const q = (s) => new URLSearchParams(s);

console.log('parsing what arrives on a query string');

check('nothing set means nothing filtered', () => {
  const filters = parseFilters(q(''));
  assert.deepEqual(filters, EMPTY_FILTERS);
  assert.equal(isFiltered(filters), false);
});

check('each filter is read', () => {
  const filters = parseFilters(
    q('search=priya&campaign=c1&agent=a1&outcome=converted&direction=inbound&sentiment=negative&from=2026-09-01&to=2026-09-05&minSeconds=30&maxCredits=5&recording=yes&transcript=no'),
  );
  assert.equal(filters.search, 'priya');
  assert.equal(filters.campaignId, 'c1');
  assert.equal(filters.outcome, 'converted');
  assert.equal(filters.minSeconds, 30);
  assert.equal(filters.maxCredits, 5);
  assert.equal(filters.recording, 'yes');
  assert.equal(filters.transcript, 'no');
  assert.equal(isFiltered(filters), true);
});

check('a date that is not a date is dropped, not passed to SQL', () => {
  // Passed through it would match nothing and read as "you have no calls".
  assert.equal(parseFilters(q('from=last-tuesday')).from, '');
  assert.equal(parseFilters(q('from=2026-13-99')).from, '2026-13-99');
});

check('backwards dates are swapped, because that is what was meant', () => {
  const filters = parseFilters(q('from=2026-09-30&to=2026-09-01'));
  assert.equal(filters.from, '2026-09-01');
  assert.equal(filters.to, '2026-09-30');
});

check('a lone date is left alone', () => {
  assert.equal(parseFilters(q('from=2026-09-30')).from, '2026-09-30');
  assert.equal(parseFilters(q('to=2026-09-01')).to, '2026-09-01');
});

check('a nonsense number becomes no filter rather than zero', () => {
  // minSeconds=0 and "no minimum" are different queries.
  assert.equal(parseFilters(q('minSeconds=abc')).minSeconds, null);
  assert.equal(parseFilters(q('minSeconds=')).minSeconds, null);
  assert.equal(parseFilters(q('minSeconds=0')).minSeconds, 0);
  assert.equal(parseFilters(q('minSeconds=-5')).minSeconds, null);
});

check('an unknown tri-state falls back to any', () => {
  assert.equal(parseFilters(q('recording=maybe')).recording, 'any');
  assert.equal(parseFilters(q('recording=no')).recording, 'no');
});

check('long input is bounded', () => {
  assert.equal(parseFilters(q(`search=${'x'.repeat(400)}`)).search.length, 120);
});

console.log('\nthe WHERE clause — every value is a binding');

check('unfiltered scopes to the workspace and nothing else', () => {
  const clause = buildWhere('org1', EMPTY_FILTERS);
  assert.equal(clause.sql, 'c.organization_id = ?');
  assert.deepEqual(clause.bindings, ['org1']);
});

check('the placeholder count always matches the binding count', () => {
  // The invariant the SQL audit script checks across the repo.
  const filters = parseFilters(
    q('search=x&campaign=c&agent=a&outcome=o&direction=d&channel=ch&sentiment=s&from=2026-01-01&to=2026-02-01&minSeconds=1&maxSeconds=2&minCredits=3&maxCredits=4&recording=yes&transcript=yes'),
  );
  const clause = buildWhere('org1', filters);
  assert.equal((clause.sql.match(/\?/g) ?? []).length, clause.bindings.length);
});

check('and it still matches with the negative recording filter', () => {
  const clause = buildWhere('org1', { ...EMPTY_FILTERS, recording: 'no' });
  assert.equal((clause.sql.match(/\?/g) ?? []).length, clause.bindings.length);
});

check('no filter value is ever concatenated into the SQL', () => {
  const nasty = "'; DROP TABLE call_records; --";
  const clause = buildWhere('org1', {
    ...EMPTY_FILTERS,
    search: nasty,
    outcome: nasty,
    campaignId: nasty,
  });
  assert.equal(clause.sql.includes('DROP'), false);
  assert.ok(clause.bindings.some((b) => String(b).includes('DROP')));
});

check('a search wildcard is escaped so % does not match everything', () => {
  const clause = buildWhere('org1', { ...EMPTY_FILTERS, search: '100%' });
  assert.ok(clause.bindings.some((b) => String(b).includes('\\%')));
});

check('recording=yes lists only the states where one exists', () => {
  // 'pending' is a recording that was asked for and never arrived; counting it
  // would put a play button in front of somebody that does nothing.
  const clause = buildWhere('org1', { ...EMPTY_FILTERS, recording: 'yes' });
  assert.equal(RECORDING_PRESENT.includes('pending'), false);
  for (const state of RECORDING_PRESENT) assert.ok(clause.bindings.includes(state));
});

check('recording=no includes rows where the column is null', () => {
  const clause = buildWhere('org1', { ...EMPTY_FILTERS, recording: 'no' });
  assert.match(clause.sql, /recording_status IS NULL/);
});

check('an empty transcript counts as no transcript', () => {
  // A call that connected and said nothing has a row and nothing to read.
  const yes = buildWhere('org1', { ...EMPTY_FILTERS, transcript: 'yes' });
  assert.match(yes.sql, /trim\(coalesce\(t\.full_text, ''\)\) != ''/);
});

check('a zero minimum is a real filter, not an absent one', () => {
  const clause = buildWhere('org1', { ...EMPTY_FILTERS, minSeconds: 0 });
  assert.match(clause.sql, /duration_seconds, 0\) >= \?/);
  assert.ok(clause.bindings.includes(0));
});

console.log('\npaging');

check('defaults are sane and the first page starts at zero', () => {
  assert.deepEqual(boundedPage({}), { limit: PAGE_SIZE, offset: 0, page: 1 });
});

check('page 3 offsets by two pages', () => {
  const page = boundedPage({ page: 3, pageSize: 20 });
  assert.deepEqual(page, { limit: 20, offset: 40, page: 3 });
});

check('a page size nobody should ask for is capped', () => {
  assert.equal(boundedPage({ pageSize: 100000 }).limit, MAX_PAGE_SIZE);
  assert.equal(boundedPage({ pageSize: -1 }).limit, PAGE_SIZE);
  assert.equal(boundedPage({ page: -4 }).page, 1);
});

check('page counts never go below one, even with no rows', () => {
  assert.equal(totalPages(0, 50), 1);
  assert.equal(totalPages(51, 50), 2);
  assert.equal(totalPages(100, 50), 2);
});

console.log('\ntwo kinds of empty');

check('no rows and no filters is a product nobody has used', () => {
  assert.equal(emptyKind({ total: 0, filtered: false }), 'no_calls');
  assert.match(emptyMessage('no_calls'), /No calls yet/);
});

check('no rows with filters on is a filter to loosen', () => {
  // The same blank screen otherwise, meaning the opposite thing.
  assert.equal(emptyKind({ total: 0, filtered: true }), 'no_matches');
  assert.match(emptyMessage('no_matches'), /Clear one/);
});

check('rows means neither', () => {
  assert.equal(emptyKind({ total: 5, filtered: true }), null);
});

console.log('\nsaying how much is being shown');

check('the range names the total, so nobody thinks 50 is all of it', () => {
  assert.equal(
    rangeLabel({ page: 1, limit: 50, returned: 50, total: 4312 }),
    'Showing 1–50 of 4,312',
  );
});

check('a later page counts from the right place', () => {
  assert.equal(
    rangeLabel({ page: 3, limit: 50, returned: 12, total: 112 }),
    'Showing 101–112 of 112',
  );
});

check('one row does not read as a range', () => {
  assert.equal(rangeLabel({ page: 1, limit: 50, returned: 1, total: 1 }), 'Showing 1 of 1');
});

check('nothing to show says so', () => {
  assert.equal(rangeLabel({ page: 1, limit: 50, returned: 0, total: 0 }), 'Nothing to show');
});

console.log(`\n${passed} assertions passed.`);
