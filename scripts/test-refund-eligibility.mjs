/**
 * Whether a refund is bigger than the payment it refers to.
 *
 * `request_refund` runs a deterministic eligibility check before the policy
 * engine sees the case, and `eligibility.passed` is what decides whether a
 * refund can be executed with no human in it at all. So the two questions the
 * check exists to answer have to actually be answered:
 *
 *  - is this more money than the customer paid?
 *  - did the customer pay at all?
 *
 * Compiles the real lib/agent-tools.ts against in-memory SQLite and the real
 * policy engine. No provider is contacted and no money moves.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { compileFunction } from 'node:vm';
import ts from 'typescript';

import * as actionPolicy from '../lib/action-policy.ts';

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
  CREATE TABLE payment_links (id TEXT PRIMARY KEY, organization_id TEXT, reference_id TEXT,
    amount INTEGER, status TEXT, paid_at TEXT);
  CREATE TABLE refunds (id TEXT PRIMARY KEY, organization_id TEXT, order_reference TEXT,
    amount INTEGER, status TEXT);
`);

// Rupees on the wire, paise in the column — the same convention every other
// writer of payment_links.amount follows, and the reason create_payment_link
// multiplies by 100 before it inserts.
const paid = (reference, rupees, status = 'paid') =>
  db
    .prepare(
      `INSERT INTO payment_links (id, organization_id, reference_id, amount, status) VALUES (?,?,?,?,?)`,
    )
    .run(`paylink_${reference}`, ORG, reference, rupees * 100, status);

paid('ORD-500', 500);
paid('ORD-200', 200);
paid('ORD-UNPAID', 5000, 'sent');
paid('ORD-CREATED', 5000, 'created');

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

/** Every approval card the tool raised, with the eligibility it was handed. */
const cards = [];
/** Every refund actually recorded — money on its way out. */
const recorded = [];

const stub = new Proxy({}, { get: () => async () => ({}) });
const modules = {
  '@/db/index': { getRawDb: () => ({ prepare: statement, batch: async () => [] }) },
  '@/lib/action-policy': actionPolicy,
  '@/lib/handoff-service': {
    // The real policy engine decides, so the test measures the consequence of
    // the eligibility verdict rather than restating it.
    createApprovalRequest: async (input) => {
      const verdict = actionPolicy.evaluateAction({
        policy: input.policy,
        amount: input.amount,
        eligibility: input.eligibility,
        conditions: input.conditions,
      });
      cards.push({ input, verdict });
      return {
        approvalId: `ap_${cards.length}`,
        decision: verdict.decision,
        riskLevel: verdict.riskLevel,
        policyVersion: verdict.policyVersion,
        reasons: verdict.reasons,
      };
    },
    recordRefundRequest: async (input) => {
      recorded.push(input);
      return { refundId: `refund_${recorded.length}` };
    },
    createHandoff: async () => ({}),
    resolveRouting: async () => ({}),
  },
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
    whatsAppConnected: async () => true,
  },
  '@/lib/job-enqueue': { enqueueJob: async () => ({}) },
  '@/lib/appointment-service': stub,
  '@/lib/appointments': {
    DEFAULT_TIMEZONE: 'Asia/Kolkata',
    describeSlot: () => '',
    todayIn: () => '2026-09-10',
  },
  '@/lib/document-request-service': stub,
};

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

const ctx = { organizationId: ORG, agentId: null, sessionId: 'call_1' };
const refund = async (amount, orderReference) => {
  const before = cards.length;
  const result = await tools.executeAgentTool(
    'request_refund',
    { amount, order_reference: orderReference, reason: 'Caller asked for their money back' },
    ctx,
  );
  return { result, card: cards[before] };
};

// --- the amount actually paid ---------------------------------------------------

// Refunding what was paid is fine.
const exact = await refund(500, 'ORD-500');
equal(exact.card.input.eligibility.passed, true, 'a refund of the full amount is eligible');

// THE ONE THAT MATTERS. ₹500 is stored as 50000 paise, so comparing the paise
// column against a rupee request made this check 100× too generous: a caller
// who paid ₹200 could ask for ₹500 and be told the amount does not exceed the
// payment — and ₹500 is exactly the ceiling the policy will execute with no
// human in it at all.
const overclaim = await refund(500, 'ORD-200');
equal(
  overclaim.card.input.eligibility.passed,
  false,
  'refunding more than was paid is not eligible',
);
ok(
  overclaim.card.input.eligibility.failed.includes('amount_exceeds_payment'),
  'and it says which check failed',
);
equal(
  overclaim.card.verdict.decision,
  'manager_approval',
  'so it goes to a person rather than executing itself',
);
equal(recorded.length, 1, 'only the eligible one has been recorded so far');

// A rupee over is still over.
const justOver = await refund(201, 'ORD-200');
equal(justOver.card.input.eligibility.passed, false);

// Under is fine.
const partial = await refund(150, 'ORD-200');
equal(partial.card.input.eligibility.passed, true);

// --- money that was never received ----------------------------------------------

// A link that was sent and never paid is not a payment. Refunding against it
// sends money out for money that never came in.
const unpaid = await refund(300, 'ORD-UNPAID');
equal(unpaid.card.input.eligibility.passed, false, 'an unpaid link is not a payment');
ok(unpaid.card.input.eligibility.failed.includes('payment_not_paid'));
const created = await refund(300, 'ORD-CREATED');
equal(created.card.input.eligibility.passed, false);

// --- what was already true ------------------------------------------------------

// No reference at all is still refused.
const noReference = await tools.executeAgentTool(
  'request_refund',
  { amount: 100, reason: 'no order given' },
  ctx,
);
ok(noReference, 'a refund with no reference still answers');
const last = cards[cards.length - 1];
ok(last.input.eligibility.failed.includes('order_reference_missing'));

// A reference nobody has is refused.
await refund(100, 'ORD-NOBODY');
ok(cards[cards.length - 1].input.eligibility.failed.includes('payment_record_not_found'));

// Nothing in this file moved money except the eligible cases.
ok(
  recorded.every((entry) => entry.amount <= 500),
  'nothing above the AI ceiling was executed automatically',
);

console.log(`refund eligibility: ${checks} assertions passed; no provider contacted.`);
