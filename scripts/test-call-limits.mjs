import assert from 'node:assert/strict';

import {
  MAX_CALL_MINUTES,
  MAX_CONCURRENT_CALLS,
  concurrencyVerdict,
  overranMaximum,
} from '../lib/call-limits.ts';

let checks = 0;
const check = (fn) => {
  fn();
  checks += 1;
};

check(() => assert.equal(concurrencyVerdict(0).allowed, true));
check(() => assert.equal(concurrencyVerdict(MAX_CONCURRENT_CALLS - 1).allowed, true));
// The boundary is the limit itself: at six open, a seventh is refused.
check(() => assert.equal(concurrencyVerdict(MAX_CONCURRENT_CALLS).allowed, false));
check(() => assert.equal(concurrencyVerdict(MAX_CONCURRENT_CALLS + 4).allowed, false));
// The refusal names the numbers rather than saying "try later".
check(() => {
  const verdict = concurrencyVerdict(MAX_CONCURRENT_CALLS);
  assert.match(verdict.reason, new RegExp(`${MAX_CONCURRENT_CALLS} calls are already open`));
  assert.match(verdict.reason, new RegExp(`limit of ${MAX_CONCURRENT_CALLS}`));
});
// Nonsense counts do not open the gate or slam it.
check(() => assert.equal(concurrencyVerdict(Number.NaN).allowed, true));
check(() => assert.equal(concurrencyVerdict(-3).allowed, true));
check(() => assert.equal(concurrencyVerdict(2, 2).allowed, false));

const minutesAgo = (n) => Date.now() - n * 60 * 1000;
check(() => assert.equal(overranMaximum(minutesAgo(1)), false));
check(() => assert.equal(overranMaximum(minutesAgo(MAX_CALL_MINUTES - 1)), false));
// At exactly the ceiling the call is over, not "nearly over".
check(() => assert.equal(overranMaximum(minutesAgo(MAX_CALL_MINUTES)), true));
check(() => assert.equal(overranMaximum(minutesAgo(MAX_CALL_MINUTES + 60)), true));
// An unparsable start time never ends a call that might be running.
check(() => assert.equal(overranMaximum(Number.NaN), false));
check(() => assert.equal(overranMaximum(0), false));

console.log(`call-limits: ${checks} assertions passed`);
