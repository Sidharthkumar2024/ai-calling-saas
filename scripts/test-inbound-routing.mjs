/**
 * Whose inbound call this is.
 *
 * Two ways it used to end up in the wrong workspace's hands.
 *
 * A row in `phone_numbers` is a claim until a platform admin approves the
 * ownership check and the KYC — that is what `status = 'active'` means. The
 * lookup selected `status` and never read it, so a workspace could type any
 * number, land on `pending_verification`, and start receiving that number's
 * calls before proving anything.
 *
 * And the match is looser than the table's own unique index. The index is over
 * the raw text; the match strips punctuation and also accepts the last ten
 * digits. `+919812345678` and `9812345678` are two different strings, both
 * allowed, and both answer the same call — so `LIMIT 1` with no ORDER BY
 * handed the call to whichever row the table returned first.
 *
 * Compiles the real lib/inbound-routing.ts against in-memory SQLite.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { compileFunction } from 'node:vm';
import ts from 'typescript';

import * as shifts from '../lib/shifts.ts';

let checks = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks += 1;
};
const ok = (value, message) => {
  assert.ok(value, message);
  checks += 1;
};

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`
  CREATE TABLE phone_numbers (id TEXT PRIMARY KEY, organization_id TEXT,
    phone_number TEXT UNIQUE, status TEXT);
  CREATE TABLE number_routes (id TEXT PRIMARY KEY, organization_id TEXT,
    number_id TEXT, route_type TEXT, agent_id TEXT, queue_id TEXT,
    campaign_id TEXT, language TEXT, off_hours_action TEXT, status TEXT,
    priority INTEGER);
  CREATE TABLE voice_agents (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE queues (id TEXT PRIMARY KEY, slug TEXT);
  CREATE TABLE campaigns (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE shifts (id TEXT PRIMARY KEY, organization_id TEXT,
    support_agent_id TEXT, days_json TEXT, start_minute INTEGER, end_minute INTEGER,
    break_start_minute INTEGER, break_end_minute INTEGER, timezone TEXT, status TEXT);
`);

const addNumber = (id, org, phone, status) =>
  sqlite.prepare('INSERT INTO phone_numbers (id, organization_id, phone_number, status) VALUES (?,?,?,?)')
    .run(id, org, phone, status);
const addRoute = (id, org, numberId, agentId) => {
  sqlite.prepare('INSERT OR IGNORE INTO voice_agents (id, name) VALUES (?,?)').run(agentId, `Agent ${agentId}`);
  sqlite.prepare(`INSERT INTO number_routes (id, organization_id, number_id, route_type, agent_id, off_hours_action, status, priority)
    VALUES (?,?,?,'voice_agent',?,'voicemail','active',1)`).run(id, org, numberId, agentId);
};

function statement(query, args = []) {
  return {
    bind: (...values) => statement(query, values),
    async first() {
      return sqlite.prepare(query).get(...args) ?? null;
    },
    async all() {
      return { results: sqlite.prepare(query).all(...args) };
    },
    async run() {
      const info = sqlite.prepare(query).run(...args);
      return { meta: { changes: Number(info.changes ?? 0) } };
    },
  };
}

const routing = {};
compileFunction(
  ts.transpileModule(
    readFileSync(new URL('../lib/inbound-routing.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  ['require', 'exports'],
)(
  (id) => {
    const modules = {
      '@/db/index': { getRawDb: () => ({ prepare: statement }) },
      '@/lib/shifts': shifts,
      '@/lib/handoff-service': { routeToAgent: async () => null },
    };
    if (!modules[id]) throw Error(id);
    return modules[id];
  },
  routing,
);

// --- an approved number reaches its own workspace --------------------------------

addNumber('num_a', 'org_a', '+919812345678', 'active');
addRoute('route_a', 'org_a', 'num_a', 'agent_a');

const direct = await routing.resolveInboundCall({ toNumber: '+919812345678', fromNumber: '+919900000001' });
equal(direct.matched, true);
equal(direct.organizationId, 'org_a');
equal(direct.target.kind, 'voice_agent');
// Punctuation and a missing plus are the carrier's business, not the
// customer's. (A leading national `0` is NOT matched, and never was: the
// last-ten fallback compares the caller's tail against the *stored* number in
// full, so it only helps when the stored row is the ten-digit form. Left
// alone deliberately — widening it would match every number on earth ending
// in the same ten digits, which is the collision this file is about.)
equal((await routing.resolveInboundCall({ toNumber: '919812345678', fromNumber: '+91' })).organizationId, 'org_a');
equal((await routing.resolveInboundCall({ toNumber: '+91 98123-45678', fromNumber: '+91' })).organizationId, 'org_a');

// --- a claim is not a holding -----------------------------------------------------

// THE ONE THAT MATTERED. Another workspace types the same number in a shape
// the unique index does not consider the same, and has proved nothing.
addNumber('num_b', 'org_b', '9812345678', 'pending_verification');
const stillMine = await routing.resolveInboundCall({ toNumber: '+919812345678', fromNumber: '+919900000001' });
equal(stillMine.organizationId, 'org_a', 'an unverified claim does not take a live number');

// And on its own, an unverified number is nobody's.
sqlite.prepare('DELETE FROM phone_numbers WHERE id = ?').run('num_a');
const unverified = await routing.resolveInboundCall({ toNumber: '+919812345678', fromNumber: '+919900000001' });
equal(unverified.matched, false);
equal(unverified.action, 'unknown_number');

// Every status short of approval is a claim: this is the whole ladder.
for (const status of ['pending_verification', 'kyc_required', 'kyc_review', 'pending_activation', 'kyc_rejected']) {
  sqlite.prepare('UPDATE phone_numbers SET status = ? WHERE id = ?').run(status, 'num_b');
  const verdict = await routing.resolveInboundCall({ toNumber: '+919812345678', fromNumber: '+91' });
  equal(verdict.matched, false, `${status} does not receive calls`);
}

// --- two workspaces nobody can tell apart ----------------------------------------

// The unique index is over the raw text, so `+919812345678` and
// `919812345678` are two rows the database is happy to hold — and they
// normalise to the same number. Both answer the same call.
sqlite.prepare('DELETE FROM phone_numbers').run();
addNumber('num_a2', 'org_a', '+919812345678', 'active');
addRoute('route_a2', 'org_a', 'num_a2', 'agent_a');
addNumber('num_c', 'org_c', '919812345678', 'active');
addRoute('route_c', 'org_c', 'num_c', 'agent_c');
const ambiguous = await routing.resolveInboundCall({ toNumber: '+919812345678', fromNumber: '+91' });
equal(ambiguous.matched, false, 'a call two workspaces answer is not given to either');
equal(ambiguous.action, 'ambiguous_number');
ok(ambiguous.reason.includes('more than one workspace'));

// The number actually dialled beats a workspace holding only its last ten
// digits — that fallback is a tolerance, not a claim of equal standing.
sqlite.prepare('DELETE FROM phone_numbers WHERE id = ?').run('num_c');
addNumber('num_tail', 'org_tail', '9812345678', 'active');
addRoute('route_tail', 'org_tail', 'num_tail', 'agent_tail');
const exact = await routing.resolveInboundCall({ toNumber: '+919812345678', fromNumber: '+91' });
equal(exact.matched, true, 'the number that was actually dialled wins');
equal(exact.organizationId, 'org_a');

// And with only the ten-digit row present, the tolerance still does its job.
sqlite.prepare('DELETE FROM phone_numbers WHERE id = ?').run('num_a2');
const byTail = await routing.resolveInboundCall({ toNumber: '+919812345678', fromNumber: '+91' });
equal(byTail.matched, true);
equal(byTail.organizationId, 'org_tail');

console.log(`inbound routing: ${checks} assertions passed.`);
