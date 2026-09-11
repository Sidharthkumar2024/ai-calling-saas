/**
 * The catalogue the model asked about, not the one that happened to be biggest.
 *
 * `search_catalog` falls back to the workspace's busiest object when the model
 * names none — reasonable, because a single-catalogue workspace should not
 * have to be told its own object key every turn. The same fallback also caught
 * a name the workspace does not have, so asking about "policies" in a
 * workspace that sells flats searched the flats and read the answer out as
 * though it were about policies. On a live call, to a customer.
 *
 * Compiles the real lib/agent-tools.ts against stubs. No provider is
 * contacted.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

const OBJECTS = [
  { id: 'object_flat', key: 'flat', name: 'Flat', pluralName: 'Flats', fields: [] },
  { id: 'object_plot', key: 'plot', name: 'Plot', pluralName: 'Plots', fields: [] },
];
/** Every search the tool actually ran. */
const searched = [];

const stub = new Proxy({}, { get: () => async () => ({}) });
const modules = {
  '@/db/index': {
    getRawDb: () => ({
      prepare: () => ({
        bind: () => ({
          first: async () => null,
          all: async () => ({ results: [] }),
          run: async () => ({ meta: { changes: 0 } }),
        }),
      }),
      batch: async () => [],
    }),
  },
  '@/lib/action-policy': { DEFAULT_REFUND_POLICY: {} },
  '@/lib/handoff-service': stub,
  '@/lib/object-store': {
    listObjects: async () => OBJECTS,
    getObject: async (unusedOrg, key) =>
      OBJECTS.find((entry) => entry.key === key) ?? null,
    searchRecords: async (input) => {
      searched.push(input.object.key);
      return { records: [{ id: 'rec_1', title: 'Two bed in Andheri' }], total: 1, skipped: [] };
    },
    countRecords: async (unusedOrg, object) => (object.key === 'flat' ? 40 : 2),
  },
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
  '@/lib/commerce': { createRazorpayPaymentLink: async () => ({}), whatsAppConnected: async () => true },
  '@/lib/job-enqueue': { enqueueJob: async () => ({}) },
  '@/lib/appointment-service': stub,
  '@/lib/appointments': { DEFAULT_TIMEZONE: 'Asia/Kolkata', describeSlot: () => '', todayIn: () => '2026-09-11' },
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

const ctx = { organizationId: 'org_test', agentId: null, sessionId: 'call_1' };
const search = (input) => tools.executeAgentTool('search_catalog', input, ctx);

// THE ONE THAT MATTERED. A name this workspace does not have.
const missing = await search({ object: 'policy', query: 'premium' });
equal(missing.ok, false, 'a catalogue the workspace does not have is a miss');
equal(missing.reason, 'unknown_object');
equal(missing.requested, 'policy', 'and it names what was asked for');
equal(missing.available, ['flat', 'plot'], 'and what there is instead');
equal(searched.length, 0, 'nothing else was searched on the way');
ok(
  String(missing.say_to_customer ?? '').length > 0,
  'the model is told what to say rather than left to improvise',
);

// The name that does exist is the one searched.
await search({ object: 'plot', query: 'corner' });
equal(searched.at(-1), 'plot');

// An id works as well as a key, because the tool accepts both.
await search({ object: 'object_flat', query: 'andheri' });
equal(searched.at(-1), 'flat');

// Naming nothing still falls back to the busiest catalogue — that is the
// behaviour the fallback was written for, and it stays.
await search({ query: 'andheri' });
equal(searched.at(-1), 'flat', 'no name given falls back to the busiest object');
await search({ object: '', query: 'andheri' });
equal(searched.at(-1), 'flat', 'and an empty name is the same as none');

console.log(`catalog tool: ${checks} assertions passed; no provider contacted.`);
