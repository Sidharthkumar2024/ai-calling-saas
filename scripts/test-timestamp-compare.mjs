/**
 * The sweep that closes a call nobody hung up.
 *
 * `call_records.started_at` is written by `new Date().toISOString()` —
 * `2026-09-11T07:56:13.000Z`. The sweep compared it against
 * `datetime('now', '-90 minutes')`, which is `2026-09-11 06:26:13`. SQLite has
 * no date type, so that is a comparison of strings, and `'T'` sorts above
 * `' '`: an ISO timestamp never looks older than a same-day SQLite one,
 * whatever the clock says. The ninety-minute ceiling therefore did nothing
 * until the date rolled over in UTC, and an abandoned call kept counting
 * toward concurrency and billing for the rest of the day.
 *
 * The statement is read out of the module rather than copied here, so a copy
 * cannot drift into passing after the original changes.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

let checks = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks += 1;
};
const ok = (value, message) => {
  assert.ok(value, message);
  checks += 1;
};

// --- the property underneath ------------------------------------------------------

const db = new DatabaseSync(':memory:');
const compare = (left, right) =>
  Boolean(db.prepare('SELECT ? <= ? AS yes').get(left, right).yes);
const normalised = (left, right) =>
  Boolean(db.prepare('SELECT datetime(?) <= datetime(?) AS yes').get(left, right).yes);

// Two hours earlier in real time, and it does not compare as earlier.
ok(
  !compare('2026-09-11T07:56:13.000Z', '2026-09-11 09:56:13'),
  'an ISO timestamp never sorts below a same-day SQLite one',
);
ok(normalised('2026-09-11T07:56:13.000Z', '2026-09-11 09:56:13'), 'datetime() fixes it');
// Across a date boundary it happened to work, which is why this was invisible.
ok(compare('2026-09-10T23:00:00.000Z', '2026-09-11 06:00:00'), 'yesterday sorted fine');
// And the offset shape one column actually holds.
equal(
  db.prepare("SELECT datetime('2026-09-01T20:00:00+05:30') AS v").get().v,
  '2026-09-01 14:30:00',
  'datetime() reads an offset too, and converts it',
);

// --- the statement the sweep actually runs ----------------------------------------

const source = readFileSync(new URL('../lib/call-telemetry.ts', import.meta.url), 'utf8');
const match = source.match(/`(SELECT c\.id, c\.channel FROM call_records c[\s\S]*?LIMIT 50)`/);
ok(match, 'the idle sweep still has one statement');
const SWEEP = match[1];

db.exec(`
  CREATE TABLE call_records (id TEXT PRIMARY KEY, organization_id TEXT, channel TEXT,
    status TEXT, started_at TEXT);
  CREATE TABLE call_turns (id TEXT PRIMARY KEY, call_id TEXT, created_at TEXT);
`);
const ORG = 'org_test';
const addCall = (id, startedAt, status = 'in_progress') =>
  db.prepare('INSERT INTO call_records (id, organization_id, channel, status, started_at) VALUES (?,?,?,?,?)')
    .run(id, ORG, 'playground', status, startedAt);
const sweep = (idleMinutes, maxMinutes) =>
  db.prepare(SWEEP).all(ORG, `-${idleMinutes} minutes`, `-${maxMinutes} minutes`).map((row) => row.id);

// A call started three hours ago, stamped the way this product stamps it.
const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
addCall('call_abandoned', threeHoursAgo);
ok(sweep(15, 90).includes('call_abandoned'), 'a three-hour-old call is swept');

// One started a minute ago is not.
addCall('call_fresh', new Date(Date.now() - 60_000).toISOString());
ok(!sweep(15, 90).includes('call_fresh'), 'a call a minute old is left alone');

// A call kept alive by turns is held by the ceiling, not by the idle window.
addCall('call_chatty', threeHoursAgo);
db.prepare('INSERT INTO call_turns (id, call_id, created_at) VALUES (?,?,?)')
  .run('turn_1', 'call_chatty', new Date(Date.now() - 30_000).toISOString());
ok(!sweep(15, 240).includes('call_chatty'), 'recent turns keep it out of the idle window');
ok(sweep(15, 90).includes('call_chatty'), 'but the ninety-minute ceiling still ends it');

// A finished call is not swept again.
addCall('call_done', threeHoursAgo, 'completed');
ok(!sweep(15, 90).includes('call_done'));

// Another workspace's call is not this workspace's to close.
db.prepare('INSERT INTO call_records (id, organization_id, channel, status, started_at) VALUES (?,?,?,?,?)')
  .run('call_theirs', 'org_other', 'playground', 'in_progress', threeHoursAgo);
ok(!sweep(15, 90).includes('call_theirs'));

console.log(`timestamp compare: ${checks} assertions passed.`);
