import assert from 'node:assert/strict';

import {
  parseResult,
  silentRun,
  summariseSilentRuns,
} from '../lib/job-outcomes.ts';

let checks = 0;
const check = (fn) => {
  fn();
  checks += 1;
};

check(() => assert.deepEqual(parseResult('{"a":1}'), { a: 1 }));
check(() => assert.equal(parseResult('not json'), null));
check(() => assert.equal(parseResult(null), null));
// A list is not a result object.
check(() => assert.equal(parseResult('[1,2]'), null));

// THE CASE THIS EXISTS FOR, taken from a real run: the reminder job found an
// appointment due, could not send because the workspace has no WhatsApp
// connection, and left the row unmarked so the reminder is still owed. Status
// `completed`, and nowhere for anybody to see it.
const real = silentRun('appointments.remind', {
  considered: 1,
  sent: 0,
  skipped: 1,
});
check(() => assert.ok(real));
check(() => assert.equal(real.skipped, 1));
check(() => assert.match(real.message, /appointment reminder run/));
check(() => assert.match(real.message, /left 1 undone/));
// Says the likely cause, because "nothing failed" is exactly why nobody looked.
check(() => assert.match(real.message, /has not connected/));

// Nothing to do is not the same as nothing done. A quiet queue must not turn
// the panel amber.
check(() =>
  assert.equal(
    silentRun('appointments.remind', { considered: 0, sent: 0, skipped: 0 }),
    null,
  ),
);
// Work found and done is not a finding either.
check(() =>
  assert.equal(
    silentRun('appointments.remind', { considered: 3, sent: 3, skipped: 0 }),
    null,
  ),
);
check(() => assert.equal(silentRun('appointments.remind', null), null));
// A result shape this rule does not know about says nothing rather than guessing.
check(() => assert.equal(silentRun('retention.enforce', { deleted: 0 }), null));
// `failed` counts as undone too — the delivery worker reports it separately.
const delivery = silentRun('messages.deliver', {
  considered: 4,
  sent: 1,
  sandbox: 0,
  failed: 3,
});
check(() => assert.equal(delivery.skipped, 3));
check(() => assert.match(delivery.message, /message delivery run/));

// A run that skips every hour is one problem reported twenty-four times.
const summary = summariseSilentRuns([
  {
    type: 'appointments.remind',
    result: '{"considered":1,"sent":0,"skipped":1}',
  },
  {
    type: 'appointments.remind',
    result: '{"considered":2,"sent":0,"skipped":2}',
  },
  {
    type: 'appointments.remind',
    result: '{"considered":0,"sent":0,"skipped":0}',
  },
  { type: 'messages.deliver', result: '{"considered":9,"sent":0,"failed":9}' },
  { type: 'retention.enforce', result: '{"deleted":4}' },
  { type: 'broken', result: 'not json' },
]);
check(() => assert.equal(summary.length, 2));
// Ordered by how much is going undone, so the worst is first.
check(() => assert.equal(summary[0].type, 'messages.deliver'));
check(() => assert.equal(summary[0].skipped, 9));
check(() => assert.equal(summary[1].type, 'appointments.remind'));
check(() => assert.equal(summary[1].runs, 2));
check(() => assert.equal(summary[1].skipped, 3));
check(() => assert.equal(summary[1].considered, 3));
check(() => assert.deepEqual(summariseSilentRuns([]), []));

console.log(`job-outcomes: ${checks} assertions passed`);
