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
import * as aiDecision from '../lib/ai-decision.ts';

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
  CREATE TABLE whatsapp_assignments (organization_id TEXT, phone TEXT, support_agent_id TEXT,
    assigned_at TEXT, PRIMARY KEY (organization_id, phone));
  CREATE TABLE whatsapp_messages (id TEXT PRIMARY KEY, organization_id TEXT, direction TEXT,
    sender_phone TEXT, body TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
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
/** What the reasoning provider answers, or an error to throw instead. */
let reasoning = { text: 'buying' };
const reasoningCalls = [];
/** What the routing decides for a transfer. */
let transferResult = { ok: true, transferred: true, agent: { id: 'sa_sup', name: 'Rohit', role: 'support_agent' } };

const modules = {
  '@/db/index': { getRawDb: () => ({ prepare: statement }) },
  './whatsapp-bot-rules.ts': rules,
  './ai-decision.ts': aiDecision,
  '@/lib/provider-adapters': {
    reasonWithTools: async (input) => {
      reasoningCalls.push(input);
      if (reasoning.throws) throw new Error(reasoning.throws);
      return { id: 'msg_1', content: [{ type: 'text', text: reasoning.text }] };
    },
  },
  '@/lib/agent-tools': {
    executeAgentTool: async (tool, args) => {
      if (tool === 'transfer_to_human') return transferResult;
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

// --- an AI decision reads what was actually said --------------------------------

const routing = {
  nodes: [
    { id: 't', kind: 'trigger', config: { event: 'whatsapp_message' }, next: { next: 'd' } },
    {
      id: 'd',
      kind: 'ai_decision',
      config: {
        instruction: 'Are they buying or renting?',
        outcomes: ['buying', 'renting'],
      },
      next: { buying: 'sale', renting: 'rent' },
    },
    { id: 'sale', kind: 'say', config: { text: 'Our sales team will call.' }, next: { next: 'e' } },
    { id: 'rent', kind: 'say', config: { text: 'Our rentals team will call.' }, next: { next: 'e' } },
    { id: 'e', kind: 'end', config: { disposition: 'routed' }, next: {} },
  ],
};

function freshRun(id) {
  db.prepare(
    `INSERT INTO workflow_runs (id, organization_id, workflow_id, trigger_type, status, input_json, output_json, variables_json, started_at)
     VALUES (?,?,?,?,'running','{}','{}','{}',CURRENT_TIMESTAMP)`,
  ).run(id, ORG, 'wf_1', 'whatsapp_message');
  return { ...context, runId: id };
}

db.prepare(
  `INSERT INTO whatsapp_messages (id, organization_id, direction, sender_phone, body) VALUES (?,?,?,?,?)`,
).run('m1', ORG, 'inbound', PHONE, 'Looking for a 2BHK on rent for 11 months');

reasoning = { text: 'renting' };
const decided = await engine.executeGraph({
  graph: routing,
  context: freshRun('run_ai_1'),
  variables: {},
});
equal(decided.status, 'completed');
// The decision reached the model with the conversation, not just the question.
ok(/2BHK on rent/.test(JSON.stringify(reasoningCalls.at(-1).messages)));
equal(sent.at(-1).message, 'Our rentals team will call.');

// The failure this replaces: taking the first exit and reporting success.
reasoning = { text: 'leasing' };
const undecided = await engine.executeGraph({
  graph: routing,
  context: freshRun('run_ai_2'),
  variables: {},
});
equal(undecided.status, 'failed');
ok(!sent.some((m) => m.message === 'Our sales team will call.'));
// The run list shows this, so it has to be a sentence rather than a slug.
ok(
  db
    .prepare(`SELECT error FROM workflow_runs WHERE id = 'run_ai_2'`)
    .get()
    .error.includes('leasing'),
);

// No model connected is also not a decision.
reasoning = { throws: 'Vaani Sense is not connected.' };
const offline = await engine.executeGraph({
  graph: routing,
  context: freshRun('run_ai_3'),
  variables: {},
});
equal(offline.status, 'failed');
ok(!sent.some((m) => m.message === 'Our sales team will call.'));

// With a fallback the author chose, the run continues down a path somebody
// actually decided on.
const withFallback = {
  nodes: routing.nodes.map((node) =>
    node.id === 'd'
      ? { ...node, config: { ...node.config, fallback: 'renting' } }
      : node,
  ),
};
const fellBack = await engine.executeGraph({
  graph: withFallback,
  context: freshRun('run_ai_4'),
  variables: {},
});
equal(fellBack.status, 'completed');
equal(sent.at(-1).message, 'Our rentals team will call.');

// A fallback that is not one of the outcomes cannot be taken.
const badFallback = {
  nodes: routing.nodes.map((node) =>
    node.id === 'd'
      ? { ...node, config: { ...node.config, fallback: 'escalate' } }
      : node,
  ),
};
equal(
  (await engine.executeGraph({ graph: badFallback, context: freshRun('run_ai_5'), variables: {} }))
    .status,
  'failed',
);
reasoning = { text: 'buying' };

// Headless, the old behaviour is unchanged: no model is called at all.
const callsBefore = reasoningCalls.length;
const headlessDecision = await engine.executeGraph({
  graph: routing,
  context: { organizationId: ORG, runId: freshRun('run_ai_6').runId, sessionId: null, live: false },
  variables: {},
});
equal(reasoningCalls.length, callsBefore);
ok(headlessDecision.trace.some((step) => step.kind === 'ai_decision' && step.status === 'skipped'));

// --- handing the conversation to a person ---------------------------------------

const handoff = {
  nodes: [
    { id: 't', kind: 'trigger', config: { event: 'whatsapp_message' }, next: { next: 'h' } },
    {
      id: 'h',
      kind: 'human_transfer',
      config: { reason: 'They asked for a person.' },
      next: { accepted: 'bye', no_agent: 'sorry' },
    },
    { id: 'bye', kind: 'say', config: { text: 'Rohit will reply here shortly.' }, next: { next: 'ask_more' } },
    {
      id: 'ask_more',
      kind: 'ask',
      config: { question: 'Anything else meanwhile?', variable: 'more' },
      next: { next: 'e' },
    },
    { id: 'sorry', kind: 'say', config: { text: 'Nobody is free right now.' }, next: { next: 'e' } },
    { id: 'e', kind: 'end', config: { disposition: 'handed_over' }, next: {} },
  ],
};

const heldBy = () =>
  db.prepare(`SELECT support_agent_id FROM whatsapp_assignments WHERE organization_id = ? AND phone = ?`).get(ORG, PHONE)
    ?.support_agent_id ?? null;

// A run parked on this number before the handover: it is waiting for an answer
// that is about to belong to a person.
db.prepare(
  `INSERT INTO workflow_runs (id, organization_id, workflow_id, trigger_type, status, input_json, output_json, variables_json, waiting_on, resume_node, started_at)
   VALUES ('run_stale', ?, 'wf_1', 'whatsapp_message', 'waiting', '{}', '{}', '{}', ?, 'q1', CURRENT_TIMESTAMP)`,
).run(ORG, `whatsapp:${PHONE}`);

equal(heldBy(), null);
const handedOver = await engine.executeGraph({
  graph: handoff,
  context: freshRun('run_h1'),
  variables: {},
});
// The handoff on its own leaves the customer waiting: whoever picks it up has
// no conversation in their inbox to answer in.
equal(heldBy(), 'sa_sup');
equal(sent.at(-1).message, 'Rohit will reply here shortly.');
// And the run does not then park on a conversation somebody else now owns.
equal(handedOver.status, 'completed');
ok(handedOver.trace.some((step) => step.kind === 'ask' && step.status === 'skipped'));
// The run that was already parked on this number is stopped, not left waiting
// for an answer going to a person.
equal(db.prepare(`SELECT status FROM workflow_runs WHERE id = 'run_stale'`).get().status, 'stopped');

// Nobody available: the conversation is left where it was rather than silenced
// with no one in the bot's place.
db.prepare('DELETE FROM whatsapp_assignments').run();
transferResult = { ok: false, transferred: false, message: 'Everyone is busy.' };
const noAgent = await engine.executeGraph({
  graph: handoff,
  context: freshRun('run_h2'),
  variables: {},
});
equal(noAgent.status, 'completed');
equal(heldBy(), null);
equal(sent.at(-1).message, 'Nobody is free right now.');

// A handoff nobody named took is also not a claim: silencing the bot with no
// person in its place is the worst of both.
transferResult = { ok: true, transferred: false, queueStatus: 'queued' };
await engine.executeGraph({ graph: handoff, context: freshRun('run_h3'), variables: {} });
equal(heldBy(), null);
transferResult = { ok: true, transferred: true, agent: { id: 'sa_sup', name: 'Rohit', role: 'support_agent' } };

// --- a step reaches the person the run is talking to ----------------------------

const withTools = {
  nodes: [
    { id: 't', kind: 'trigger', config: { event: 'whatsapp_message' }, next: { next: 'm' } },
    {
      id: 'm',
      // No destination configured. On a call an author fills it in from a CRM
      // lookup; on WhatsApp the customer is the run.
      kind: 'message',
      config: { channel: 'whatsapp', body: 'Here are the details you asked for.' },
      next: { next: 'p' },
    },
    {
      id: 'p',
      kind: 'payment',
      config: { amount: '5000', purpose: 'Booking amount' },
      next: { next: 'e' },
    },
    { id: 'e', kind: 'end', config: { disposition: 'sent' }, next: {} },
  ],
};
const reached = await engine.executeGraph({
  graph: withTools,
  context: freshRun('run_dest'),
  variables: {},
});
equal(reached.status, 'completed');
equal(sent.filter((m) => m.tool === 'send_whatsapp').at(-1).phone, PHONE);
equal(sent.filter((m) => m.tool === 'create_payment_link').at(-1).customer_phone, PHONE);

// An unresolved placeholder is not quietly redirected to the customer: it may
// have been meant for somebody else entirely.
const wrongNumber = {
  nodes: [
    { id: 't', kind: 'trigger', config: { event: 'whatsapp_message' }, next: { next: 'm' } },
    {
      id: 'm',
      kind: 'message',
      config: { channel: 'whatsapp', destination: '{{accountant_phone}}', body: 'Invoice attached.' },
      next: { next: 'e' },
    },
    { id: 'e', kind: 'end', config: { disposition: 'sent' }, next: {} },
  ],
};
const beforeSends = sent.length;
const skipped = await engine.executeGraph({
  graph: wrongNumber,
  context: freshRun('run_dest_2'),
  variables: {},
});
equal(sent.length, beforeSends);
ok(skipped.trace.some((step) => step.kind === 'message' && step.status === 'skipped'));

// An explicit number still wins over the conversation.
const elsewhere = {
  nodes: [
    { id: 't', kind: 'trigger', config: { event: 'whatsapp_message' }, next: { next: 'm' } },
    {
      id: 'm',
      kind: 'message',
      config: { channel: 'whatsapp', destination: '+919000000000', body: 'For the office.' },
      next: { next: 'e' },
    },
    { id: 'e', kind: 'end', config: { disposition: 'sent' }, next: {} },
  ],
};
await engine.executeGraph({ graph: elsewhere, context: freshRun('run_dest_3'), variables: {} });
equal(sent.at(-1).phone, '+919000000000');

db.close();
console.log(`whatsapp conversation: ${checks} assertions passed; no provider contacted.`);
