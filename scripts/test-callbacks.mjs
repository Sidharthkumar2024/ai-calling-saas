import assert from 'node:assert/strict';

import {
  CALLBACK_STATUSES,
  canMoveCallback,
  DEFAULT_WINDOW_HOURS,
  isCallbackStatus,
  isOpen,
  lateness,
  nextCallbackStatuses,
  queueOrder,
  queueSummary,
} from '../lib/callbacks.ts';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

const NOW = new Date('2026-09-05T18:00:00Z');
const hoursAgo = (n) => new Date(NOW.getTime() - n * 3_600_000).toISOString();

console.log('states');

check('every status is a known status', () => {
  for (const status of CALLBACK_STATUSES) assert.equal(isCallbackStatus(status), true);
  assert.equal(isCallbackStatus('done'), false);
});

check('a waiting callback can be started or cancelled, not completed outright', () => {
  // Marking one "reached" without having called it is the shortcut this
  // prevents.
  assert.deepEqual(nextCallbackStatuses('pending'), ['in_progress', 'cancelled']);
  assert.equal(canMoveCallback('pending', 'completed'), false);
});

check('dialling is not reaching — no answer returns to the queue', () => {
  // Somebody who did not pick up at four o'clock is still owed a call.
  assert.deepEqual(nextCallbackStatuses('unreachable'), ['in_progress', 'cancelled']);
  assert.equal(isOpen('unreachable'), true);
});

check('reached and cancelled are terminal', () => {
  assert.deepEqual(nextCallbackStatuses('completed'), []);
  assert.deepEqual(nextCallbackStatuses('cancelled'), []);
  assert.equal(isOpen('completed'), false);
  assert.equal(isOpen('cancelled'), false);
});

console.log('\nlateness — a promise with a time on it can be broken');

check('a fresh request is not late', () => {
  const result = lateness({ status: 'pending', createdAt: hoursAgo(1), now: NOW });
  assert.equal(result.late, false);
});

check('waiting past the default window is late, and says how long', () => {
  const result = lateness({
    status: 'pending',
    createdAt: hoursAgo(DEFAULT_WINDOW_HOURS + 3),
    now: NOW,
  });
  assert.equal(result.late, true);
  assert.equal(result.hoursLate, 3);
  assert.match(result.message, /no call back yet/);
});

check('a stated window is honoured over the default', () => {
  const result = lateness({
    status: 'pending',
    createdAt: hoursAgo(2),
    requestedWindow: 'within 1 hour',
    now: NOW,
  });
  assert.equal(result.late, true);
  assert.match(result.message, /Promised within 1 hours/);
});

check('minutes are understood too', () => {
  const result = lateness({
    status: 'pending',
    createdAt: hoursAgo(1),
    requestedWindow: 'in 30 minutes',
    now: NOW,
  });
  assert.equal(result.late, true);
});

check('a vague window is NOT guessed into a deadline', () => {
  // Deciding what "this evening" means and then calling somebody late on that
  // guess would invent a broken promise. It falls back to the default wait.
  const soon = lateness({
    status: 'pending',
    createdAt: hoursAgo(2),
    requestedWindow: 'this evening',
    now: NOW,
  });
  assert.equal(soon.late, false);
  const later = lateness({
    status: 'pending',
    createdAt: hoursAgo(DEFAULT_WINDOW_HOURS + 1),
    requestedWindow: 'this evening',
    now: NOW,
  });
  assert.equal(later.late, true);
  assert.doesNotMatch(later.message, /evening/);
});

check('a closed callback is never late', () => {
  for (const status of ['completed', 'cancelled'])
    assert.equal(
      lateness({ status, createdAt: hoursAgo(100), now: NOW }).late,
      false,
      status,
    );
});

check('one that nobody reached IS still late', () => {
  const result = lateness({ status: 'unreachable', createdAt: hoursAgo(20), now: NOW });
  assert.equal(result.late, true);
});

check('an unreadable timestamp does not fabricate lateness', () => {
  assert.equal(lateness({ status: 'pending', createdAt: 'soon', now: NOW }).late, false);
});

console.log('\nthe order somebody should work it in');

const row = (id, status, hours, window = null) => ({
  id,
  status,
  createdAt: hoursAgo(hours),
  requestedWindow: window,
});

check('late first, then oldest — not newest first', () => {
  // A queue that surfaces the newest request buries the person waiting since
  // this morning, who is the one owed most.
  const ordered = queueOrder(
    [row('fresh', 'pending', 1), row('old', 'pending', 30), row('mid', 'pending', 6)],
    NOW,
  );
  assert.deepEqual(ordered.map((entry) => entry.id), ['old', 'mid', 'fresh']);
});

check('closed rows sink below every open one', () => {
  const ordered = queueOrder(
    [row('done', 'completed', 40), row('waiting', 'pending', 1)],
    NOW,
  );
  assert.deepEqual(ordered.map((entry) => entry.id), ['waiting', 'done']);
});

check('a no-answer stays up with the open ones', () => {
  const ordered = queueOrder(
    [row('done', 'completed', 1), row('noanswer', 'unreachable', 20)],
    NOW,
  );
  assert.equal(ordered[0].id, 'noanswer');
});

console.log('\nthe one-line summary');

check('nobody waiting says so plainly', () => {
  assert.match(queueSummary([row('a', 'completed', 2)], NOW), /Nobody is waiting/);
});

check('it counts people, and names how many are past the promise', () => {
  const summary = queueSummary(
    [row('a', 'pending', 1), row('b', 'pending', 30), row('c', 'unreachable', 40)],
    NOW,
  );
  assert.match(summary, /3 people are waiting/);
  assert.match(summary, /2 past the time promised/);
});

check('one person reads as one person', () => {
  assert.match(
    queueSummary([row('a', 'pending', 1)], NOW),
    /1 person is waiting for a call back\./,
  );
});

check('none late says nothing about lateness', () => {
  const summary = queueSummary([row('a', 'pending', 1)], NOW);
  assert.doesNotMatch(summary, /past the time/);
});

console.log(`\n${passed} assertions passed.`);
