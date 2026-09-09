/**
 * The real delivery worker, writing what it sent into the conversation.
 *
 * Compiles `lib/job-queue.ts` against in-memory SQLite and a synthetic
 * provider. Nothing is sent anywhere.
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

const ORG = 'org_test';
const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE outbound_messages (id TEXT PRIMARY KEY, organization_id TEXT, channel TEXT,
    destination TEXT, message_body TEXT, status TEXT, scheduled_for TEXT,
    payment_link_id TEXT, provider_reference TEXT, error_message TEXT, sent_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE whatsapp_messages (id TEXT PRIMARY KEY, organization_id TEXT, phone_number_id TEXT,
    wa_message_id TEXT UNIQUE, direction TEXT, sender_phone TEXT, message_type TEXT,
    body TEXT, media_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE background_jobs (id TEXT PRIMARY KEY, organization_id TEXT, queue TEXT DEFAULT 'default',
    type TEXT, idempotency_key TEXT, payload_json TEXT DEFAULT '{}', status TEXT DEFAULT 'queued',
    priority INTEGER DEFAULT 100, attempts INTEGER DEFAULT 0, max_attempts INTEGER DEFAULT 5,
    available_at TEXT DEFAULT CURRENT_TIMESTAMP, locked_at TEXT, locked_by TEXT, last_error TEXT,
    completed_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE job_attempts (id TEXT PRIMARY KEY, job_id TEXT, attempt INTEGER, status TEXT,
    duration_ms INTEGER, result_json TEXT, error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
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

/** What the provider does with each destination. */
const outcomes = new Map();
const attempted = [];

const stub = new Proxy(
  {},
  { get: () => async () => ({}) },
);
const modules = {
  '@/db/index': {
    getRawDb: () => ({
      prepare: statement,
      // The real driver runs a batch as one unit; here in order is enough.
      batch: async (statements) => {
        for (const entry of statements) await entry.run();
        return [];
      },
    }),
  },
  '@/lib/appointment-service': stub,
  '@/lib/call-outcomes': { isCallOutcome: () => false },
  '@/lib/sales-intelligence-service': stub,
  '@/lib/job-enqueue': { enqueueJob: async () => ({}) },
  '@/lib/provider-adapters': stub,
  '@/lib/call-telemetry': stub,
  '@/lib/campaign-dialer': stub,
  '@/lib/commerce': {
    sendTransactionalEmail: async () => ({ status: 'sent', providerReference: 'email_1' }),
    sendWhatsAppPaymentLink: async () => ({ status: 'sent', providerReference: 'pl_1' }),
    sendWhatsAppText: async (input) => {
      attempted.push(input);
      const outcome = outcomes.get(input.destination) ?? { status: 'sent' };
      if (outcome.throws) throw new Error(outcome.throws);
      // A real provider gives every accepted message its own id.
      return {
        status: outcome.status,
        providerReference: outcome.reference ?? `wamid_${attempted.length}`,
      };
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

const queueMessage = (id, destination, body, channel = 'whatsapp') =>
  db
    .prepare(
      `INSERT INTO outbound_messages (id, organization_id, channel, destination, message_body, status)
       VALUES (?, ?, ?, ?, ?, 'queued')`,
    )
    .run(id, ORG, channel, destination, body);

const transcript = () =>
  db.prepare(`SELECT direction, sender_phone, body FROM whatsapp_messages ORDER BY rowid`).all();

const runDelivery = async (jobId) => {
  db.prepare(
    `INSERT INTO background_jobs (id, organization_id, type, idempotency_key, status)
     VALUES (?, ?, 'messages.deliver', ?, 'queued')`,
  ).run(jobId, ORG, jobId);
  return queue.processJobs({ limit: 5 });
};

// --- what the bot said belongs in the conversation ------------------------------

// Every question the WhatsApp chatbot asks goes out through this queue. None of
// them were recorded, so a supervisor opening that conversation read a column
// of answers with no questions.
queueMessage('om_1', '919812345678', 'Which area are you looking in?');
queueMessage('om_2', '+91 98123 45678', 'And your budget?');
const first = await runDelivery('j1');
equal(first[0].status, 'completed');
equal(attempted.length, 2);
equal(transcript().length, 2);
equal(transcript()[0].direction, 'outbound');
// However the number was written when it was queued, it lands in one shape —
// otherwise the same conversation appears twice in the inbox.
equal(transcript()[0].sender_phone, '+919812345678');
equal(transcript()[1].sender_phone, '+919812345678');
equal(transcript()[1].body, 'And your budget?');

// --- only what the customer actually received -----------------------------------

// A refused message is in outbound_messages with its error. Writing it into the
// conversation would claim something that did not happen.
outcomes.set('919800000001', { throws: 'Outside the 24 hour window.' });
queueMessage('om_3', '919800000001', 'This one will be refused.');
await runDelivery('j2');
equal(transcript().length, 2);
const refused = db
  .prepare(`SELECT status, error_message FROM outbound_messages WHERE id = 'om_3'`)
  .get();
equal(refused.status, 'failed');
// The provider's own words, so the workspace can tell a window from an outage.
equal(refused.error_message, 'Outside the 24 hour window.');

// A sandbox send never left the building either.
outcomes.set('919800000002', { status: 'sandbox_delivered' });
queueMessage('om_4', '919800000002', 'Nothing is connected here.');
await runDelivery('j3');
equal(transcript().length, 2);
equal(
  db.prepare(`SELECT status FROM outbound_messages WHERE id = 'om_4'`).get().status,
  'sandbox_delivered',
);

// An email is not a WhatsApp conversation.
queueMessage('om_5', 'someone@example.com', 'Hello by email', 'email');
await runDelivery('j4');
equal(transcript().length, 2);

// The provider's own id is kept, so a delivery receipt can find this row later.
equal(
  db.prepare(`SELECT wa_message_id FROM whatsapp_messages ORDER BY rowid LIMIT 1`).get().wa_message_id,
  'wamid_1',
);
// And two sends carrying the same provider id do not become two messages.
outcomes.set('919800000003', { status: 'sent', reference: 'wamid_1' });
queueMessage('om_6', '919800000003', 'Duplicate provider id.');
await runDelivery('j5');
equal(transcript().length, 2);

db.close();
console.log(`outbound transcript: ${checks} assertions passed; no provider contacted.`);
