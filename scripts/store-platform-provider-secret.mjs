#!/usr/bin/env node

import { resolve } from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';

const providers = new Set(['deepgram', 'cartesia', 'elevenlabs', 'sarvam']);
const provider = String(process.argv[2] ?? '')
  .trim()
  .toLowerCase();
const databasePath = process.env.CALLVANI_SQLITE_PATH?.trim();
const encryptionKey = process.env.VAANI_ENCRYPTION_KEY?.trim();

if (
  !providers.has(provider) ||
  !databasePath ||
  !encryptionKey ||
  encryptionKey.length < 32
) {
  console.error(
    'Usage: CALLVANI_SQLITE_PATH=/absolute/app.sqlite VAANI_ENCRYPTION_KEY=... node scripts/store-platform-provider-secret.mjs <deepgram|cartesia|elevenlabs|sarvam>',
  );
  process.exit(2);
}
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error(
    'Run this command in an interactive terminal so the API key is never echoed or placed in shell history.',
  );
  process.exit(2);
}

async function hidden(prompt) {
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  let value = '';
  try {
    return await new Promise((resolveInput, reject) => {
      const onData = (chunk) => {
        for (const character of chunk) {
          if (character === '\u0003') return reject(new Error('Cancelled.'));
          if (character === '\r' || character === '\n') {
            process.stdout.write('\n');
            return resolveInput(value);
          }
          if (character === '\u007f' || character === '\b')
            value = value.slice(0, -1);
          else value += character;
        }
      };
      process.stdin.on('data', onData);
    });
  } finally {
    process.stdin.removeAllListeners('data');
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}

function toBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function fromBase64Url(value) {
  return new Uint8Array(
    Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
  );
}

async function cryptoKey(usages) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(encryptionKey),
  );
  return crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM' },
    false,
    usages,
  );
}

async function decryptSecret(encoded) {
  if (!encoded) return {};
  const [version, ivValue, encryptedValue] = String(encoded).split('.');
  if (version !== 'v1' || !ivValue || !encryptedValue)
    throw new Error(
      'The existing encrypted credential has an unsupported format; nothing was changed.',
    );
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(ivValue) },
    await cryptoKey(['decrypt']),
    fromBase64Url(encryptedValue),
  );
  const parsed = JSON.parse(new TextDecoder().decode(decrypted));
  return parsed && typeof parsed === 'object' ? parsed : {};
}

async function encryptSecret(secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await cryptoKey(['encrypt']),
    new TextEncoder().encode(secret),
  );
  return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(encrypted))}`;
}

const apiKey = (await hidden(`${provider} API key (hidden): `)).trim();
if (apiKey.length < 12 || apiKey.length > 4000)
  throw new Error('The API key length is invalid; nothing was saved.');

const database = new DatabaseSync(resolve(databasePath));
try {
  const previous = database
    .prepare(
      'SELECT encrypted_secret FROM platform_provider_secrets WHERE provider = ? LIMIT 1',
    )
    .get(provider);
  const encrypted = await encryptSecret(
    JSON.stringify({
      ...(await decryptSecret(previous?.encrypted_secret)),
      apiKey,
    }),
  );
  database
    .prepare(`INSERT INTO platform_provider_secrets
    (provider, encrypted_secret, public_config_json, updated_by, updated_at)
    VALUES (?, ?, '{}', 'production_cli', CURRENT_TIMESTAMP)
    ON CONFLICT(provider) DO UPDATE SET encrypted_secret = excluded.encrypted_secret,
      updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`)
    .run(provider, encrypted);
  const stored = database
    .prepare(`SELECT provider,
    encrypted_secret LIKE 'v1.%' AS encrypted, length(encrypted_secret) AS encrypted_length,
    updated_at FROM platform_provider_secrets WHERE provider = ?`)
    .get(provider);
  console.log(JSON.stringify(stored, null, 2));
} finally {
  database.close();
}
