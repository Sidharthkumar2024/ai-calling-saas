/**
 * A realtime session that is actually running has to still be a reservation.
 *
 * Everything that manages one of these rows keys on `status = 'reserved'`: the
 * concurrency cap counts them ("outstanding reservations *are* the open
 * calls"), the heartbeat only moves one, the sweeper only ends one, and
 * settlement only trues one up. The route used to write `'active'` the moment
 * the provider accepted — a status this module never defined and nothing
 * anywhere reads — which took the session out of all four exactly when it
 * started costing money.
 *
 * Runs the real reservation SQL against in-memory SQLite. No provider is
 * contacted and no money moves.
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { MAX_CONCURRENT_CALLS } from '../lib/call-limits.ts';
import {
  REALTIME_CREDITS,
  heartbeatRealtime,
  markRealtimeAccepted,
  measuredSeconds,
  reserveRealtime,
} from '../lib/realtime-reservations.ts';

let checks = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks += 1;
};
const ok = (value, message) => {
  assert.ok(value, message);
  checks += 1;
};

const ORG = 'org_test';
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`
  CREATE TABLE realtime_reservations (id TEXT PRIMARY KEY, organization_id TEXT,
    agent_id TEXT, request_hash TEXT, unit TEXT, credits INTEGER, status TEXT,
    provider_reference TEXT, error_code TEXT, last_heartbeat_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE organization_wallets (organization_id TEXT PRIMARY KEY, balance INTEGER,
    updated_at TEXT);
  CREATE TABLE credit_ledger (id TEXT PRIMARY KEY, organization_id TEXT, type TEXT,
    amount INTEGER, balance_after INTEGER, reference_type TEXT, reference_id TEXT,
    description TEXT);
  CREATE TABLE agent_test_sessions (id TEXT PRIMARY KEY, organization_id TEXT,
    agent_id TEXT, mode TEXT, status TEXT, credits_used INTEGER, updated_at TEXT);
`);
sqlite.prepare('INSERT INTO organization_wallets (organization_id, balance) VALUES (?, ?)')
  .run(ORG, 10_000);

/** The slice of D1 these functions use, including a transactional batch. */
function statement(query, args = []) {
  return {
    bind: (...values) => statement(query, values),
    async first() {
      return sqlite.prepare(query).get(...args) ?? null;
    },
    async run() {
      const info = sqlite.prepare(query).run(...args);
      return { meta: { changes: Number(info.changes ?? 0) } };
    },
    _apply() {
      return sqlite.prepare(query).run(...args);
    },
  };
}
const db = {
  prepare: statement,
  async batch(statements) {
    sqlite.exec('BEGIN');
    try {
      const out = statements.map((one) => one._apply());
      sqlite.exec('COMMIT');
      return out;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  },
};

const balance = () =>
  Number(sqlite.prepare('SELECT balance FROM organization_wallets WHERE organization_id = ?').get(ORG).balance);
const statusOf = (id) =>
  sqlite.prepare('SELECT status FROM realtime_reservations WHERE id = ?').get(id)?.status;
const openCount = () =>
  Number(sqlite.prepare("SELECT count(*) AS n FROM realtime_reservations WHERE organization_id = ? AND status = 'reserved'").get(ORG).n);

const reserve = (id) =>
  reserveRealtime(db, { id, organizationId: ORG, agentId: 'agent_1', requestHash: `hash_${id}` });

// --- one session, from offer to open --------------------------------------------

const before = balance();
const first = await reserve('rt_1');
equal(first.status, 'reserved');
equal(balance(), before - REALTIME_CREDITS, 'the session is paid for up front');

// The provider accepted. This is the moment the old code changed the status.
ok(
  await markRealtimeAccepted(db, {
    id: 'rt_1',
    providerReference: 'https://api.openai.com/v1/realtime/calls/abc',
    errorCode: null,
  }),
  'accepting a reservation moves the row it was given',
);
equal(statusOf('rt_1'), 'reserved', 'a running session is still an outstanding reservation');
equal(
  sqlite.prepare('SELECT provider_reference FROM realtime_reservations WHERE id = ?').get('rt_1').provider_reference,
  'https://api.openai.com/v1/realtime/calls/abc',
  'and what changed is recorded where it belongs',
);

// THE ONE THAT WAS BROKEN. A running session's beats have to land, because the
// beats are the only evidence of how long it ran — without them every session
// bills at the floor however long it lasted.
ok(await heartbeatRealtime(db, 'rt_1', ORG), 'a running session can report itself');
const beat = sqlite.prepare('SELECT created_at, last_heartbeat_at FROM realtime_reservations WHERE id = ?').get('rt_1');
ok(beat.last_heartbeat_at, 'and the beat is recorded');
ok(measuredSeconds(beat.created_at, beat.last_heartbeat_at) >= 0, 'so a duration can be measured at all');

// Another workspace cannot beat this session.
equal(await heartbeatRealtime(db, 'rt_1', 'org_someone_else'), false);
// Nor can a beat for a session that does not exist.
equal(await heartbeatRealtime(db, 'rt_nothing', ORG), false);

// --- the cap counts what is running ---------------------------------------------

for (let n = 2; n <= MAX_CONCURRENT_CALLS; n += 1) {
  const each = await reserve(`rt_${n}`);
  equal(each.status, 'reserved', `session ${n} is within the cap`);
  await markRealtimeAccepted(db, {
    id: `rt_${n}`,
    providerReference: `ref_${n}`,
    errorCode: null,
  });
}
equal(openCount(), MAX_CONCURRENT_CALLS, 'every accepted session still counts as open');

const paidBefore = balance();
const overTheLine = await reserve('rt_over');
equal(
  overTheLine.status,
  'at_capacity',
  'the session past the cap is refused, and it is the accepted ones that fill it',
);
// Nothing is charged for a session that was refused.
equal(balance(), paidBefore, 'a refused session is not debited');
equal(
  sqlite.prepare("SELECT count(*) AS n FROM agent_test_sessions WHERE id = 'rt_over'").get().n,
  0,
  'and no test session is opened for it',
);

// --- a session with no money -----------------------------------------------------

sqlite.prepare('UPDATE organization_wallets SET balance = 3 WHERE organization_id = ?').run('org_broke');
sqlite.prepare('INSERT INTO organization_wallets (organization_id, balance) VALUES (?, ?)').run('org_broke', 3);
const broke = await reserveRealtime(db, {
  id: 'rt_broke',
  organizationId: 'org_broke',
  agentId: 'agent_1',
  requestHash: 'hash_broke',
});
equal(broke.status, 'insufficient');
equal(
  Number(sqlite.prepare('SELECT balance FROM organization_wallets WHERE organization_id = ?').get('org_broke').balance),
  3,
  'and an unaffordable session takes nothing',
);

console.log(`realtime reservations: ${checks} assertions passed; no provider contacted.`);
