/**
 * A carrier's word for a call, and what this product does with it.
 *
 * The normaliser turned spaces into underscores and nothing else, so Exotel's
 * own `no-answer` matched nothing and fell through to `processing`: a call
 * nobody picked up, recorded for ever as still being worked on, and with no
 * end time, because the end time is only stamped for a terminal status.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import {
  TERMINAL_CALL_STATUSES,
  TERMINAL_SQL_LIST,
  isTerminalCallStatus,
  normaliseCallStatus,
} from '../lib/telephony-status.ts';

let checks = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks += 1;
};
const ok = (value, message) => {
  assert.ok(value, message);
  checks += 1;
};

// THE ONE THAT WAS BROKEN. Exotel writes it with a hyphen.
equal(normaliseCallStatus('no-answer'), 'no_answer');
equal(normaliseCallStatus('no answer'), 'no_answer');
equal(normaliseCallStatus('NoAnswer'), 'no_answer');
equal(normaliseCallStatus('NO_ANSWER'), 'no_answer');
ok(
  isTerminalCallStatus(normaliseCallStatus('no-answer')),
  'and it ends the call',
);

// The ones that already worked keep working.
for (const status of [
  'completed',
  'failed',
  'busy',
  'queued',
  'ringing',
  'in_progress',
])
  equal(normaliseCallStatus(status), status);
equal(normaliseCallStatus('in progress'), 'in_progress');
equal(normaliseCallStatus('  Completed  '), 'completed');

// Words a carrier says its own way.
equal(normaliseCallStatus('answered'), 'completed');
equal(normaliseCallStatus('cancelled'), 'failed');
equal(normaliseCallStatus('unanswered'), 'no_answer');

// A word this product does not know is not guessed into a terminal state:
// 'processing' says the call is not over as far as anyone here can tell.
equal(normaliseCallStatus('something-else'), 'processing');
equal(normaliseCallStatus(''), 'processing');
equal(normaliseCallStatus(null), 'processing');
equal(normaliseCallStatus(undefined), 'processing');
equal(
  isTerminalCallStatus('processing'),
  false,
  'so it never stamps an end time',
);

// The terminal set has one definition, and the SQL list is made from it.
equal(isTerminalCallStatus('completed'), true);
equal(isTerminalCallStatus('ringing'), false);
for (const status of TERMINAL_CALL_STATUSES)
  ok(TERMINAL_SQL_LIST.includes(`'${status}'`), `${status} is in the SQL list`);
ok(!TERMINAL_SQL_LIST.includes("'processing'"));

// --- the statement the webhook actually runs --------------------------------------
//
// The rest of this defect lives in SQL, so the SQL is what gets run. The
// statement is read out of the route rather than copied here: a copy would go
// on passing after the original changed.
const routeSource = readFileSync(
  new URL('../app/api/webhooks/telephony/exotel/route.ts', import.meta.url),
  'utf8',
);
const match = routeSource.match(
  /`(UPDATE call_records SET[\s\S]*?WHERE id = \?)`/,
);
ok(match, 'the webhook still has one UPDATE over call_records');
const UPDATE = match[1].replace(/\$\{TERMINAL_SQL_LIST\}/g, TERMINAL_SQL_LIST);
ok(!UPDATE.includes('${'), 'and nothing else in it is interpolated at runtime');

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`
  CREATE TABLE call_records (id TEXT PRIMARY KEY, status TEXT, duration_seconds INTEGER,
    recording_status TEXT, recording_storage_key TEXT, recording_url TEXT,
    analysis_json TEXT DEFAULT '{}', ended_at TEXT, provider_reference TEXT);
`);
const seed = (over = {}) => {
  sqlite.prepare('DELETE FROM call_records').run();
  sqlite
    .prepare(`INSERT INTO call_records (id, status, duration_seconds, recording_status,
      recording_storage_key, recording_url, analysis_json, ended_at) VALUES (?,?,?,?,?,?,'{}',?)`)
    .run(
      'call_1',
      over.status ?? 'in_progress',
      over.duration ?? 0,
      over.recordingStatus ?? 'pending',
      over.key ?? null,
      over.url ?? null,
      over.endedAt ?? null,
    );
};
const callback = (over = {}) =>
  sqlite.prepare(UPDATE).run(
    over.status ?? 'completed',
    over.status ?? 'completed',
    over.duration ?? 0,
    over.duration ?? 0,
    over.recordingStatus ?? 'pending',
    over.key ?? null,
    over.url ?? null,
    over.providerReference ?? 'sid_1',
    // Twice: the carrier's call id goes onto the column as well as into the
    // analysis blob. Only inbound rows ever carried it, so a callback that
    // named its own call id and nothing of ours could not find an outbound
    // call at all.
    over.providerReference ?? 'sid_1',
    over.status ?? 'completed',
    'call_1',
  );
const row = () =>
  sqlite.prepare('SELECT * FROM call_records WHERE id = ?').get('call_1');

// A call finishes.
seed();
callback({
  status: 'completed',
  duration: 42,
  recordingStatus: 'stored',
  key: 'k1',
  url: 'https://rec/1',
});
equal(row().status, 'completed');
equal(row().duration_seconds, 42);
ok(row().ended_at, 'and its end is stamped');
equal(
  row().provider_reference,
  'sid_1',
  'the carrier call id lands on the column, not only in the blob',
);
const endedFirst = row().ended_at;

// THE REWIND. A stray late `ringing` used to put it back on the air.
callback({ status: 'ringing' });
equal(row().status, 'completed', 'a finished call is not moved backwards');
equal(
  row().recording_status,
  'stored',
  'and a stored recording is not un-published',
);
equal(row().recording_storage_key, 'k1');
equal(row().duration_seconds, 42, 'nor is a known duration replaced with zero');
equal(
  row().ended_at,
  endedFirst,
  'the end time is the first one, not the latest callback',
);

// A later terminal callback may still correct a terminal call.
callback({ status: 'failed', duration: 50 });
equal(row().status, 'failed');
equal(row().duration_seconds, 50);

// An unknown word never ends a call.
seed();
callback({ status: 'processing' });
equal(row().status, 'processing');
equal(row().ended_at, null, 'processing stamps no end');

// A live call still moves forward normally.
seed({ status: 'queued' });
callback({ status: 'ringing' });
equal(row().status, 'ringing');
callback({ status: 'in_progress' });
equal(row().status, 'in_progress');

// A second callback fills in what the first lacked.
seed({
  status: 'completed',
  duration: 30,
  recordingStatus: 'pending',
  endedAt: '2026-09-11 10:00:00',
});
callback({
  status: 'completed',
  recordingStatus: 'stored',
  key: 'k2',
  url: 'https://rec/2',
});
equal(row().recording_status, 'stored');
equal(row().recording_storage_key, 'k2');
equal(
  row().duration_seconds,
  30,
  'and a zero duration does not erase the one on record',
);

console.log(`telephony status: ${checks} assertions passed.`);
