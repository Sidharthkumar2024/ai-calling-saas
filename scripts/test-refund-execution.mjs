/**
 * One approved refund, one movement of money.
 *
 * The row guard stops a resubmission whenever the provider reference is known.
 * The case it cannot stop is the one the code's own catch block describes: the
 * provider accepted the refund and the connection died before we learned of
 * it. The row stays `requested` with no reference, and the next retry created
 * a second refund — real money, twice.
 *
 * A comment claimed Razorpay de-duplicated on the idempotency header being
 * sent. The header was `x-payment-idempotency-key`, which is not one of
 * Razorpay's, so nothing de-duplicated anything.
 *
 * Compiles the real lib/refund-execution.ts against in-memory SQLite and a
 * stubbed provider. No network call leaves this file.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { compileFunction } from 'node:vm';
import ts from 'typescript';

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
const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE refunds (id TEXT PRIMARY KEY, organization_id TEXT, order_reference TEXT,
    amount INTEGER, currency TEXT, reason TEXT, status TEXT, provider TEXT,
    provider_reference TEXT, failure_reason TEXT, confirmed_at TEXT);
  CREATE TABLE payment_reconciliations (id TEXT PRIMARY KEY, organization_id TEXT, provider TEXT,
    external_id TEXT, entity_type TEXT, entity_id TEXT, amount INTEGER, currency TEXT,
    status TEXT, mismatch_reason TEXT, reconciled_at TEXT,
    UNIQUE(provider, external_id));
`);

function statement(query, args = []) {
  return {
    bind: (...values) => statement(query, values),
    async first() {
      return db.prepare(query).get(...args) ?? null;
    },
    async all() {
      return { results: db.prepare(query).all(...args) };
    },
    async run() {
      const info = db.prepare(query).run(...args);
      return { meta: { changes: Number(info.changes ?? 0) } };
    },
  };
}

/** What the fake Razorpay holds, and every call made to it. */
let provider = { refunds: [], createFails: null, listFails: false };
const calls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const target = typeof url === 'string' ? url : (url?.url ?? '');
  const method = init?.method ?? 'GET';
  calls.push({ target, method, headers: init?.headers ?? {} });
  if (method === 'GET' && target.includes('/refunds')) {
    if (provider.listFails) throw new Error('list unreachable');
    return { ok: true, status: 200, json: async () => ({ items: provider.refunds }) };
  }
  if (method === 'POST' && target.includes('/refund')) {
    if (provider.createFails) throw new Error(provider.createFails);
    const body = JSON.parse(String(init?.body ?? '{}'));
    const made = {
      id: `rfnd_${provider.refunds.length + 1}`,
      status: 'processed',
      notes: body.notes,
    };
    provider.refunds.push(made);
    return { ok: true, status: 200, json: async () => made };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

const modules = {
  '@/db/index': { getRawDb: () => ({ prepare: statement }) },
  '@/lib/commerce': {
    getRazorpayCredentials: async () => ({
      keyId: 'rzp_test',
      keySecret: 'secret',
      source: 'tenant',
    }),
  },
};

const execution = {};
compileFunction(
  ts.transpileModule(
    readFileSync(new URL('../lib/refund-execution.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  ['require', 'exports', 'crypto'],
)(
  (id) => {
    if (!modules[id]) throw Error(id);
    return modules[id];
  },
  execution,
  globalThis.crypto,
);

const REFUND = 'refund_1';
const setup = () => {
  db.prepare('DELETE FROM refunds').run();
  db.prepare('DELETE FROM payment_reconciliations').run();
  provider = { refunds: [], createFails: null, listFails: false };
  calls.length = 0;
  db.prepare(`INSERT INTO refunds (id, organization_id, order_reference, amount, currency, reason, status)
    VALUES (?,?,?,?,?,?,'requested')`).run(REFUND, ORG, 'pay_abc', 50000, 'INR', 'Cancelled order');
  db.prepare(`INSERT INTO payment_reconciliations (id, organization_id, provider, external_id, entity_type, entity_id, amount, currency, status)
    VALUES (?,?,'razorpay',?,'payment_link',?,?,?,'matched')`).run('rec_1', ORG, 'pay_abc', 'paylink_1', 60000, 'INR');
};
const run = () => execution.executeRefund({ organizationId: ORG, refundId: REFUND });
const row = () => db.prepare('SELECT status, provider_reference FROM refunds WHERE id = ?').get(REFUND);
const created = () => calls.filter((call) => call.method === 'POST').length;

// --- an ordinary refund -----------------------------------------------------------

setup();
const first = await run();
equal(first.ok, true);
equal(created(), 1, 'one refund is created');
equal(row().status, 'succeeded');
ok(row().provider_reference, 'and the reference is written down');
// The header Razorpay actually reads.
const post = calls.find((call) => call.method === 'POST');
ok(
  'x-razorpay-idempotency-key' in post.headers,
  "the provider's own idempotency header is sent",
);
ok(
  !('x-payment-idempotency-key' in post.headers),
  'and not one it has never heard of',
);

// A second call is stopped by the row itself, as it always was.
const again = await run();
equal(created(), 1, 'a refund with a reference is never sent again');
ok(String(again.reason ?? '').includes('Already submitted'));

// --- THE ONE THAT MATTERED --------------------------------------------------------
//
// The provider accepted it and the connection died before we heard. The row is
// still `requested` with no reference, so the row guard cannot help.
setup();
provider.createFails = 'socket hang up';
const lost = await run();
equal(lost.ok, false, 'the caller is told it was not confirmed');
equal(row().status, 'requested', 'and the row stays retryable');
// The provider did get it, even though we never learned the id.
provider.refunds.push({
  id: 'rfnd_ghost',
  status: 'processed',
  notes: { refund_id: REFUND, organization_id: ORG },
});
provider.createFails = null;

const retry = await run();
equal(created(), 1, 'the retry does not create a second refund');
equal(retry.providerReference, 'rfnd_ghost', 'it adopts the one already made');
equal(row().provider_reference, 'rfnd_ghost');
equal(row().status, 'succeeded');
ok(String(retry.reason ?? '').includes('already reached the provider'));

// --- somebody else's refund against the same payment ------------------------------

setup();
provider.refunds.push({ id: 'rfnd_dashboard', status: 'processed', notes: {} });
await run();
equal(created(), 1, 'a refund raised elsewhere is not adopted as ours');
ok(row().provider_reference !== 'rfnd_dashboard');

// --- the lookup itself failing ----------------------------------------------------

// It must not block a refund somebody approved: falling back to submitting is
// the behaviour there was before the lookup existed.
setup();
provider.listFails = true;
const blind = await run();
equal(blind.ok, true, 'an unreachable lookup does not stop the refund');
equal(created(), 1);

globalThis.fetch = originalFetch;
console.log(`refund execution: ${checks} assertions passed; no provider contacted.`);
