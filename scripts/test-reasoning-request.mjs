/**
 * What actually leaves the building.
 *
 * The budget is a pure function tested on its own, but the bug was never in
 * the arithmetic — it was that the arithmetic sat inline in the request body,
 * where nothing could see it disagree with the caller. So this runs the real
 * adapter against a stubbed workspace and reads the request it would have
 * sent: no provider is contacted, the fetch never leaves this file.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import ts from 'typescript';

import * as languages from '../lib/languages.ts';
import * as cartesia from '../lib/cartesia.ts';
import * as vobiz from '../lib/vobiz.ts';
import * as reasoningBudget from '../lib/reasoning-budget.ts';

let checks = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks += 1;
};

/** Every request the adapter tried to make. */
const requests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const target = typeof url === 'string' ? url : (url?.url ?? '');
  const sent = typeof init?.body === 'string' ? init.body : '{}';
  requests.push({ url: target, body: JSON.parse(sent) });
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: 'msg_test',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  };
};

const noop = () => undefined;
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
    }),
  },
  '@/lib/agent-tools': {
    executeAgentTool: async () => ({}),
    toolsForAgent: () => [],
  },
  '@/lib/knowledge-retrieval': { retrieveKnowledge: async () => [] },
  '@/lib/sales-intelligence-service': { objectionPlaybook: async () => '' },
  '@/lib/playbook-service': { approvedPlaybookBlock: async () => '' },
  '@/lib/metering': { recordMeteredUsage: async () => noop() },
  '@/lib/rate-cards': {},
  '@/lib/reasoning-budget': reasoningBudget,
  '@/lib/security': { decryptSecret: async (value) => value },
  '@/lib/platform-secrets': {
    readPlatformSecret: async () => ({
      apiKey: undefined,
      config: {},
      disabled: false,
    }),
  },
  '@/lib/provider-http': {
    fetchProviderWithRetry: async (_provider, request) => request(1),
    providerFailureDetail: (error) => String(error?.message ?? error),
  },
  '@/lib/deepgram-stt': { deepgramTranscript: async () => null },
  '@/lib/stt-router': { sttProviderOrder: () => [] },
  '@/lib/tts-router': { routeSynthesis: async () => null },
  '@/lib/languages': languages,
  '@/lib/cartesia': cartesia,
  // Pure and dependency-free, so the real module is registered rather than a
  // stub: a stubbed URL builder would let this harness pass over a Vobiz call
  // addressed to nowhere.
  '@/lib/vobiz': vobiz,
};

const adapters = {};
compileFunction(
  ts.transpileModule(
    readFileSync(
      new URL('../lib/provider-adapters.ts', import.meta.url),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  ['require', 'exports', 'process'],
)(
  (id) => {
    if (!modules[id]) throw Error(id);
    return modules[id];
  },
  adapters,
  // The workspace has no connection of its own; the key comes from the
  // environment, which is the path a self-hosted deployment takes.
  { env: { ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_MODEL: 'test-model' } },
);

const ask = async (maxTokens) => {
  requests.length = 0;
  await adapters.reasonWithTools({
    organizationId: 'org_test',
    system: 'You are a test.',
    messages: [{ role: 'user', content: 'Hello.' }],
    ...(maxTokens === undefined ? {} : { maxTokens }),
  });
  return requests.at(-1);
};

// The two budgets the old inline clamp overruled, measured on the wire.
equal(
  (await ask(2000)).body.max_tokens,
  2000,
  'the schema builder gets the room it asks for',
);
equal(
  (await ask(900)).body.max_tokens,
  900,
  'a tool-calling turn keeps its raised floor',
);
// The default and the ceiling still hold at the boundary.
equal((await ask(undefined)).body.max_tokens, 700);
equal((await ask(50_000)).body.max_tokens, 2000);
equal((await ask(0)).body.max_tokens, 40);
// And it is the reasoning endpoint being asked, not something else.
equal((await ask(900)).url, 'https://api.anthropic.com/v1/messages');

globalThis.fetch = originalFetch;
console.log(
  `reasoning request: ${checks} assertions passed; no provider contacted.`,
);
