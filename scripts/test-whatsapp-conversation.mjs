/**
 * The real workflow engine, answering a WhatsApp conversation.
 *
 * Compiles `lib/workflow-engine.ts` against an in-memory SQLite database and a
 * synthetic `send_whatsapp` tool, so the parking and resuming are exercised as
 * written rather than described. No provider is ever contacted.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { compileFunction } from 'node:vm';
import ts from 'typescript';

import * as nodes from '../lib/workflow-nodes.ts';
import * as rules from '../lib/whatsapp-bot-rules.ts';

let checks = 0;
const equal = (actual, expected) => {
  assert.deepEqual(actual, expected);
  checks += 1;
};
const ok = (value, message) => {
  assert.ok(value, message);
  checks += 1;
};

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE workflows (id TEXT, organization_id TEXT, name TEXT, trigger_type TEXT,
    status TEXT, graph_json TEXT, run_count INTEGER DEFAULT 0, failure_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE workflow_runs (id TEXT, organization_id TEXT, workflow_id TEXT, trigger_type TEXT,
    status TEXT, input_json TEXT, output_json TEXT, variables_json TEXT, error TEXT,
    resume_node TEXT, waiting_on TEXT, call_id TEXT, started_at TEXT, completed_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE workflow_run_steps (id TEXT PRIMARY KEY, run_id TEXT, step_index INTEGER,
    step_type TEXT, status TEXT DEFAULT 'pending', input_json TEXT DEFAULT '{}',
    output_json TEXT DEFAULT '{}', error TEXT, started_at TEXT, completed_at TEXT,
    node_id TEXT, branch TEXT);
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

/** Every WhatsApp message the engine tried to send. */
const sent = [];
let sendOk = true;

const modules = {
  '@/db/index': { getRawDb: () => ({ prepare: statement }) },
  './whatsapp-bot-rules.ts': rules,
  '@/lib/agent-tools': {
    executeAgentTool: async (tool, args) => {
      sent.push({ tool, ...args });
      return sendOk
        ? { ok: true, providerReference: 'synthetic' }
        : { ok: false, error: 'WhatsApp is not connected.' };
    },
  },
  '@/lib/document-request-service': { createDocumentRequest: async () => ({ ok: false }) },
  '@/lib/document-requests': { normaliseDocumentLabel: (value) => value },
  '@/lib/handoff-service': { createApprovalRequest: async () => ({ id: 'ap_1' }) },
  '@/lib/object-engine': {},
  '@/lib/object-store': { getObject: async () => null, searchRecords: async () => [] },
  '@/lib/workflow-nodes': nodes,
};

const engine = {};
compileFunction(
  ts.transpileModule(
    readFileSync(new URL('../lib/workflow-engine.ts', import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  ['require', 'exports', 'crypto'],
)(
  (id) => {
    if (!modules[id]) throw Error(id);
    return modules[id];
  },
  engine,
  globalThis.crypto,
);

// A two-question chatbot: ask the area, ask the budget, confirm, end.
const graph = {
  nodes: [
    { id: 't', kind: 'trigger', config: { event: 'whatsapp_message' }, next: { next: 'q1' } },
    {
      id: 'q1',
      kind: 'ask',
      config: { question: 'Which area are you looking in?', variable: 'area' },
      next: { next: 'q2' },
    },
    {
      id: 'q2',
      kind: 'ask',
      config: { question: 'And your budget?', variable: 'budget' },
      next: { next: 'done' },
    },
    {
      id: 'done',
      kind: 'say',
      config: { text: 'Thanks — {{area}} at {{budget}}. Someone will call you.' },
      next: { next: 'end' },
    },
    { id: 'end', kind: 'end', config: { disposition: 'qualified' }, next: {} },
  ],
};

const ORG = 'org_test';
const PHONE = '+919812345678';
db.prepare(
  `INSERT INTO workflows (id, organization_id, name, trigger_type, status, graph_json) VALUES (?,?,?,?,?,?)`,
).run('wf_1', ORG, 'WhatsApp qualifier', 'whatsapp_message', 'active', JSON.stringify(graph));
db.prepare(
  `INSERT INTO workflow_runs (id, organization_id, workflow_id, trigger_type, status, input_json, output_json, variables_json, started_at)
   VALUES (?,?,?,?,'running','{}','{}',?,CURRENT_TIMESTAMP)`,
).run('run_1', ORG, 'wf_1', 'whatsapp_message', JSON.stringify({ phone: PHONE }));

const context = {
  organizationId: ORG,
  runId: 'run_1',
  sessionId: null,
  live: false,
  channel: 'whatsapp',
  contactPhone: PHONE,
};

// --- the first question goes out, and the run stops there ----------------------

const first = await engine.executeGraph({
  graph,
  context,
  variables: { phone: PHONE },
});
equal(first.status, 'waiting');
equal(sent.length, 1);
equal(sent[0].message, 'Which area are you looking in?');
// Asking the second question before the first is answered is the failure this
// whole mechanism exists to prevent.
ok(!sent.some((m) => m.message === 'And your budget?'));
const parked = db.prepare(`SELECT status, waiting_on, resume_node FROM workflow_runs WHERE id = 'run_1'`).get();
equal(parked.status, 'waiting');
equal(parked.waiting_on, `whatsapp:${PHONE}`);
equal(parked.resume_node, 'q1');

// --- a reply from somebody else must not wake it -------------------------------

equal(
  await engine.resumeAfterWhatsAppReply({ organizationId: ORG, phone: '+919800000000', text: 'hello' }),
  null,
);
// Nor may another workspace's reply reach this run.
equal(
  await engine.resumeAfterWhatsAppReply({ organizationId: 'org_other', phone: PHONE, text: 'Andheri' }),
  null,
);
equal(sent.length, 1);

// --- the customer answers ------------------------------------------------------

const second = await engine.resumeAfterWhatsAppReply({
  organizationId: ORG,
  phone: '91 98123 45678',
  text: 'Andheri West',
});
ok(second, 'the run resumed');
equal(second.status, 'waiting');
// The answered question is not asked again.
equal(sent.filter((m) => m.message === 'Which area are you looking in?').length, 1);
equal(sent[sent.length - 1].message, 'And your budget?');
const parkedAgain = db.prepare(`SELECT waiting_on, resume_node, variables_json FROM workflow_runs WHERE id = 'run_1'`).get();
equal(parkedAgain.resume_node, 'q2');
equal(JSON.parse(parkedAgain.variables_json).area, 'Andheri West');

// --- and finishes --------------------------------------------------------------

const third = await engine.resumeAfterWhatsAppReply({
  organizationId: ORG,
  phone: PHONE,
  text: '1.2 crore',
});
equal(third.status, 'completed');
// Both answers reached the closing message, filled in.
equal(sent[sent.length - 1].message, 'Thanks — Andheri West at 1.2 crore. Someone will call you.');
const finished = db.prepare(`SELECT status, waiting_on FROM workflow_runs WHERE id = 'run_1'`).get();
equal(finished.status, 'completed');
equal(finished.waiting_on, null);
// Nothing is left waiting, so a later message starts a conversation rather than
// answering a question nobody asked.
equal(
  await engine.resumeAfterWhatsAppReply({ organizationId: ORG, phone: PHONE, text: 'still there?' }),
  null,
);

// --- a person taking over ends the bot's conversation --------------------------

// Set one waiting again, then do what the inbox does when somebody claims it.
db.prepare(
  `INSERT INTO workflow_runs (id, organization_id, workflow_id, trigger_type, status, input_json, output_json, variables_json, started_at)
   VALUES (?,?,?,?,'running','{}','{}','{}',CURRENT_TIMESTAMP)`,
).run('run_claim', ORG, 'wf_1', 'whatsapp_message');
await engine.executeGraph({
  graph,
  context: { ...context, runId: 'run_claim' },
  variables: {},
});
equal(
  db.prepare(`SELECT status FROM workflow_runs WHERE id = 'run_claim'`).get().status,
  'waiting',
);
db.prepare(`UPDATE workflow_runs SET status = 'stopped', waiting_on = NULL, resume_node = NULL,
  completed_at = CURRENT_TIMESTAMP, error = ?
  WHERE organization_id = ? AND status = 'waiting' AND waiting_on = ?`).run(
  'Someone on the team took over this conversation, so the workflow stopped waiting for a reply.',
  ORG,
  `whatsapp:${PHONE}`,
);
// The customer's next message must not be read as the answer to a question
// asked before a person joined the conversation.
equal(
  await engine.resumeAfterWhatsAppReply({ organizationId: ORG, phone: PHONE, text: 'ok thanks' }),
  null,
);
equal(
  db.prepare(`SELECT status FROM workflow_runs WHERE id = 'run_claim'`).get().status,
  'stopped',
);

// --- when WhatsApp will not carry it -------------------------------------------

db.prepare(
  `INSERT INTO workflow_runs (id, organization_id, workflow_id, trigger_type, status, input_json, output_json, variables_json, started_at)
   VALUES (?,?,?,?,'running','{}','{}','{}',CURRENT_TIMESTAMP)`,
).run('run_2', ORG, 'wf_1', 'whatsapp_message');
sendOk = false;
const refused = await engine.executeGraph({
  graph,
  context: { ...context, runId: 'run_2' },
  variables: {},
});
// A send the provider refused is a failed step, not a question left hanging.
equal(refused.status, 'failed');
const stuck = db.prepare(`SELECT status, waiting_on FROM workflow_runs WHERE id = 'run_2'`).get();
equal(stuck.waiting_on, null);
sendOk = true;

// --- a run with nobody to write to ---------------------------------------------

db.prepare(
  `INSERT INTO workflow_runs (id, organization_id, workflow_id, trigger_type, status, input_json, output_json, variables_json, started_at)
   VALUES (?,?,?,?,'running','{}','{}','{}',CURRENT_TIMESTAMP)`,
).run('run_3', ORG, 'wf_1', 'whatsapp_message');
const before = sent.length;
const headless = await engine.executeGraph({
  graph,
  context: { organizationId: ORG, runId: 'run_3', sessionId: null, live: false },
  variables: {},
});
// Headless, Ask has nobody to ask. It says so and sends nothing.
equal(sent.length, before);
ok(
  headless.trace.some((step) => step.kind === 'ask' && step.status === 'skipped'),
);

db.close();
console.log(`whatsapp conversation: ${checks} assertions passed; no provider contacted.`);
