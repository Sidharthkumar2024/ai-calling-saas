/** Sarvam reasoning request/response contract. No provider is contacted. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import ts from 'typescript';

import * as languages from '../lib/languages.ts';
import * as reasoningBudget from '../lib/reasoning-budget.ts';
import * as vobiz from '../lib/vobiz.ts';

let checks = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks += 1;
};

const requests = [];
const metering = [];
let sarvamConfig = {};
let reply = {
  id: 'chat_text',
  choices: [
    {
      finish_reason: 'stop',
      message: { content: 'Namaste, main Aarohi bol rahi hoon.' },
    },
  ],
  usage: { prompt_tokens: 19, completion_tokens: 8 },
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  requests.push({
    url: typeof url === 'string' ? url : (url?.url ?? ''),
    headers: init?.headers,
    body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}'),
  });
  return { ok: true, status: 200, json: async () => reply };
};

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
  '@/lib/metering': {
    recordMeteredUsage: async (input) => metering.push(input),
  },
  '@/lib/rate-cards': {},
  '@/lib/reasoning-budget': reasoningBudget,
  '@/lib/security': { decryptSecret: async (value) => value },
  '@/lib/platform-secrets': {
    readPlatformSecret: async (provider) =>
      provider === 'sarvam'
        ? {
            apiKey: 'sarvam-platform-key',
            config: sarvamConfig,
            disabled: false,
          }
        : { apiKey: undefined, config: {}, disabled: false },
  },
  '@/lib/deepgram-stt': { deepgramTranscript: async () => null },
  '@/lib/cartesia': { CARTESIA_TTS_URL: 'https://api.cartesia.test/tts' },
  '@/lib/provider-http': {
    fetchProviderWithRetry: async () => null,
    providerFailureDetail: async () => '',
  },
  '@/lib/stt-router': { sttProviderOrder: () => [] },
  '@/lib/tts-router': { routeSynthesis: () => null },
  '@/lib/languages': languages,
  '@/lib/vobiz': vobiz,
};
const adapters = {};
compileFunction(
  ts.transpileModule(
    readFileSync(new URL('../lib/provider-adapters.ts', import.meta.url), 'utf8'),
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
  { env: {} },
);

const text = await adapters.reasonWithTools({
  organizationId: 'org_callvani',
  system: 'You are Aarohi.',
  messages: [{ role: 'user', content: 'Aap kya karti hain?' }],
  maxTokens: 220,
});
equal(requests[0].url, 'https://api.sarvam.ai/v1/chat/completions');
equal(requests[0].headers['api-subscription-key'], 'sarvam-platform-key');
equal(requests[0].body.model, 'sarvam-105b-conversations');
equal(requests[0].body.messages, [
  { role: 'system', content: 'You are Aarohi.' },
  { role: 'user', content: 'Aap kya karti hain?' },
]);
equal(text.content, [
  { type: 'text', text: 'Namaste, main Aarohi bol rahi hoon.' },
]);
equal(
  metering.map(({ provider, category, operation, units }) => ({
    provider,
    category,
    operation,
    units,
  })),
  [
    {
      provider: 'sarvam',
      category: 'reasoning',
      operation: 'input_tokens',
      units: 19,
    },
    {
      provider: 'sarvam',
      category: 'reasoning',
      operation: 'output_tokens',
      units: 8,
    },
  ],
);

sarvamConfig = { reasoningModel: 'sarvam-105b-conversations-canary' };
reply = {
  id: 'chat_tool',
  choices: [
    {
      finish_reason: 'tool_calls',
      message: {
        content: null,
        tool_calls: [
          {
            id: 'call_lead_1',
            function: {
              name: 'create_lead',
              arguments: '{"name":"Demo Customer","phone":"+919999999999"}',
            },
          },
        ],
      },
    },
  ],
  usage: { prompt_tokens: 31, completion_tokens: 14 },
};
const tool = await adapters.reasonWithTools({
  organizationId: 'org_callvani',
  system: 'Use real tools.',
  messages: [{ role: 'user', content: 'Save my details.' }],
  tools: [
    {
      name: 'create_lead',
      description: 'Create a lead.',
      input_schema: {
        type: 'object',
        properties: { name: { type: 'string' }, phone: { type: 'string' } },
        required: ['name', 'phone'],
      },
    },
  ],
});
equal(requests[1].body.model, 'sarvam-105b-conversations-canary');
equal(requests[1].body.tools[0], {
  type: 'function',
  function: {
    name: 'create_lead',
    description: 'Create a lead.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' }, phone: { type: 'string' } },
      required: ['name', 'phone'],
    },
  },
});
equal(tool.stop_reason, 'tool_use');
equal(tool.content, [
  {
    type: 'tool_use',
    id: 'call_lead_1',
    name: 'create_lead',
    input: { name: 'Demo Customer', phone: '+919999999999' },
  },
]);

reply = {
  id: 'chat_after_tool',
  choices: [{ finish_reason: 'stop', message: { content: 'Saved.' } }],
  usage: { prompt_tokens: 40, completion_tokens: 2 },
};
await adapters.reasonWithTools({
  organizationId: 'org_callvani',
  system: 'Use real tools.',
  messages: [
    { role: 'assistant', content: tool.content },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call_lead_1',
          content: '{"ok":true}',
        },
      ],
    },
  ],
});
equal(requests[2].body.messages.slice(1), [
  {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: 'call_lead_1',
        type: 'function',
        function: {
          name: 'create_lead',
          arguments: '{"name":"Demo Customer","phone":"+919999999999"}',
        },
      },
    ],
  },
  { role: 'tool', content: '{"ok":true}', tool_call_id: 'call_lead_1' },
]);

globalThis.fetch = originalFetch;
console.log(
  `sarvam reasoning: ${checks} assertions passed; no provider contacted.`,
);
