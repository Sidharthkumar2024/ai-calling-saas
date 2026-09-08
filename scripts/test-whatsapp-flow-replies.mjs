/**
 * The real webhook route, receiving Flow answers.
 *
 * Compiles `app/api/webhooks/whatsapp/route.ts` against in-memory SQLite and a
 * synthetic app secret, so the signature check, the token matching and the
 * duplicate handling are exercised as written. No provider is contacted and no
 * real secret is used — the app secret here is a string invented for the test.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { compileFunction } from 'node:vm';
import ts from 'typescript';

import * as flows from '../lib/whatsapp-flows.ts';
import * as flowLeads from '../lib/whatsapp-flow-leads.ts';

let checks = 0;
const equal = (actual, expected) => {
  assert.deepEqual(actual, expected);
  checks += 1;
};
const ok = (value) => {
  assert.ok(value);
  checks += 1;
};

const SECRET = 'test_app_secret_not_a_real_one';
const ORG = 'org_test';
const PHONE = '919812345678';

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE whatsapp_messages (id TEXT PRIMARY KEY, organization_id TEXT, phone_number_id TEXT,
    wa_message_id TEXT UNIQUE, direction TEXT, sender_phone TEXT, message_type TEXT,
    body TEXT, media_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE whatsapp_assignments (organization_id TEXT, phone TEXT, support_agent_id TEXT,
    assigned_at TEXT);
  CREATE TABLE whatsapp_flows (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT,
    cta_label TEXT, screens_json TEXT, status TEXT, provider_id TEXT);
  CREATE TABLE whatsapp_flow_responses (id TEXT PRIMARY KEY, organization_id TEXT, flow_id TEXT,
    flow_token TEXT, phone TEXT, status TEXT, answers_json TEXT,
    sent_at TEXT DEFAULT CURRENT_TIMESTAMP, answered_at TEXT);
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

const dispatched = [];
/** Every lead the webhook tried to create. */
const ingested = [];
const modules = {
  'next/server': {
    NextResponse: { json: (body, init) => Response.json(body, init) },
  },
  '@/db/bootstrap': { ensureSchema: async () => {} },
  '@/db/index': { getRawDb: () => ({ prepare: statement }) },
  '@/lib/document-inbox': { intakeWhatsAppDocument: async () => ({ ok: true }) },
  '@/lib/commerce': {
    whatsAppInboundCredentials: async (id) =>
      id === '100200300400'
        ? { organizationId: ORG, accessToken: 'synthetic', graphVersion: 'v23.0' }
        : null,
  },
  '@/lib/platform-secrets': {
    readPlatformSecret: async () => ({ secrets: { appSecret: SECRET }, config: {}, disabled: false }),
  },
  '@/lib/whatsapp-bot': {
    dispatchInboundMessage: async (input) => {
      dispatched.push(input);
      return { acted: 'none', reason: 'no_workflow' };
    },
  },
  '@/lib/whatsapp-flows': flows,
  '@/lib/whatsapp-flow-leads': flowLeads,
  '@/lib/lead-engine': {
    normalizeLeadInput: (value) => value,
    ingestLead: async (organizationId, input) => {
      ingested.push({ organizationId, input });
      if (input.name.includes('EXPLODE')) throw new Error('synthetic failure');
      return { id: 'lead_1' };
    },
  },
};

const route = {};
compileFunction(
  ts.transpileModule(
    readFileSync(new URL('../app/api/webhooks/whatsapp/route.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  ['require', 'exports', 'crypto', 'process'],
)(
  (id) => {
    if (!modules[id]) throw Error(id);
    return modules[id];
  },
  route,
  globalThis.crypto,
  { env: {} },
);

const post = (body) => {
  const raw = JSON.stringify(body);
  return route.POST(
    new Request('http://localhost/api/webhooks/whatsapp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`,
      },
      body: raw,
    }),
  );
};

const envelope = (message, phoneNumberId = '100200300400') => ({
  entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, messages: [message] } }] }],
});

const flowReply = (token, answers, id = 'wamid_1') => ({
  id,
  type: 'interactive',
  from: PHONE,
  interactive: { type: 'nfm_reply', nfm_reply: { response_json: JSON.stringify({ flow_token: token, ...answers }) } },
});

// --- the signature is the only thing that makes this trustworthy ---------------

const forged = await route.POST(
  new Request('http://localhost/api/webhooks/whatsapp', {
    method: 'POST',
    headers: { 'x-hub-signature-256': `sha256=${'0'.repeat(64)}` },
    body: JSON.stringify(envelope(flowReply('t', {}))),
  }),
);
equal(forged.status, 401);
equal(db.prepare('SELECT COUNT(*) n FROM whatsapp_flow_responses').get().n, 0);

// A number this deployment does not recognise is never routed to a workspace.
const stranger = await post(envelope(flowReply('t', {}), '999999999999'));
equal(stranger.status, 200);
equal(db.prepare('SELECT COUNT(*) n FROM whatsapp_flow_responses').get().n, 0);

// --- answers matched to the send that asked ------------------------------------

db.prepare(
  `INSERT INTO whatsapp_flows (id, organization_id, name, status) VALUES ('wfl_1', ?, 'Site visit request', 'PUBLISHED')`,
).run(ORG);
db.prepare(
  `INSERT INTO whatsapp_flow_responses (id, organization_id, flow_id, flow_token, phone, status)
   VALUES ('r1', ?, 'wfl_1', 'tok_sent', ?, 'sent')`,
).run(ORG, `+${PHONE}`);

const answered = await post(
  envelope(flowReply('tok_sent', { full_name: 'Asha', budget: { id: 'b2', title: 'Above 1Cr' } })),
);
equal(answered.status, 200);
const row = db.prepare(`SELECT status, answers_json, answered_at FROM whatsapp_flow_responses WHERE id = 'r1'`).get();
equal(row.status, 'answered');
equal(JSON.parse(row.answers_json), { full_name: 'Asha', budget: 'Above 1Cr' });
ok(row.answered_at);

// Meta retries. The first set of answers is the one the customer sent.
const again = await post(
  envelope(flowReply('tok_sent', { full_name: 'CHANGED', budget: 'Under 50L' }, 'wamid_2')),
);
equal(again.status, 200);
equal(
  JSON.parse(db.prepare(`SELECT answers_json FROM whatsapp_flow_responses WHERE id = 'r1'`).get().answers_json),
  { full_name: 'Asha', budget: 'Above 1Cr' },
);
equal(db.prepare('SELECT COUNT(*) n FROM whatsapp_flow_responses').get().n, 1);

// --- an answer with no matching send -------------------------------------------

// Recorded rather than dropped: it means a form went out that this workspace
// did not write down, which is worth being able to see.
const orphan = await post(envelope(flowReply('tok_unknown', { full_name: 'Ravi' }, 'wamid_3')));
equal(orphan.status, 200);
const unmatched = db
  .prepare(`SELECT status, phone, answers_json FROM whatsapp_flow_responses WHERE flow_token = 'tok_unknown'`)
  .get();
equal(unmatched.status, 'answered_unmatched');
equal(unmatched.phone, PHONE);
equal(JSON.parse(unmatched.answers_json), { full_name: 'Ravi' });

// One tenant's token can never claim another tenant's row: the workspace comes
// from the number the message arrived on, not from anything in the payload.
db.prepare(
  `INSERT INTO whatsapp_flow_responses (id, organization_id, flow_id, flow_token, phone, status)
   VALUES ('r2', 'org_other', 'wfl_9', 'tok_other', ?, 'sent')`,
).run(`+${PHONE}`);
await post(envelope(flowReply('tok_other', { full_name: 'Nope' }, 'wamid_4')));
equal(db.prepare(`SELECT status FROM whatsapp_flow_responses WHERE id = 'r2'`).get().status, 'sent');
equal(
  db.prepare(`SELECT organization_id FROM whatsapp_flow_responses WHERE flow_token = 'tok_other' AND status = 'answered_unmatched'`).get()
    .organization_id,
  ORG,
);

// --- the answers become a lead --------------------------------------------------

// A form that asks a name, a budget and a date, and then leaves all three in a
// list nobody follows up from, is a form that captured nothing.
equal(ingested.length, 3);
equal(ingested[0].organizationId, ORG);
equal(ingested[0].input.sourceType, 'whatsapp');
equal(ingested[0].input.name, 'Asha');
equal(ingested[0].input.phone, `+${PHONE}`);
// The send token, so the retry above created no second lead.
equal(ingested[0].input.externalLeadId, 'tok_sent');
ok(ingested[0].input.notes.includes('budget: Above 1Cr'));
// An unmatched answer is still somebody who filled in a form.
equal(ingested[1].input.name, 'Ravi');
// Including the one whose token belonged to another workspace: the lead goes
// to the workspace whose number received it, never to the token's owner.
equal(ingested[2].organizationId, ORG);
equal(ingested[2].input.name, 'Nope');

// A CRM failure must not turn a 200 into a retry loop that asks Meta to send
// the same completed form again.
db.prepare(
  `INSERT INTO whatsapp_flow_responses (id, organization_id, flow_id, flow_token, phone, status)
   VALUES ('r3', ?, 'wfl_1', 'tok_explode', ?, 'sent')`,
).run(ORG, `+${PHONE}`);
const survived = await post(
  envelope(flowReply('tok_explode', { full_name: 'EXPLODE Test' }, 'wamid_boom')),
);
equal(survived.status, 200);
// The answers are stored even though the lead was not.
equal(
  db.prepare(`SELECT status FROM whatsapp_flow_responses WHERE id = 'r3'`).get().status,
  'answered',
);

// --- a plain message still reaches the bot -------------------------------------

// A completed form is offered to the bot like anything else, and the bot's own
// rule refuses it — a form is not a sentence to branch on.
ok(dispatched.every((entry) => entry.message.messageType !== 'text'));
equal(dispatched.length, 5);

await post(
  envelope({ id: 'wamid_5', type: 'text', from: PHONE, text: { body: 'hello' } }),
);
const texts = dispatched.filter((entry) => entry.message.messageType === 'text');
equal(texts.length, 1);
equal(texts[0].message.isNew, true);
equal(texts[0].message.body, 'hello');
// The retry of a text message is not a second message.
await post(
  envelope({ id: 'wamid_5', type: 'text', from: PHONE, text: { body: 'hello' } }),
);
equal(dispatched.filter((entry) => entry.message.messageType === 'text')[1].message.isNew, false);

db.close();
console.log(`whatsapp flow replies: ${checks} assertions passed; no provider contacted.`);
