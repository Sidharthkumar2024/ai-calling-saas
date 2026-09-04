import assert from 'node:assert/strict';

import {
  describeLeadEvent,
  jobFailurePattern,
  summariseToolUsage,
  toolOutcomeKind,
} from '../lib/activity-timeline.ts';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

console.log('describeLeadEvent');

const scoreEvent = (payload) =>
  describeLeadEvent({
    id: 'e1',
    eventType: 'score_recalculated',
    createdAt: '2026-09-04T00:00:00Z',
    payload,
  });

check('a rise is described as a rise, with the numbers', () => {
  const described = scoreEvent({
    previous: 68,
    score: 98,
    delta: 30,
    status: 'won',
  });
  assert.match(described.headline, /rose from 68 to 98/);
  assert.match(described.headline, /won/);
  assert.equal(described.direction, 'up');
  assert.equal(described.delta, 30);
});

check('a fall is described as a fall', () => {
  const described = scoreEvent({ previous: 55, score: 6, delta: -49 });
  assert.match(described.headline, /fell from 55 to 6/);
  assert.equal(described.direction, 'down');
});

check('no movement says so rather than showing a signed zero', () => {
  const described = scoreEvent({ previous: 50, score: 50, delta: 0 });
  assert.match(described.headline, /unchanged at 50/);
  assert.equal(described.direction, 'flat');
});

check('a missing delta is derived from the two scores', () => {
  // An event written before `delta` was stored is still explainable.
  const described = scoreEvent({ previous: 40, score: 55 });
  assert.equal(described.delta, 15);
});

check('reasons are ordered by how much they moved the score', () => {
  // The reason a score moved is usually one of them; reading it should not
  // mean scanning the list.
  const described = scoreEvent({
    previous: 50,
    score: 50,
    delta: 0,
    reasons: [
      { signal: 'objections', delta: -2, note: 'raised 1 objection' },
      { signal: 'outcome', delta: 28, note: 'booked an appointment' },
      { signal: 'sentiment', delta: -12, note: 'sounded negative' },
    ],
  });
  assert.deepEqual(
    described.reasons.map((r) => r.signal),
    ['outcome', 'sentiment', 'objections'],
  );
});

check('a malformed reason is dropped, not rendered as blank', () => {
  const described = scoreEvent({
    previous: 10,
    score: 20,
    reasons: [
      { signal: 'outcome', delta: 10, note: 'good' },
      { signal: 'broken' },
      { delta: 5 },
      'nonsense',
      null,
    ],
  });
  assert.equal(described.reasons.length, 1);
});

check('a reason with no note falls back to its signal', () => {
  const described = scoreEvent({
    previous: 10,
    score: 20,
    reasons: [{ signal: 'engagement', delta: 6 }],
  });
  assert.equal(described.reasons[0].note, 'engagement');
});

check('an unrecognised event still gets a readable headline', () => {
  // A timeline that silently skips entries is worse than one that says
  // something happened here.
  const described = describeLeadEvent({
    id: 'e2',
    eventType: 'consent_withdrawn',
    createdAt: '2026-09-04T00:00:00Z',
    payload: {},
  });
  assert.equal(described.headline, 'Consent withdrawn');
  assert.equal(described.delta, null);
  assert.equal(described.direction, 'flat');
});

check('a payload that is not an object does not throw', () => {
  for (const payload of [null, undefined, 'text', 42, []])
    assert.doesNotThrow(() =>
      describeLeadEvent({
        id: 'e3',
        eventType: 'score_recalculated',
        createdAt: 'now',
        payload,
      }),
    );
});

console.log('toolOutcomeKind');

check('a negative answer is not a failure', () => {
  // THE BUG THIS FOUND: `lookup_customer` read as 13 calls and 0 successes
  // while working correctly every time — the callers simply were not existing
  // customers. `ok` is the tool's reply to the *model*, which genuinely needs
  // to hear "there is no such customer".
  assert.equal(toolOutcomeKind(false, 'not_found'), 'answered_no');
  assert.equal(toolOutcomeKind(false, 'no_slots'), 'answered_no');
  assert.equal(toolOutcomeKind(false, 'out_of_stock'), 'answered_no');
});

check('refused input is its own category', () => {
  // The tool is behaving correctly and something upstream is not — an agent
  // called lookup_customer with the literal string "incoming call".
  assert.equal(toolOutcomeKind(false, 'invalid_phone'), 'rejected_input');
  assert.equal(toolOutcomeKind(false, 'invalid_amount'), 'rejected_input');
});

check('a real failure is a failure', () => {
  assert.equal(toolOutcomeKind(false, 'tool_failed'), 'failed');
  assert.equal(toolOutcomeKind(false, 'D1_ERROR: no such column'), 'failed');
  // An unrecognised reason counts as a failure rather than being excused.
  assert.equal(toolOutcomeKind(false, 'something_new'), 'failed');
  assert.equal(toolOutcomeKind(false, null), 'failed');
  assert.equal(toolOutcomeKind(false, ''), 'failed');
});

check('success is success whatever the reason field says', () => {
  assert.equal(toolOutcomeKind(true, 'not_found'), 'succeeded');
  assert.equal(toolOutcomeKind(true, null), 'succeeded');
});

console.log('summariseToolUsage');

const row = (over = {}) => ({
  toolName: 'x',
  succeeded: 0,
  answeredNo: 0,
  rejectedInput: 0,
  failed: 0,
  latencies: [],
  ...over,
});

check('calls, failures and a failure rate', () => {
  const [tool] = summariseToolUsage([
    row({
      toolName: 'send_whatsapp',
      succeeded: 8,
      failed: 2,
      latencies: [100, 200, 300],
    }),
  ]);
  assert.equal(tool.calls, 10);
  assert.equal(tool.failed, 2);
  assert.equal(tool.failureRate, 0.2);
});

check('a working lookup that keeps answering no is not failing', () => {
  // The exact shape of the live data that exposed the bug.
  const [tool] = summariseToolUsage([
    row({ toolName: 'lookup_customer', answeredNo: 12, rejectedInput: 1 }),
  ]);
  assert.equal(tool.calls, 13);
  assert.equal(tool.failed, 0);
  assert.equal(tool.failureRate, 0);
  assert.equal(tool.answeredNo, 12);
  assert.equal(tool.rejectedInput, 1);
});

check('a tool nobody called reports null, not a green zero', () => {
  // "Never failed" and "never tried" are different facts, and a tick against
  // the second one is a lie about an untested action.
  const [tool] = summariseToolUsage([row({ toolName: 'place_order' })]);
  assert.equal(tool.calls, 0);
  assert.equal(tool.failureRate, null);
  assert.equal(tool.medianLatencyMs, null);
  assert.equal(tool.p95LatencyMs, null);
});

check('percentiles come from real samples, never interpolated', () => {
  const [tool] = summariseToolUsage([
    row({ succeeded: 5, latencies: [10, 20, 30, 40, 50] }),
  ]);
  assert.equal(tool.medianLatencyMs, 30);
  assert.equal(tool.p95LatencyMs, 50);
  // With a handful of samples an interpolated percentile invents a latency no
  // call actually had.
  assert.ok([10, 20, 30, 40, 50].includes(tool.p95LatencyMs));
});

check('unsorted and dirty latencies are handled', () => {
  const [tool] = summariseToolUsage([
    row({ succeeded: 4, latencies: [300, 100, -5, Number.NaN, 200] }),
  ]);
  assert.equal(tool.medianLatencyMs, 200);
});

check('busiest tool first, counting every kind of call', () => {
  const tools = summariseToolUsage([
    row({ toolName: 'rare', succeeded: 1, latencies: [1] }),
    row({ toolName: 'common', answeredNo: 50, latencies: [1] }),
  ]);
  assert.equal(tools[0].toolName, 'common');
});

check('no rows is empty, not a throw', () => {
  assert.deepEqual(summariseToolUsage([]), []);
  assert.deepEqual(summariseToolUsage(undefined), []);
});

console.log('jobFailurePattern');

const attempt = (n, status, error = null) => ({
  attempt: n,
  status,
  durationMs: 10,
  error,
  createdAt: `t${n}`,
});

check('failing every time is distinguished from failing sometimes', () => {
  // Only `background_jobs.last_error` was ever shown, and one error cannot say
  // which of these it is — a bad payload needs a different response from a
  // flaky provider.
  assert.equal(
    jobFailurePattern([
      attempt(1, 'failed', 'no such column: x'),
      attempt(2, 'failed', 'no such column: x'),
    ]).pattern,
    'always',
  );
  assert.equal(
    jobFailurePattern([
      attempt(1, 'failed', 'timeout'),
      attempt(2, 'succeeded'),
      attempt(3, 'failed', 'timeout'),
    ]).pattern,
    'intermittent',
  );
});

check('a job that ended up succeeding is recovered, not failed', () => {
  const pattern = jobFailurePattern([
    attempt(1, 'failed', 'timeout'),
    attempt(2, 'succeeded'),
  ]);
  assert.equal(pattern.pattern, 'recovered');
  assert.equal(pattern.failures, 1);
});

check('a clean job is clean', () => {
  assert.equal(jobFailurePattern([attempt(1, 'succeeded')]).pattern, 'clean');
  assert.equal(jobFailurePattern([]).pattern, 'clean');
});

check('one cause is not counted as five failures', () => {
  const pattern = jobFailurePattern([
    attempt(1, 'failed', 'rate limited'),
    attempt(2, 'failed', 'rate limited'),
    attempt(3, 'failed', 'no such column: x'),
  ]);
  assert.equal(pattern.failures, 3);
  assert.deepEqual(pattern.distinctErrors, [
    'rate limited',
    'no such column: x',
  ]);
});

check('attempts out of order are read in order', () => {
  const pattern = jobFailurePattern([
    attempt(3, 'succeeded'),
    attempt(1, 'failed', 'a'),
    attempt(2, 'failed', 'b'),
  ]);
  assert.equal(pattern.pattern, 'recovered');
  assert.equal(pattern.lastError, 'b');
});

check('a failure with no message is still a failure', () => {
  const pattern = jobFailurePattern([attempt(1, 'failed')]);
  assert.equal(pattern.failures, 1);
  assert.equal(pattern.lastError, null);
  assert.deepEqual(pattern.distinctErrors, []);
});

console.log(`\n${passed} assertions passed.`);
