import assert from 'node:assert/strict';

import {
  CUSTOMER_INTEGRATION_CATALOG,
  CUSTOMER_INTEGRATION_TYPES,
  isPlatformManagedIntegration,
} from '../lib/integration-catalog.ts';
import {
  CARTESIA_API_VERSION,
  listCartesiaVoices,
  probePlatformProvider,
} from '../lib/platform-provider-probe.ts';

let checks = 0;
function equal(actual, expected) {
  assert.deepEqual(actual, expected);
  checks += 1;
}

for (const type of [
  'deepgram',
  'elevenlabs_voice',
  'cartesia',
  'cartesia_voice',
  'sarvam_voice',
]) {
  equal(isPlatformManagedIntegration(type), true);
  equal(CUSTOMER_INTEGRATION_TYPES.has(type), false);
  equal(
    CUSTOMER_INTEGRATION_CATALOG.some((entry) => entry.id === type),
    false,
  );
}
equal(CUSTOMER_INTEGRATION_TYPES.has('telephony_vobiz'), true);

let request = null;
const deepgram = await probePlatformProvider(
  { provider: 'deepgram', apiKey: 'dg-secret' },
  async (url, init) => {
    request = { url, init };
    return Response.json({
      metadata: { request_id: 'probe_1' },
      results: { channels: [{ alternatives: [{ transcript: '' }] }] },
    });
  },
);
equal(deepgram.status, 200);
equal(request.url.startsWith('https://api.deepgram.com/v1/listen?'), true);
equal(request.init.method, 'POST');
equal(request.init.headers['content-type'], 'audio/wav');
equal(request.init.body.byteLength > 44, true);
equal(new TextDecoder().decode(request.init.body.slice(0, 4)), 'RIFF');
equal(new TextDecoder().decode(request.init.body.slice(8, 12)), 'WAVE');
equal(request.init.headers.authorization, 'Token dg-secret');

await assert.rejects(
  probePlatformProvider(
    { provider: 'elevenlabs', apiKey: 'eleven-secret', config: {} },
    async () => Response.json({ voices: [] }),
  ),
  /default ElevenLabs voice/,
);
checks += 1;
equal(
  (
    await probePlatformProvider(
      {
        provider: 'elevenlabs',
        apiKey: 'eleven-secret',
        config: { voiceId: 'voice_one' },
      },
      async (_url, init) => {
        equal(init.headers['xi-api-key'], 'eleven-secret');
        return Response.json({ voices: [{ voice_id: 'voice_one' }] });
      },
    )
  ).status,
  200,
);

equal(
  (
    await probePlatformProvider(
      {
        provider: 'cartesia',
        apiKey: 'cartesia-secret',
        config: {
          voiceId: 'voice_cartesia',
        },
      },
      async (url, init) => {
        equal(url, 'https://api.cartesia.ai/voices?limit=100');
        equal(init.headers.authorization, 'Bearer cartesia-secret');
        equal(init.headers['cartesia-version'], CARTESIA_API_VERSION);
        return Response.json({
          data: [
            {
              id: 'voice_cartesia',
              name: 'Aarohi',
              language: 'hi',
              accent: 'hindi',
              gender: 'feminine',
            },
          ],
        });
      },
    )
  ).status,
  200,
);

const cartesiaList = await listCartesiaVoices(
  {
    apiKey: 'cartesia-secret',
    config: {
      apiVersion: 'custom-version',
      baseUrl: 'http://127.0.0.1:7777',
    },
  },
  async (url, init) => {
    equal(url, 'https://api.cartesia.ai/voices?limit=100');
    equal(init.headers['cartesia-version'], 'custom-version');
    equal(init.headers.authorization, 'Bearer cartesia-secret');
    equal(init.redirect, 'manual');
    return Response.json({
      data: [
        { id: 'voice_z', name: 'Zara', tagline: 'Warm' },
        {
          id: 'voice_a',
          name: 'Aarohi',
          language: 'hi',
          accent: 'hindi',
          gender: 'feminine',
        },
        { name: 'Missing identifier' },
      ],
    });
  },
);
equal(cartesiaList.voices, [
  {
    voiceId: 'voice_a',
    name: 'Aarohi',
    category: 'hi · hindi · feminine',
  },
  { voiceId: 'voice_z', name: 'Zara', category: 'Warm' },
]);

equal(
  (
    await probePlatformProvider(
      { provider: 'sarvam', apiKey: 'sarvam-secret', config: {} },
      async (url, init) => {
        equal(url, 'https://api.sarvam.ai/text-to-speech');
        equal(init.method, 'POST');
        equal(init.headers['api-subscription-key'], 'sarvam-secret');
        const body = JSON.parse(init.body);
        equal(body.language_code, 'hi-IN');
        equal(body.text, 'नमस्ते');
        return Response.json({ audios: ['d2F2'] });
      },
    )
  ).status,
  200,
);

await assert.rejects(
  probePlatformProvider(
    { provider: 'deepgram', apiKey: 'bad-secret' },
    async () =>
      Response.json(
        { error: { message: 'credential rejected' } },
        { status: 401 },
      ),
  ),
  /HTTP 401.*credential rejected/,
);
checks += 1;

await assert.rejects(
  probePlatformProvider(
    { provider: 'deepgram', apiKey: 'no-stt-permission' },
    async () =>
      Response.json(
        { error: 'insufficient_scope: speech_to_text' },
        { status: 403 },
      ),
  ),
  /speech-to-text probe failed.*403.*speech_to_text/,
);
checks += 1;

console.log(
  `platform provider ownership and probes: ${checks} assertions passed; no real provider contacted.`,
);
