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
  CREATE TABLE leads (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT, phone TEXT,
    email TEXT, score INTEGER);
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

// Both halves. The business side is recorded when the delivery worker sends
// it, and a decision usually turns on the pair: "for rent" only means renting
// because the question before it asked which.
db.prepare(
  `INSERT INTO whatsapp_messages (id, organization_id, direction, sender_phone, body) VALUES (?,?,?,?,?)`,
).run('m1', ORG, 'inbound', PHONE, 'Do you have 2BHK in Andheri?');
db.prepare(
  `INSERT INTO whatsapp_messages (id, organization_id, direction, sender_phone, body) VALUES (?,?,?,?,?)`,
).run('m2', ORG, 'outbound', PHONE, 'For purchase or on rent?');
db.prepare(
  `INSERT INTO whatsapp_messages (id, organization_id, direction, sender_phone, body) VALUES (?,?,?,?,?)`,
).run('m3', ORG, 'inbound', PHONE, 'On rent, for 11 months');

reasoning = { text: 'renting' };
const decided = await engine.executeGraph({
  graph: routing,
  context: freshRun('run_ai_1'),
  variables: {},
});
equal(decided.status, 'completed');
// The decision reached the model with the conversation, not just the question
// — and with both halves of it, which is the point of recording what the bot
// said: "On rent" is only an answer because of the question above it.
const seen = JSON.stringify(reasoningCalls.at(-1).messages);
ok(/Customer: Do you have 2BHK in Andheri\?/.test(seen));
ok(/Business: For purchase or on rent\?/.test(seen));
ok(/Customer: On rent, for 11 months/.test(seen));
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

// --- pausing the workflow ------------------------------------------------------
//
// Pause is what the builder's button writes, and the claim it makes on screen
// has two halves: nothing new starts on it, but a conversation already part-way
// through still finishes. Both are asserted here, because a pause that quietly
// abandoned somebody mid-question would be worse than no pause at all — they
// would be left waiting for the answer to a question this product asked them.
const parkedPhone = '+919700000001';
const askOnly = {
  nodes: [
    { id: 't', kind: 'trigger', config: { event: 'whatsapp_message' }, next: { next: 'q' } },
    { id: 'q', kind: 'ask', config: { question: 'Which area?', variable: 'area' }, next: { next: 'e' } },
    { id: 'e', kind: 'end', config: { disposition: 'qualified' }, next: {} },
  ],
};
db.prepare(
  `INSERT INTO workflows (id, organization_id, name, trigger_type, status, graph_json) VALUES (?,?,?,?,?,?)`,
).run('wf_pause', ORG, 'Pausable', 'whatsapp_message', 'active', JSON.stringify(askOnly));
db.prepare(
  `INSERT INTO workflow_runs (id, organization_id, workflow_id, trigger_type, status, input_json, output_json, variables_json, started_at)
   VALUES (?,?,?,?,'running','{}','{}',?,CURRENT_TIMESTAMP)`,
).run('run_pause', ORG, 'wf_pause', 'whatsapp_message', JSON.stringify({ phone: parkedPhone }));

const asked = await engine.executeGraph({
  graph: askOnly,
  context: { ...context, runId: 'run_pause', contactPhone: parkedPhone },
  variables: { phone: parkedPhone },
});
equal(asked.status, 'waiting');

// The button's write, verbatim.
db.prepare(`UPDATE workflows SET status = 'paused' WHERE id = 'wf_pause'`).run();

const resumedWhilePaused = await engine.resumeAfterWhatsAppReply({
  organizationId: ORG,
  phone: parkedPhone,
  text: 'Bandra',
});
ok(resumedWhilePaused, 'a parked conversation still finishes after a pause');
equal(db.prepare(`SELECT status FROM workflow_runs WHERE id = 'run_pause'`).get().status, 'completed');
// The other half: the lookup that starts a new conversation takes an active
// workflow only, so the paused one picks nobody up.
equal(
  db
    .prepare(`SELECT id FROM workflows WHERE organization_id = ? AND trigger_type = 'whatsapp_message'
      AND status = 'active' AND id = 'wf_pause'`)
    .get(ORG),
  undefined,
);

// --- a lookup with nothing to look up -----------------------------------------
//
// `{{caller_phone}}` that the run never collected has no digits in it, and the
// phone match strips a value to its digits before comparing. That left
// `LIKE '%'`, which matches every lead in the workspace — so the step reported
// `found` and handed the first stranger in the table to everything after it as
// though they were the caller. It has to be a miss, and say why.
db.prepare(`INSERT INTO leads (id, organization_id, name, phone, score) VALUES (?,?,?,?,?)`)
  .run('lead_stranger', ORG, 'Somebody else', '+919888800001', 90);

const lookupGraph = (value) => ({
  nodes: [
    { id: 't', kind: 'trigger', config: { event: 'webhook' }, next: { next: 'l' } },
    {
      id: 'l',
      kind: 'crm_lookup',
      config: { entity: 'lead', match: 'phone', value, variable: 'lead' },
      next: { found: 'e', not_found: 'e' },
    },
    { id: 'e', kind: 'end', config: { disposition: 'done' }, next: {} },
  ],
});

const unresolved = await engine.executeGraph({
  graph: lookupGraph('{{caller_phone}}'),
  context: freshRun('run_lookup_1'),
  variables: {},
});
const unresolvedStep = unresolved.trace.find((step) => step.kind === 'crm_lookup');
equal(unresolvedStep.status, 'skipped');
ok(
  String(unresolvedStep.note ?? '').includes('never collected'),
  'says the value was never collected rather than reporting a match',
);
// The harm was never the branch — it was the row. Nobody may be bound to
// `lead` by a lookup that had nothing to look up.
const boundAfterUnresolved = (id) =>
  String(
    db.prepare(`SELECT variables_json FROM workflow_runs WHERE id = ?`).get(id)
      .variables_json ?? '',
  ).includes('lead_stranger');
equal(boundAfterUnresolved('run_lookup_1'), false);

// "unknown" is the same hole by another route.
const noDigits = await engine.executeGraph({
  graph: lookupGraph('unknown'),
  context: freshRun('run_lookup_2'),
  variables: {},
});
equal(
  noDigits.trace.find((step) => step.kind === 'crm_lookup').status,
  'skipped',
);

// A real number still finds the person it names, and only them.
const found = await engine.executeGraph({
  graph: lookupGraph('+91 98888 00001'),
  context: freshRun('run_lookup_3'),
  variables: {},
});
const foundStep = found.trace.find((step) => step.kind === 'crm_lookup');
equal(foundStep.status, 'completed');
equal(
  db.prepare(`SELECT variables_json FROM workflow_runs WHERE id = 'run_lookup_3'`).get().variables_json.includes('lead_stranger'),
  true,
);

// A number nobody has is a miss, not the nearest row.
const missing = await engine.executeGraph({
  graph: lookupGraph('+91 90000 00000'),
  context: freshRun('run_lookup_4'),
  variables: {},
});
equal(missing.trace.find((step) => step.kind === 'crm_lookup').status, 'completed');
equal(boundAfterUnresolved('run_lookup_4'), false);
equal(boundAfterUnresolved('run_lookup_2'), false);

// --- a conversation that went through an approval ---------------------------------
//
// A person had to approve something in the middle. That does not move the
// conversation off WhatsApp, but the resume used to rebuild the context from
// nothing — no channel, no phone, no session id — so the run carried on
// headless and the customer waiting on the other end was told nothing. Worse
// than silence: because the ask skipped instead of suspending, no run was left
// parked on that number, so the customer's next message started a brand new
// run from the trigger instead of continuing this one.
const approvalPhone = '+919700000002';
const approvalGraph = {
  nodes: [
    { id: 't', kind: 'trigger', config: { event: 'whatsapp_message' }, next: { next: 'a' } },
    {
      id: 'a',
      kind: 'approval',
      config: { action: 'discount', amount: '500', reason: 'Asked for a discount' },
      next: { approved: 's', rejected: 'e' },
    },
    { id: 's', kind: 'say', config: { text: 'Approved — 500 off.' }, next: { next: 'q' } },
    { id: 'q', kind: 'ask', config: { question: 'Shall I send the link?', variable: 'confirm' }, next: { next: 'e' } },
    { id: 'e', kind: 'end', config: { disposition: 'done' }, next: {} },
  ],
};
db.prepare(
  `INSERT INTO workflows (id, organization_id, name, trigger_type, status, graph_json) VALUES (?,?,?,?,?,?)`,
).run('wf_appr', ORG, 'Discount', 'whatsapp_message', 'active', JSON.stringify(approvalGraph));
db.prepare(
  `INSERT INTO workflow_runs (id, organization_id, workflow_id, trigger_type, status, input_json, output_json, variables_json, waiting_on, resume_node, started_at)
   VALUES (?,?,?,'whatsapp_message','waiting','{}','{}',?,?,?,CURRENT_TIMESTAMP)`,
).run(
  'run_appr',
  ORG,
  'wf_appr',
  JSON.stringify({ phone: approvalPhone, customer_phone: approvalPhone }),
  'approval:ap_discount',
  'a',
);

const beforeApproval = sent.length;
const resumed = await engine.resumeAfterApproval({
  organizationId: ORG,
  approvalId: 'ap_discount',
  approved: true,
});
ok(resumed, 'the approval resumes the run it was raised from');
// The customer hears the outcome.
equal(sent.length, beforeApproval + 2, 'both the answer and the next question go out');
equal(sent[beforeApproval].message, 'Approved — 500 off.');
equal(sent[beforeApproval + 1].message, 'Shall I send the link?');
equal(sent[beforeApproval].phone, approvalPhone, 'and they go to the person who was waiting');

// And the run parks on that number again, so their reply continues this
// conversation instead of starting another one.
const parkedAfterApproval = db
  .prepare(`SELECT status, waiting_on, resume_node FROM workflow_runs WHERE id = 'run_appr'`)
  .get();
equal(parkedAfterApproval.status, 'waiting');
equal(parkedAfterApproval.waiting_on, `whatsapp:${approvalPhone}`);
equal(parkedAfterApproval.resume_node, 'q');
equal(resumed.status, 'waiting', 'the run is not reported finished while somebody is being asked');

// A voice run keeps its session id rather than losing it to the resume.
db.prepare(
  `INSERT INTO workflow_runs (id, organization_id, workflow_id, trigger_type, status, input_json, output_json, variables_json, waiting_on, resume_node, call_id, started_at)
   VALUES (?,?,?,'inbound_call','waiting','{}','{}','{}',?,?,?,CURRENT_TIMESTAMP)`,
).run('run_voice', ORG, 'wf_appr', 'approval:ap_voice', 'a', 'call_9');
const voice = await engine.resumeAfterApproval({
  organizationId: ORG,
  approvalId: 'ap_voice',
  approved: true,
});
ok(voice, 'a voice run resumes too');
// Nothing was sent to WhatsApp for a call — the channel is not invented.
equal(sent.length, beforeApproval + 2, 'a voice run does not message anybody');

// --- a loop that never goes round -------------------------------------------------
//
// The validator now refuses to publish one of these, but workflows already
// published still start, so the engine has to survive one. A run used to spin
// until the hundred-step budget killed it, writing a step row each lap and
// sending whatever sat inside the loop about thirty-three times. It stops on
// the second arrival instead, and says which step it stopped at.
const loopPhone = '+919700000003';
const loopGraph = {
  nodes: [
    { id: 't', kind: 'trigger', config: { event: 'whatsapp_message' }, next: { next: 'q' } },
    { id: 'q', kind: 'ask', config: { question: 'Which day?', variable: 'day' }, next: { next: 'c' } },
    // Never satisfied, which is the whole point: the author meant "ask again".
    { id: 'c', kind: 'condition', config: { expression: 'day = never' }, next: { true: 'e', false: 's' } },
    { id: 's', kind: 'say', config: { text: 'Sorry, I did not catch that.' }, next: { next: 'q' } },
    { id: 'e', kind: 'end', config: { disposition: 'done' }, next: {} },
  ],
};
// The resume reads the graph from the workflow row, so the loop has to be the
// stored graph and not only the one handed to executeGraph.
db.prepare(
  `INSERT INTO workflows (id, organization_id, name, trigger_type, status, graph_json) VALUES (?,?,?,?,?,?)`,
).run('wf_loop', ORG, 'Looping', 'whatsapp_message', 'active', JSON.stringify(loopGraph));
db.prepare(
  `INSERT INTO workflow_runs (id, organization_id, workflow_id, trigger_type, status, input_json, output_json, variables_json, started_at)
   VALUES (?,?,?,'whatsapp_message','running','{}','{}',?,CURRENT_TIMESTAMP)`,
).run('run_loop', ORG, 'wf_loop', JSON.stringify({ phone: loopPhone }));

const beforeLoop = sent.length;
const firstLap = await engine.executeGraph({
  graph: loopGraph,
  context: { ...context, runId: 'run_loop', contactPhone: loopPhone },
  variables: { phone: loopPhone },
});
// Lap one is an ordinary question, and the run parks on it.
equal(firstLap.status, 'waiting');
equal(sent.length, beforeLoop + 1, 'the question goes out once');

// The customer answers something the condition will not accept.
const afterReply = await engine.resumeAfterWhatsAppReply({
  organizationId: ORG,
  phone: loopPhone,
  text: 'whenever',
});
ok(afterReply, 'the reply resumes the run');
equal(afterReply.status, 'stopped', 'and the run stops rather than going round');
ok(
  String(afterReply.error ?? '').includes('came round a second time'),
  'it says why it stopped',
);
ok(String(afterReply.error ?? '').includes('Ask'), 'and which step it stopped at');
// THE ONE THAT MATTERS: the apology inside the loop is heard once, not thirty
// times. Before this it was sent on every lap until the step budget ran out.
equal(
  sent.length,
  beforeLoop + 2,
  'the step inside the loop is sent once more and no more',
);
const loopSteps = db
  .prepare(`SELECT COUNT(*) AS n FROM workflow_run_steps WHERE run_id = 'run_loop'`)
  .get().n;
ok(loopSteps <= 6, `a handful of step rows, not a hundred (got ${loopSteps})`);

// Headless, where the ask cannot even park: the same guard, one lap.
db.prepare(
  `INSERT INTO workflow_runs (id, organization_id, workflow_id, trigger_type, status, input_json, output_json, variables_json, started_at)
   VALUES (?,?,?,'webhook','running','{}','{}','{}',CURRENT_TIMESTAMP)`,
).run('run_loop_loopHeadless', ORG, 'wf_1');
const loopHeadless = await engine.executeGraph({
  graph: loopGraph,
  context: { organizationId: ORG, runId: 'run_loop_loopHeadless', sessionId: null, live: false },
  variables: {},
});
equal(loopHeadless.status, 'stopped');
ok(String(loopHeadless.error ?? '').includes('came round a second time'));

// And a graph that merges two branches back together is not a loop: nothing
// here refuses an honest forward-only join.
const mergeGraph = {
  nodes: [
    { id: 't', kind: 'trigger', config: { event: 'whatsapp_message' }, next: { next: 'c' } },
    { id: 'c', kind: 'condition', config: { expression: 'phone != nobody' }, next: { true: 's1', false: 's2' } },
    { id: 's1', kind: 'say', config: { text: 'Hello there.' }, next: { next: 'e' } },
    { id: 's2', kind: 'say', config: { text: 'Hello.' }, next: { next: 'e' } },
    { id: 'e', kind: 'end', config: { disposition: 'done' }, next: {} },
  ],
};
db.prepare(
  `INSERT INTO workflow_runs (id, organization_id, workflow_id, trigger_type, status, input_json, output_json, variables_json, started_at)
   VALUES (?,?,?,'whatsapp_message','running','{}','{}',?,CURRENT_TIMESTAMP)`,
).run('run_merge', ORG, 'wf_1', JSON.stringify({ phone: loopPhone }));
const merged = await engine.executeGraph({
  graph: mergeGraph,
  context: { ...context, runId: 'run_merge', contactPhone: loopPhone },
  variables: { phone: loopPhone },
});
equal(merged.status, 'completed', 'a forward-only join still runs to the end');

// --- a condition about what somebody said -----------------------------------------
//
// Every other step wants `{{name}}` substituted before it runs. A condition is
// the one that does not: evaluateCondition resolves the reference itself,
// because only it knows the left side is a name and the right side is usually
// a literal. It used to be handed the substituted copy, so
// `{{answer}} contains yes` arrived as `yes please contains yes` and the left
// side was looked up as a variable called "yes please". Undefined, so the
// branch went false — and the trace said the answer had no value while it sat
// in the run's own variables. Numbers survived by luck: `80 >= 60` compares
// the same either way.
const branchOn = (expression, vars) => ({
  nodes: [
    { id: 't', kind: 'trigger', config: { event: 'whatsapp_message' }, next: { next: 'c' } },
    { id: 'c', kind: 'condition', config: { expression }, next: { true: 'yes', false: 'no' } },
    { id: 'yes', kind: 'end', config: { disposition: 'matched' }, next: {} },
    { id: 'no', kind: 'end', config: { disposition: 'missed' }, next: {} },
  ],
  vars,
});

let branchRun = 0;
const whichWay = async (expression, vars) => {
  branchRun += 1;
  const id = `run_branch_${branchRun}`;
  db.prepare(
    `INSERT INTO workflow_runs (id, organization_id, workflow_id, trigger_type, status, input_json, output_json, variables_json, started_at)
     VALUES (?,?,?,'webhook','running','{}','{}','{}',CURRENT_TIMESTAMP)`,
  ).run(id, ORG, 'wf_1');
  const graph = branchOn(expression, vars);
  const outcome = await engine.executeGraph({
    graph,
    context: { organizationId: ORG, runId: id, sessionId: null, live: false },
    variables: vars,
  });
  const end = outcome.trace.find((step) => step.kind === 'end');
  return { outcome, end };
};

// THE ONE THAT WAS BROKEN.
const spoken = await whichWay('{{answer}} contains yes', { answer: 'yes please' });
equal(spoken.end.nodeId, 'yes', 'a braced text variable is resolved, not substituted');
// And when it genuinely does not match, it still says no.
const notMatched = await whichWay('{{answer}} contains yes', { answer: 'no thanks' });
equal(notMatched.end.nodeId, 'no');
// A variable the run never collected is absent, and absent is false — the
// message that used to be printed about an answer that was present.
const absent = await whichWay('{{answer}} contains yes', {});
equal(absent.end.nodeId, 'no');

// The forms that already worked keep working, both ways round.
equal((await whichWay('{{score}} >= 60', { score: 80 })).end.nodeId, 'yes');
equal((await whichWay('score >= 60', { score: 80 })).end.nodeId, 'yes');
equal((await whichWay('answer contains yes', { answer: 'yes please' })).end.nodeId, 'yes');
equal((await whichWay('{{score}} >= 60', { score: 10 })).end.nodeId, 'no');
// A literal on the right that happens to be a word is still a word.
equal((await whichWay('{{stage}} = qualified', { stage: 'qualified' })).end.nodeId, 'yes');

// --- an answer of the wrong kind --------------------------------------------------
//
// `expect` was authored on every Ask and read by nothing, so "What day suits
// you?" accepted "yes" and carried it into a booking. The re-ask has to live
// in the node: a run never goes round twice, so an edge pointing back at the
// Ask is refused at publish, and asking again is this node's job or nobody's.
const datePhone = '+919700000004';
const dateGraph = {
  nodes: [
    { id: 't', kind: 'trigger', config: { event: 'whatsapp_message' }, next: { next: 'q' } },
    {
      id: 'q',
      kind: 'ask',
      config: { question: 'What day suits you?', variable: 'day', expect: 'date' },
      next: { next: 'e' },
    },
    { id: 'e', kind: 'end', config: { disposition: 'booked' }, next: {} },
  ],
};
db.prepare(
  `INSERT INTO workflows (id, organization_id, name, trigger_type, status, graph_json) VALUES (?,?,?,?,?,?)`,
).run('wf_expect', ORG, 'Expecting a date', 'whatsapp_message', 'active', JSON.stringify(dateGraph));
db.prepare(
  `INSERT INTO workflow_runs (id, organization_id, workflow_id, trigger_type, status, input_json, output_json, variables_json, started_at)
   VALUES (?,?,?,'whatsapp_message','running','{}','{}',?,CURRENT_TIMESTAMP)`,
).run('run_expect', ORG, 'wf_expect', JSON.stringify({ phone: datePhone }));

const beforeExpect = sent.length;
const firstAsk = await engine.executeGraph({
  graph: dateGraph,
  context: { ...context, runId: 'run_expect', contactPhone: datePhone },
  variables: { phone: datePhone },
});
equal(firstAsk.status, 'waiting');
equal(sent.length, beforeExpect + 1, 'the question is asked once');

// They answer something that is not a day at all.
const wrongKind = await engine.resumeAfterWhatsAppReply({
  organizationId: ORG,
  phone: datePhone,
  text: 'yes',
});
ok(wrongKind, 'the reply resumes the run');
equal(wrongKind.status, 'waiting', 'and the run parks again rather than carrying on');
equal(sent.length, beforeExpect + 2, 'it asks again');
ok(
  sent.at(-1).message.includes('which day'),
  'saying what was wrong with the answer, not just repeating itself',
);
ok(sent.at(-1).message.includes('What day suits you?'), 'and asking the question again');

// Now they give a real day.
const usable = await engine.resumeAfterWhatsAppReply({
  organizationId: ORG,
  phone: datePhone,
  text: '14 March',
});
equal(usable.status, 'completed', 'a usable answer finishes the run');
equal(sent.length, beforeExpect + 2, 'and nothing further is sent');
equal(
  JSON.parse(
    db.prepare(`SELECT variables_json AS v FROM workflow_runs WHERE id = 'run_expect'`).get().v,
  ).day,
  '14 March',
  'the answer kept is the usable one, not the first',
);

// Somebody who never gives a usable answer is not asked for ever: the Ask
// carries on with what it has, and the trace says it did not match.
const stubbornPhone = '+919700000005';
db.prepare(
  `INSERT INTO workflow_runs (id, organization_id, workflow_id, trigger_type, status, input_json, output_json, variables_json, started_at)
   VALUES (?,?,?,'whatsapp_message','running','{}','{}',?,CURRENT_TIMESTAMP)`,
).run('run_stubborn', ORG, 'wf_expect', JSON.stringify({ phone: stubbornPhone }));
const beforeStubborn = sent.length;
await engine.executeGraph({
  graph: dateGraph,
  context: { ...context, runId: 'run_stubborn', contactPhone: stubbornPhone },
  variables: { phone: stubbornPhone },
});
let lastStubborn = null;
for (let attempt = 0; attempt < 4; attempt += 1) {
  const resumed = await engine.resumeAfterWhatsAppReply({
    organizationId: ORG,
    phone: stubbornPhone,
    text: 'yes',
  });
  // Once it stops parking there is nothing left to reply to, and a reply that
  // wakes nothing is the ordinary case rather than a failure.
  if (!resumed) break;
  lastStubborn = resumed;
  if (resumed.status !== 'waiting') break;
}
equal(lastStubborn.status, 'completed', 'the run ends rather than asking for ever');
const totalAsks = sent.length - beforeStubborn;
ok(totalAsks <= 3, `asked at most three times (was ${totalAsks})`);
const stubbornStep = lastStubborn.trace.find((step) => step.kind === 'ask');
ok(
  String(stubbornStep.note ?? '').includes('not a date'),
  'and the trace says the answer was not what was asked for',
);

// An Ask with no expectation authored takes whatever it is given, as before.
const anyPhone = '+919700000006';
const anyGraph = {
  nodes: [
    { id: 't', kind: 'trigger', config: { event: 'whatsapp_message' }, next: { next: 'q' } },
    { id: 'q', kind: 'ask', config: { question: 'Anything else?', variable: 'note' }, next: { next: 'e' } },
    { id: 'e', kind: 'end', config: { disposition: 'done' }, next: {} },
  ],
};
db.prepare(
  `INSERT INTO workflows (id, organization_id, name, trigger_type, status, graph_json) VALUES (?,?,?,?,?,?)`,
).run('wf_any', ORG, 'No expectation', 'whatsapp_message', 'active', JSON.stringify(anyGraph));
db.prepare(
  `INSERT INTO workflow_runs (id, organization_id, workflow_id, trigger_type, status, input_json, output_json, variables_json, started_at)
   VALUES (?,?,?,'whatsapp_message','running','{}','{}',?,CURRENT_TIMESTAMP)`,
).run('run_any', ORG, 'wf_any', JSON.stringify({ phone: anyPhone }));
await engine.executeGraph({
  graph: anyGraph,
  context: { ...context, runId: 'run_any', contactPhone: anyPhone },
  variables: { phone: anyPhone },
});
const tookIt = await engine.resumeAfterWhatsAppReply({
  organizationId: ORG,
  phone: anyPhone,
  text: 'not really',
});
equal(tookIt.status, 'completed', 'an Ask that asked for nothing in particular still accepts anything');

db.close();
console.log(`whatsapp conversation: ${checks} assertions passed; no provider contacted.`);
