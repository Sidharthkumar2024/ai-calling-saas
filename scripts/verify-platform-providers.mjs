#!/usr/bin/env node

import { resolve } from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';

import {
  PROBEABLE_PLATFORM_PROVIDERS,
  probePlatformProvider,
} from '../lib/platform-provider-probe.ts';

const argumentsList = process.argv.slice(2);
const productionMode = argumentsList.includes('--production');
const requestedProviders = argumentsList.filter(
  (argument) => argument !== '--production',
);
const providers =
  requestedProviders.length > 0
    ? requestedProviders
    : [...PROBEABLE_PLATFORM_PROVIDERS];
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
  providers.some((provider) => !PROBEABLE_PLATFORM_PROVIDERS.has(provider))
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
