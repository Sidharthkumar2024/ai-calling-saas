/**
 * One debt, one payment link.
 *
 * A scheduled payment job used to send first and mark the action completed
 * afterwards, with nothing re-read in between. Two overlapping cron requests —
 * or one lease that expired while the provider was slow — both found a pending
 * action and both sent, so the customer received two links for the same amount
 * and could not tell which one to pay.
 *
 * Compiles the real lib/job-queue.ts against in-memory SQLite. No provider is
 * contacted.
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
  CREATE TABLE scheduled_actions (id TEXT PRIMARY KEY, organization_id TEXT, action_type TEXT,
    payload_json TEXT, status TEXT DEFAULT 'pending', attempt_count INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 5, scheduled_for TEXT, completed_at TEXT, last_error TEXT);
  CREATE TABLE payment_links (id TEXT PRIMARY KEY, organization_id TEXT, customer_phone TEXT,
    customer_name TEXT, amount INTEGER, short_url TEXT, status TEXT);
  CREATE TABLE outbound_messages (id TEXT PRIMARY KEY, organization_id TEXT, payment_link_id TEXT,
    channel TEXT, destination TEXT, message_body TEXT, status TEXT, provider_reference TEXT,
    sent_at TEXT, scheduled_for TEXT);
  CREATE TABLE whatsapp_messages (id TEXT PRIMARY KEY, organization_id TEXT, phone_number_id TEXT,
    direction TEXT, sender_phone TEXT, body TEXT, provider_reference TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE background_jobs (id TEXT PRIMARY KEY, organization_id TEXT, queue TEXT DEFAULT 'default',
    type TEXT, idempotency_key TEXT UNIQUE, payload_json TEXT DEFAULT '{}', status TEXT,
    attempts INTEGER DEFAULT 0, max_attempts INTEGER DEFAULT 3, priority INTEGER DEFAULT 50,
    available_at TEXT, locked_at TEXT, locked_by TEXT, last_error TEXT, dead_lettered_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE job_attempts (id TEXT PRIMARY KEY, job_id TEXT, attempt INTEGER, status TEXT,
    duration_ms INTEGER, result_json TEXT, error TEXT);
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

/** Every payment link the queue tried to send. */
const sent = [];
let sendFails = false;

const stub = new Proxy({}, { get: () => async () => ({}) });
const modules = {
  '@/db/index': {
    getRawDb: () => ({
      prepare: statement,
      batch: async (statements) => {
        for (const entry of statements) await entry.run();
        return [];
      },
    }),
  },
  '@/lib/appointment-service': stub,
  '@/lib/call-outcomes': { isCallOutcome: () => false, CONVERSION_SQL_LIST: "''" },
  '@/lib/report-datasets': { datasetFor: () => 'calls', unknownReportMessage: () => '' },
  '@/lib/sales-intelligence-service': stub,
  '@/lib/job-enqueue': { enqueueJob: async () => ({}) },
  '@/lib/provider-adapters': stub,
  '@/lib/call-telemetry': stub,
  '@/lib/campaign-dialer': stub,
  '@/lib/commerce': {
    sendTransactionalEmail: async () => ({ status: 'sent', providerReference: 'email_1' }),
    sendWhatsAppText: async () => ({ status: 'sent', providerReference: 'wamid_1' }),
    sendWhatsAppPaymentLink: async (input) => {
      if (sendFails) throw new Error('Provider is unreachable.');
      sent.push(input);
      return { status: 'sent', providerReference: `pl_${sent.length}` };
    },
  },
  '@/lib/security': { decryptSecret: async (v) => v },
  '@/lib/workflow-engine': { executeGraph: async () => ({}), parseGraph: () => null },
  '@/lib/report-schedules': {
    checkRecipients: () => ({}),
    isDue: () => false,
    isReportSchedule: () => false,
  },
  'cloudflare:workers': { env: {} },
};

const queue = {};
compileFunction(
  ts.transpileModule(
    readFileSync(new URL('../lib/job-queue.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  ['require', 'exports', 'crypto'],
)(
  (id) => {
    if (!modules[id]) throw Error(id);
    return modules[id];
  },
  queue,
  globalThis.crypto,
);

const ACTION = 'action_1';
const LINK = 'paylink_1';
const setup = () => {
  db.prepare('DELETE FROM scheduled_actions').run();
  db.prepare('DELETE FROM payment_links').run();
  db.prepare('DELETE FROM outbound_messages').run();
  db.prepare('DELETE FROM background_jobs').run();
  db.prepare('DELETE FROM whatsapp_messages').run();
  sent.length = 0;
  db.prepare(`INSERT INTO scheduled_actions (id, organization_id, action_type, payload_json, status)
    VALUES (?,?,'payment_link','{}','pending')`).run(ACTION, ORG);
  db.prepare(`INSERT INTO payment_links (id, organization_id, customer_phone, customer_name, amount, short_url, status)
    VALUES (?,?,?,?,?,?,'scheduled')`).run(LINK, ORG, '+919812345678', 'Asha', 450000, 'https://rzp.io/i/abc');
  db.prepare(`INSERT INTO outbound_messages (id, organization_id, payment_link_id, channel, destination, message_body, status)
    VALUES (?,?,?,'whatsapp',?,?, 'scheduled')`).run('msg_1', ORG, LINK, '+919812345678', 'Your link');
};
const addJob = (id) =>
  db.prepare(`INSERT INTO background_jobs (id, organization_id, queue, type, idempotency_key, payload_json, status, priority, available_at)
    VALUES (?,?,'messaging','scheduled.send_payment_link',?,?, 'queued', 50, datetime('now','-1 minute'))`).run(
    id,
    ORG,
    id,
    JSON.stringify({ paymentLinkId: LINK, actionId: ACTION }),
  );
const action = () => db.prepare('SELECT status, attempt_count, completed_at FROM scheduled_actions WHERE id = ?').get(ACTION);

// --- one job, one link ------------------------------------------------------------

setup();
addJob('job_1');
await queue.processJobs({ limit: 5 });
equal(sent.length, 1, 'the link goes out once');
equal(action().status, 'completed');
equal(action().attempt_count, 1, 'and the attempt is counted');
equal(db.prepare('SELECT status FROM payment_links WHERE id = ?').get(LINK).status, 'sent');

// THE ONE THAT MATTERED. A second drainer finds the same action.
addJob('job_2');
await queue.processJobs({ limit: 5 });
equal(sent.length, 1, 'a second drainer does not send the same link again');
equal(action().attempt_count, 1, 'and does not count an attempt it did not make');

// --- a send that fails ------------------------------------------------------------

setup();
sendFails = true;
addJob('job_3');
await queue.processJobs({ limit: 5 });
equal(sent.length, 0);
ok(action().status !== 'completed', 'a failed send does not complete the action');
equal(action().completed_at, null);
equal(
  db.prepare('SELECT status FROM payment_links WHERE id = ?').get(LINK).status,
  'scheduled',
  'and the link is not marked sent',
);
// The attempt is counted at the moment it was made, not only when it worked.
equal(action().attempt_count, 1);

// A retry after the provider recovers still goes out — the claim does not
// wedge an action that never actually reached anybody.
sendFails = false;
addJob('job_4');
await queue.processJobs({ limit: 5 });
equal(sent.length, 1, 'the retry sends');
equal(action().status, 'completed');
equal(action().attempt_count, 2);

console.log(`scheduled payment: ${checks} assertions passed; no provider contacted.`);
