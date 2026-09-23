/**
 * Exercises the real TTS adapter with provider HTTP stubbed at the network
 * boundary. No credential is read and no provider is contacted.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import ts from 'typescript';

import * as cartesia from '../lib/cartesia.ts';
import * as languages from '../lib/languages.ts';
import * as providerHttp from '../lib/provider-http.ts';
import * as sttRouter from '../lib/stt-router.ts';
import * as ttsRouter from '../lib/tts-router.ts';
import * as vobiz from '../lib/vobiz.ts';

let checks = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks += 1;
};

const platform = {
  sarvam: { apiKey: 'sarvam-test-key', config: {}, disabled: false },
  elevenlabs: {
    apiKey: 'eleven-test-key',
    config: { voiceId: 'voice_test', modelId: 'eleven_multilingual_v2' },
    disabled: false,
  },
  cartesia: { apiKey: undefined, config: {}, disabled: false },
};
const db = {
  prepare: () => ({
    bind: () => ({
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({ meta: { changes: 1 } }),
    }),
  }),
};
const modules = {
  '@/db/index': { getRawDb: () => db },
  '@/lib/agent-tools': {
    executeAgentTool: async () => ({}),
    toolsForAgent: () => [],
  },
  '@/lib/knowledge-retrieval': { retrieveKnowledge: async () => [] },
  '@/lib/sales-intelligence-service': { objectionPlaybook: async () => '' },
  '@/lib/playbook-service': { approvedPlaybookBlock: async () => '' },
  '@/lib/metering': { recordMeteredUsage: async () => ({}) },
  '@/lib/reasoning-budget': { reasoningBudget: (value) => value ?? 700 },
  '@/lib/security': { decryptSecret: async () => ({}) },
  '@/lib/platform-secrets': {
    readPlatformSecret: async (provider) =>
      platform[provider] ?? {
        apiKey: undefined,
        config: {},
        disabled: false,
      },
  },
  '@/lib/vobiz': vobiz,
  '@/lib/deepgram-stt': { deepgramTranscript: async () => ({}) },
  '@/lib/cartesia': cartesia,
  '@/lib/provider-http': providerHttp,
  '@/lib/stt-router': sttRouter,
  '@/lib/tts-router': ttsRouter,
  '@/lib/languages': languages,
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
    if (!modules[id]) throw new Error(`Unstubbed module: ${id}`);
    return modules[id];
  },
  adapters,
  { env: {} },
);

const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const target =
    typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
  calls.push({ target, init });
  if (target.includes('sarvam.ai'))
    return Response.json(
      { error: { message: 'temporary upstream failure' } },
      { status: 503 },
    );
  if (target.includes('elevenlabs.io'))
    return new Response(Uint8Array.from([0xff, 0x7f, 0xfe, 0x80]), {
      status: 200,
      // Deliberately generic: the adapter must preserve the requested raw
      // telephony type rather than hand this unusable label to the gateway.
      headers: {
        'content-type': 'application/octet-stream',
        'request-id': 'eleven_request_1',
      },
    });
  if (target.includes('api.cartesia.ai'))
    return new Response(Uint8Array.from([0xff, 0x7f]), {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'x-request-id': 'cartesia_request_1',
      },
    });
  throw new Error(`Unexpected URL: ${target}`);
};

try {
  const result = await adapters.synthesizeSpeech({
    organizationId: 'org_test',
    text: 'नमस्ते, मैं आरोही बोल रही हूँ।',
    languageCode: 'hinglish',
    voice: { provider: 'sarvam', voiceId: 'shubh' },
    outputFormat: 'ulaw_8000',
  });
  equal(
    calls.filter((call) => call.target.includes('sarvam.ai')).length,
    2,
    'a transient primary TTS failure gets one bounded retry',
  );
  equal(
    calls.filter((call) => call.target.includes('elevenlabs.io')).length,
    1,
    'the multilingual fallback runs after the primary retry budget',
  );
  equal(
    result.contentType,
    'audio/basic',
    'raw mulaw keeps a telephony-playable content type',
  );
  equal(result.providerReference, 'eleven_request_1');
  equal(result.audioBase64, '/3/+gA==');

  platform.cartesia = {
    apiKey: 'cartesia-test-key',
    config: {
      voiceId: 'cartesia_voice',
      baseUrl: 'http://127.0.0.1:7777',
    },
    disabled: false,
  };
  const cartesia = await adapters.synthesizeSpeech({
    organizationId: 'org_test',
    text: 'Hello from Call Vani.',
    languageCode: 'en-IN',
    voice: { provider: 'cartesia', voiceId: 'cartesia_voice' },
    outputFormat: 'ulaw_8000',
  });
  const cartesiaCall = calls.find((call) =>
    call.target.includes('api.cartesia.ai'),
  );
  equal(Boolean(cartesiaCall), true, 'a selected Cartesia profile is used');
  equal(
    cartesiaCall.target,
    'https://api.cartesia.ai/tts/bytes',
    'Cartesia synthesis is pinned to the official endpoint',
  );
  equal(
    calls.some((call) => call.target.includes('127.0.0.1:7777')),
    false,
    'a stored Cartesia base URL cannot receive the platform key',
  );
  equal(
    cartesiaCall.init.redirect,
    'manual',
    'Cartesia synthesis does not forward the key across redirects',
  );
  equal(
    cartesiaCall.init.headers['cartesia-version'],
    '2026-08-14',
    'Cartesia synthesis uses the current API contract by default',
  );
  equal(
    JSON.parse(cartesiaCall.init.body).output_format,
    { container: 'raw', encoding: 'pcm_mulaw', sample_rate: 8000 },
    'Cartesia requests carrier-native 8 kHz mulaw audio',
  );
  equal(cartesia.contentType, 'audio/basic');
  equal(cartesia.providerReference, 'cartesia_request_1');
} finally {
  globalThis.fetch = originalFetch;
}

console.log(
  `voice provider fallback: ${checks} assertions passed; no provider contacted.`,
);
