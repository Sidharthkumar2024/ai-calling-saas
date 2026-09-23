import assert from 'node:assert/strict';

import { resolveSpokenLiveTurn } from '../lib/live-voice-turn.ts';

let checks = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks += 1;
};

async function exerciseFailure(error) {
  const synthesized = [];
  const failures = [];
  const result = await resolveSpokenLiveTurn({
    fallback: {
      text: 'जी, मैंने आपकी बात सुनी। बताइए, मैं आपकी क्या मदद करूँ?',
      latencyMs: 14,
    },
    reason: async () => {
      throw error;
    },
    synthesize: async (text) => {
      synthesized.push(text);
      return {
        audioBase64: '/3/+gA==',
        contentType: 'audio/basic',
        latencyMs: 23,
      };
    },
    onReasoningFallback: (caught) => failures.push(caught),
  });
  return { result, synthesized, failures };
}

const missing = await exerciseFailure(
  new Error('Vaani Sense is not connected.'),
);
equal(missing.result.mode, 'fallback', 'missing provider selects fallback');
equal(
  missing.result.text,
  'जी, मैंने आपकी बात सुनी। बताइए, मैं आपकी क्या मदद करूँ?',
  'the deterministic reply is spoken',
);
equal(
  missing.synthesized,
  [missing.result.text],
  'fallback text reaches the selected synthesis engine exactly once',
);
equal(
  missing.result.speech.audioBase64,
  '/3/+gA==',
  'the live response contains carrier-playable synthesized audio',
);
equal(missing.result.speech.contentType, 'audio/basic');
equal(missing.result.toolCalls, [], 'preview actions never execute live');
equal(missing.failures.length, 1, 'the configuration failure is observable');

const transient = await exerciseFailure(new Error('upstream timeout'));
equal(
  transient.result.mode,
  'fallback',
  'a transient reasoning failure also keeps the call speaking',
);
equal(
  transient.result.speech.audioBase64.length > 0,
  true,
  'transient failure still returns non-empty synthesized audio',
);

let connectedSynthesis = '';
const connected = await resolveSpokenLiveTurn({
  fallback: { text: 'fallback', latencyMs: 1 },
  reason: async () => ({
    text: 'Connected answer',
    latencyMs: 31,
    toolCalls: [{ name: 'lookup_customer', input: {}, result: { ok: true } }],
  }),
  synthesize: async (text) => {
    connectedSynthesis = text;
    return {
      audioBase64: 'AQI=',
      contentType: 'audio/basic',
      latencyMs: 5,
    };
  },
});
equal(connected.mode, 'connected', 'healthy reasoning remains preferred');
equal(connectedSynthesis, 'Connected answer');
equal(connected.toolCalls.length, 1, 'real tool calls remain intact');

console.log(`${checks} live voice reasoning fallback checks passed`);
