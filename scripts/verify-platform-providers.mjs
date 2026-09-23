#!/usr/bin/env node

import { resolve } from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';

const probeableProviders = new Set([
  'deepgram',
  'cartesia',
  'elevenlabs',
  'sarvam',
]);

const argumentsList = process.argv.slice(2);
const productionMode = argumentsList.includes('--production');
const requestedProviders = argumentsList.filter(
  (argument) => argument !== '--production',
);
const providers =
  requestedProviders.length > 0 ? requestedProviders : [...probeableProviders];
const databasePath =
  process.env.CALLVANI_SQLITE_PATH?.trim() ||
  (productionMode
    ? '/var/lib/callvani/runtime/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite'
    : '');
const encryptionKey = process.env.VAANI_ENCRYPTION_KEY?.trim();

const providerRowIds = {
  deepgram: 'provider_deepgram',
  cartesia: 'provider_cartesia',
  elevenlabs: 'provider_elevenlabs',
  sarvam: 'provider_sarvam',
};

if (
  !databasePath ||
  !encryptionKey ||
  encryptionKey.length < 32 ||
  providers.some((provider) => !probeableProviders.has(provider))
) {
  console.error(
    'Usage: CALLVANI_SQLITE_PATH=/absolute/app.sqlite VAANI_ENCRYPTION_KEY=... node --experimental-strip-types scripts/verify-platform-providers.mjs [--production] [deepgram cartesia elevenlabs sarvam]',
  );
  process.exit(2);
}

function fromBase64Url(value) {
  return new Uint8Array(
    Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
  );
}

async function decryptSecret(encoded) {
  const [version, ivValue, encryptedValue] = String(encoded ?? '').split('.');
  if (version !== 'v1' || !ivValue || !encryptedValue)
    throw new Error('Encrypted credential format is invalid.');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(encryptionKey),
  );
  const key = await crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(ivValue) },
    key,
    fromBase64Url(encryptedValue),
  );
  const parsed = JSON.parse(new TextDecoder().decode(decrypted));
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function publicConfig(raw) {
  try {
    const parsed = JSON.parse(String(raw || '{}'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function configText(config, key) {
  return typeof config[key] === 'string' ? config[key].trim() : '';
}

function errorDetail(raw) {
  try {
    const parsed = JSON.parse(raw);
    const candidate = parsed.error ?? parsed.detail ?? parsed.message;
    if (typeof candidate === 'string') return candidate.slice(0, 180);
    if (candidate && typeof candidate === 'object') {
      const value =
        typeof candidate.message === 'string'
          ? candidate.message
          : typeof candidate.code === 'string'
            ? candidate.code
            : '';
      return value.slice(0, 180);
    }
  } catch {
    // Keep a short provider response below when it is not JSON.
  }
  return raw.replace(/\s+/g, ' ').trim().slice(0, 180);
}

function silentWav(sampleRate = 16_000, durationMs = 250) {
  const samples = Math.round((sampleRate * durationMs) / 1000);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const write = (offset, value) => {
    for (let index = 0; index < value.length; index += 1)
      view.setUint8(offset + index, value.charCodeAt(index));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples * 2, true);
  return buffer;
}

async function providerFetch(url, init) {
  const response = await fetch(url, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const detail = errorDetail(await response.text());
    throw new Error(
      `Provider rejected the connection (HTTP ${response.status})${detail ? `: ${detail}` : '.'}`,
    );
  }
  return response;
}

async function probePlatformProvider({ provider, apiKey, config }) {
  if (provider === 'deepgram') {
    const model = configText(config, 'model') || 'nova-3';
    const params = new URLSearchParams({
      model,
      smart_format: 'true',
      detect_language: 'true',
    });
    const response = await providerFetch(
      `https://api.deepgram.com/v1/listen?${params}`,
      {
        method: 'POST',
        headers: {
          authorization: `Token ${apiKey}`,
          'content-type': 'audio/wav',
        },
        body: silentWav(),
      },
    );
    return {
      detail: `Credential and ${model} speech-to-text permission verified.`,
      status: response.status,
    };
  }

  if (provider === 'elevenlabs') {
    const voiceId = configText(config, 'voiceId');
    if (!voiceId)
      throw new Error(
        'Choose and save a default ElevenLabs voice before testing.',
      );
    const response = await providerFetch(
      'https://api.elevenlabs.io/v1/voices',
      {
        headers: { 'xi-api-key': apiKey },
      },
    );
    const payload = await response.json();
    if (!payload.voices?.some((voice) => voice.voice_id === voiceId))
      throw new Error(
        'The saved ElevenLabs voice ID is not available to this API key.',
      );
    return {
      detail: 'Credential and saved voice configuration verified.',
      status: response.status,
    };
  }

  if (provider === 'cartesia') {
    const voiceId = configText(config, 'voiceId');
    if (!voiceId)
      throw new Error('Save a default Cartesia voice before testing.');
    const apiVersion = configText(config, 'apiVersion') || '2026-08-14';
    const response = await providerFetch(
      'https://api.cartesia.ai/voices?limit=100',
      {
        headers: {
          authorization: `Bearer ${apiKey}`,
          'cartesia-version': apiVersion,
        },
      },
    );
    const payload = await response.json();
    const voices = Array.isArray(payload) ? payload : payload.data;
    if (!Array.isArray(voices) || !voices.some((voice) => voice.id === voiceId))
      throw new Error(
        'The saved Cartesia voice ID is not available to this API key.',
      );
    return {
      detail: 'Credential and saved voice configuration verified.',
      status: response.status,
    };
  }

  const response = await providerFetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: {
      'api-subscription-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      text: 'नमस्ते',
      language_code: 'hi-IN',
      speaker: configText(config, 'speaker') || 'shubh',
      model: configText(config, 'model') || 'bulbul:v3',
      output_audio_codec: 'wav',
      speech_sample_rate: 8000,
    }),
  });
  const payload = await response.json();
  if (!Array.isArray(payload.audios) || !payload.audios[0])
    throw new Error('Sarvam responded without synthesized audio.');
  return {
    detail: 'Credential and Hindi speech synthesis verified.',
    status: response.status,
  };
}

function recordOutcome(database, provider, ok) {
  database
    .prepare(
      `UPDATE platform_providers SET health = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .run(ok ? 'connected' : 'test_failed', providerRowIds[provider]);
  if (ok) {
    database
      .prepare(
        `INSERT INTO service_health
          (component, last_success_at, consecutive_failures, breaker_opened_at, updated_at)
         VALUES (?, CURRENT_TIMESTAMP, 0, NULL, CURRENT_TIMESTAMP)
         ON CONFLICT(component) DO UPDATE SET
           last_success_at = CURRENT_TIMESTAMP,
           consecutive_failures = 0,
           breaker_opened_at = NULL,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(provider);
    return;
  }
  database
    .prepare(
      `INSERT INTO service_health
        (component, last_failure_at, consecutive_failures, updated_at)
       VALUES (?, CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(component) DO UPDATE SET
         last_failure_at = CURRENT_TIMESTAMP,
         consecutive_failures = consecutive_failures + 1,
         breaker_opened_at = CASE
           WHEN consecutive_failures + 1 >= 5 AND breaker_opened_at IS NULL
           THEN CURRENT_TIMESTAMP ELSE breaker_opened_at END,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .run(provider);
}

const database = new DatabaseSync(resolve(databasePath));
const results = [];
try {
  for (const provider of providers) {
    const row = database
      .prepare(
        `SELECT encrypted_secret, public_config_json
         FROM platform_provider_secrets WHERE provider = ? LIMIT 1`,
      )
      .get(provider);
    if (!row?.encrypted_secret) {
      results.push({
        provider,
        ok: false,
        detail: 'Credential not configured.',
      });
      recordOutcome(database, provider, false);
      continue;
    }

    try {
      const secret = await decryptSecret(row.encrypted_secret);
      const apiKey =
        typeof secret.apiKey === 'string' ? secret.apiKey.trim() : '';
      if (secret.disabled === true || !apiKey)
        throw new Error('Credential is disabled or missing.');
      const result = await probePlatformProvider({
        provider,
        apiKey,
        config: publicConfig(row.public_config_json),
      });
      recordOutcome(database, provider, true);
      results.push({
        provider,
        ok: true,
        status: result.status,
        detail: result.detail,
      });
    } catch (error) {
      recordOutcome(database, provider, false);
      results.push({
        provider,
        ok: false,
        detail:
          error instanceof Error
            ? error.message.slice(0, 300)
            : 'Provider verification failed.',
      });
    }
  }
  console.log(
    JSON.stringify({ ok: results.every((item) => item.ok), results }, null, 2),
  );
  if (results.some((item) => !item.ok)) process.exitCode = 1;
} finally {
  database.close();
}
