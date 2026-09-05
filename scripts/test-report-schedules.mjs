import assert from 'node:assert/strict';

import {
  checkRecipients,
  describeDelivery,
  describeSchedule,
  isDue,
  isReportSchedule,
  MAX_RECIPIENTS,
  nextRunAt,
  REPORT_SCHEDULES,
} from '../lib/report-schedules.ts';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

const NOW = new Date('2026-09-05T10:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

console.log('the cadence is honoured — this is the bug that was here');

check('a monthly report is NOT due two days after its last run', () => {
  // The scheduler used to ask for anything older than one day whatever the
  // schedule said, so a monthly report ran daily.
  assert.equal(
    isDue({ schedule: 'monthly', lastGeneratedAt: daysAgo(2), now: NOW }),
    false,
  );
});

check('a weekly report is not due on day 6 and is due on day 7', () => {
  assert.equal(isDue({ schedule: 'weekly', lastGeneratedAt: daysAgo(6), now: NOW }), false);
  assert.equal(isDue({ schedule: 'weekly', lastGeneratedAt: daysAgo(7), now: NOW }), true);
});

check('a daily report is due after a day', () => {
  assert.equal(isDue({ schedule: 'daily', lastGeneratedAt: daysAgo(1), now: NOW }), true);
  assert.equal(
    isDue({ schedule: 'daily', lastGeneratedAt: daysAgo(0.5), now: NOW }),
    false,
  );
});

check('a manual report never becomes due on its own', () => {
  assert.equal(isDue({ schedule: 'manual', lastGeneratedAt: null, now: NOW }), false);
  assert.equal(isDue({ schedule: 'manual', lastGeneratedAt: daysAgo(400), now: NOW }), false);
});

check('a report that has never run is due at once', () => {
  // Otherwise a weekly report created today sits doing nothing for a week and
  // looks broken.
  for (const schedule of ['daily', 'weekly', 'monthly'])
    assert.equal(isDue({ schedule, lastGeneratedAt: null, now: NOW }), true, schedule);
});

check("SQLite's own timestamp shape is read as UTC, not local time", () => {
  // CURRENT_TIMESTAMP writes "YYYY-MM-DD HH:MM:SS" with no zone. Parsed as
  // local time this has already made a session look expired in this codebase.
  const sqliteTimestamp = '2026-09-04 10:00:00'; // exactly one day before NOW
  assert.equal(
    isDue({ schedule: 'daily', lastGeneratedAt: sqliteTimestamp, now: NOW }),
    true,
  );
  assert.equal(
    isDue({ schedule: 'weekly', lastGeneratedAt: sqliteTimestamp, now: NOW }),
    false,
  );
});

check('an unreadable timestamp makes it due rather than never', () => {
  assert.equal(isDue({ schedule: 'weekly', lastGeneratedAt: 'soon', now: NOW }), true);
});

console.log('\nwhen it next runs');

check('a report already overdue runs now, not in the past', () => {
  const next = nextRunAt({ schedule: 'weekly', lastGeneratedAt: daysAgo(30), now: NOW });
  assert.equal(next.getTime(), NOW.getTime());
});

check('a report not yet due names its actual date', () => {
  const next = nextRunAt({ schedule: 'weekly', lastGeneratedAt: daysAgo(2), now: NOW });
  assert.equal(next.toISOString().slice(0, 10), '2026-09-10');
});

check('a manual report has no next run at all', () => {
  assert.equal(nextRunAt({ schedule: 'manual', lastGeneratedAt: null, now: NOW }), null);
});

console.log('\nthe schedule is a closed set');

check('the known cadences are accepted and nothing else is', () => {
  for (const schedule of REPORT_SCHEDULES) assert.equal(isReportSchedule(schedule), true);
  // "fortnightly" used to save happily and then run daily.
  for (const bad of ['fortnightly', 'hourly', '', null, 7])
    assert.equal(isReportSchedule(bad), false, String(bad));
});

check('every cadence describes itself', () => {
  for (const schedule of REPORT_SCHEDULES)
    assert.ok(describeSchedule(schedule).length > 5, schedule);
});

console.log('\nrecipients');

check('addresses are lowercased and kept', () => {
  const result = checkRecipients('Ops@Example.com, finance@example.com');
  assert.deepEqual(result.valid, ['ops@example.com', 'finance@example.com']);
  assert.deepEqual(result.rejected, []);
});

check('a list is accepted as well as a line of text', () => {
  assert.deepEqual(checkRecipients(['a@b.co']).valid, ['a@b.co']);
});

check('a bad address is reported, not silently dropped', () => {
  // Someone who mistypes one of four should learn which one.
  const result = checkRecipients('ops@example.com, notanemail, finance@example.com');
  assert.equal(result.valid.length, 2);
  assert.deepEqual(result.rejected, [
    { value: 'notanemail', reason: 'Not an email address.' },
  ]);
});

check('a duplicate is reported rather than mailed twice', () => {
  const result = checkRecipients('ops@example.com, OPS@example.com');
  assert.equal(result.valid.length, 1);
  assert.match(result.rejected[0].reason, /twice/);
});

check(`more than ${MAX_RECIPIENTS} is refused with the count`, () => {
  const many = Array.from({ length: MAX_RECIPIENTS + 2 }, (_, i) => `p${i}@example.com`);
  const result = checkRecipients(many);
  assert.equal(result.valid.length, MAX_RECIPIENTS);
  assert.equal(result.rejected.length, 2);
  assert.match(result.rejected[0].reason, new RegExp(String(MAX_RECIPIENTS)));
});

check('empty input is no recipients, not an error', () => {
  assert.deepEqual(checkRecipients('').valid, []);
  assert.deepEqual(checkRecipients(null).rejected, []);
});

console.log('\ndelivery says what actually happened');

check('sandbox is not dressed up as sent', () => {
  // A workspace with no email provider connected must not believe its Monday
  // report is landing in an inbox.
  const sandbox = describeDelivery('sandbox', 3);
  assert.match(sandbox, /No email provider is connected/);
  assert.doesNotMatch(sandbox, /emailed to/);
});

check('sent names the count', () => {
  assert.match(describeDelivery('sent', 2), /emailed to 2 recipients/);
  assert.match(describeDelivery('sent', 1), /1 recipient\./);
});

check('no recipients reads as a choice, not a failure', () => {
  assert.match(describeDelivery('no_recipients', 0), /Nobody is listed/);
});

check('a refused delivery still points at the report', () => {
  assert.match(describeDelivery('failed', 1), /still here to download/);
});

console.log(`\n${passed} assertions passed.`);
