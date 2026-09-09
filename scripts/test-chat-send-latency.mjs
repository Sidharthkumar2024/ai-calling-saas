/**
 * A message the chatbot sends has to be asked for, not waited for.
 *
 * `send_whatsapp` puts the message in `outbound_messages` and a delivery job
 * sends it. That job was only raised by the hourly sweep, which suits a
 * reminder and not a conversation: the customer writes, and the bot's reply
 * arrives up to an hour later.
 *
 * Compiles the real `lib/agent-tools.ts` against in-memory SQLite. Nothing is
 * sent anywhere.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { compileFunction } from 'node:vm';
import ts from 'typescript';

let checks = 0;
const equal = (actual, expected) => {
  assert.deepEqual(actual, expected);
  checks += 1;
};
const ok = (value) => {
  assert.ok(value);
  checks += 1;
};

const ORG = 'org_test';
const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE outbound_messages (id TEXT PRIMARY KEY, organization_id TEXT, channel TEXT,
    destination TEXT, message_body TEXT, status TEXT, scheduled_for TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE background_jobs (id TEXT PRIMARY KEY, organization_id TEXT, queue TEXT,
    type TEXT, idempotency_key TEXT UNIQUE, payload_json TEXT, status TEXT,
    priority INTEGER, max_attempts INTEGER, available_at TEXT);
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

let connected = true;
const stub = new Proxy({}, { get: () => async () => ({}) });
const modules = {
  '@/db/index': { getRawDb: () => ({ prepare: statement, batch: async () => [] }) },
  '@/lib/action-policy': { DEFAULT_REFUND_POLICY: {} },
  '@/lib/handoff-service': stub,
  '@/lib/object-store': stub,
  '@/lib/object-engine': {},
  '@/lib/order-service': stub,
  '@/lib/agent-tool-catalog': { filterToolDefinitions: (all) => all },
  '@/lib/activity-timeline': { toolOutcomeKind: () => 'info' },
  '@/lib/whatsapp-media': {
    assetsOfRecord: () => [],
    buildSendSet: () => [],
    DEFAULT_SEND_POLICY: {},
    describeSend: () => '',
  },
  '@/lib/commerce': {
    createRazorpayPaymentLink: async () => ({}),
    whatsAppConnected: async () => connected,
  },
  // Filled in below with the real module, compiled the same way, so the job
  // row is written exactly as production writes it.
  '@/lib/job-enqueue': null,
  '@/lib/appointment-service': stub,
  '@/lib/appointments': {
    DEFAULT_TIMEZONE: 'Asia/Kolkata',
    describeSlot: () => '',
    todayIn: () => '2026-09-09',
  },
  '@/lib/document-request-service': stub,
};

const dbModule = {
  '@/db/index': { getRawDb: () => ({ prepare: statement, batch: async () => [] }) },
};
const jobEnqueue = {};
compileFunction(
  ts.transpileModule(
    readFileSync(new URL('../lib/job-enqueue.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  ['require', 'exports', 'crypto'],
)((id) => dbModule[id], jobEnqueue, globalThis.crypto);
modules['@/lib/job-enqueue'] = jobEnqueue;

const tools = {};
compileFunction(
  ts.transpileModule(
    readFileSync(new URL('../lib/agent-tools.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  ['require', 'exports', 'crypto'],
)(
  (id) => {
    if (!modules[id]) throw Error(id);
    return modules[id];
  },
  tools,
  globalThis.crypto,
);

const ctx = { organizationId: ORG, agentId: null, sessionId: null };
const send = (input) => tools.executeAgentTool('send_whatsapp', input, ctx);
const deliveryJobs = () =>
  db.prepare(`SELECT idempotency_key, queue, priority FROM background_jobs WHERE type = 'messages.deliver'`).all();

// --- a queued message asks to be delivered --------------------------------------

const sent = await send({ phone: '919812345678', message: 'Which area are you looking in?' });
equal(sent.ok, true);
equal(db.prepare('SELECT COUNT(*) n FROM outbound_messages').get().n, 1);
// Without this the message waits for the hourly sweep, which is the same as no
// answer in a conversation.
equal(deliveryJobs().length, 1);
equal(deliveryJobs()[0].queue, 'messaging');

// A burst raises a handful of jobs, not one per message: the worker drains a
// batch, so three hundred jobs would mostly find nothing left to do.
for (let index = 0; index < 20; index += 1)
  await send({ phone: '919812345678', message: `Message ${index}` });
equal(db.prepare('SELECT COUNT(*) n FROM outbound_messages').get().n, 21);
ok(deliveryJobs().length <= 3);

// --- what must not raise one ------------------------------------------------------

// A message meant for later is the hourly sweep's job, not this minute's.
// Cleared first: within one ten-second bucket an extra send collides with the
// key of an earlier one, which would hide the difference this is checking.
db.prepare(`DELETE FROM background_jobs`).run();
const scheduled = await send({
  phone: '919812345678',
  message: 'Reminder for tomorrow',
  scheduled_for: '2026-09-10 09:00:00',
});
equal(scheduled.ok, true);
equal(deliveryJobs().length, 0);

// Nothing is queued at all when WhatsApp is not connected, so nothing asks to
// be delivered either — and the caller is told, rather than told it is on its
// way.
connected = false;
const refused = await send({ phone: '919812345678', message: 'Nothing connected.' });
equal(refused.ok, false);
equal(refused.reason, 'whatsapp_not_connected');
equal(db.prepare('SELECT COUNT(*) n FROM outbound_messages').get().n, 22);
connected = true;

// A message with nothing in it is not a message.
equal((await send({ phone: '919812345678', message: '' })).ok, false);
equal((await send({ phone: '12', message: 'hi' })).ok, false);
equal(db.prepare('SELECT COUNT(*) n FROM outbound_messages').get().n, 22);

db.close();
console.log(`chat send latency: ${checks} assertions passed; no provider contacted.`);
