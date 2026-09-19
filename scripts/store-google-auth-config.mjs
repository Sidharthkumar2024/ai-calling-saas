#!/usr/bin/env node

import { resolve } from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, rmSync, statSync } from 'node:fs';

const databasePath = process.env.CALLVANI_SQLITE_PATH?.trim();
const encryptionKey = process.env.VAANI_ENCRYPTION_KEY?.trim();
const clientId = String(process.argv[2] ?? '').trim();
const redirectUri = String(process.argv[3] ?? '').trim();

if (
  !databasePath ||
  !encryptionKey ||
  encryptionKey.length < 32 ||
  !/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId) ||
  redirectUri !== 'https://callvani.com/api/auth/google/callback'
) {
  console.error(
    'Usage: CALLVANI_SQLITE_PATH=/absolute/app.sqlite VAANI_ENCRYPTION_KEY=... node scripts/store-google-auth-config.mjs CLIENT_ID https://callvani.com/api/auth/google/callback',
  );
  process.exit(2);
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return new Uint8Array(Buffer.from(normalized, 'base64'));
}

function toBase64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function encryptSecret(secret) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(encryptionKey),
  );
  const key = await crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(secret),
  );
  return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(encrypted))}`;
}

async function readHidden(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error('Run this command in an interactive operator terminal.');
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  let value = '';
  try {
    for await (const chunk of process.stdin) {
      for (const character of chunk) {
        if (character === '\r' || character === '\n') {
          process.stdout.write('\n');
          return value;
        }
        if (character === '\u0003') throw new Error('Cancelled.');
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= ' ') value += character;
      }
    }
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
  return value;
}

function readSecretFile(path) {
  const resolvedPath = resolve(path);
  const mode = statSync(resolvedPath).mode & 0o777;
  if ((mode & 0o077) !== 0)
    throw new Error('Google client secret file must be readable only by its owner (chmod 600).');
  try {
    return readFileSync(resolvedPath, 'utf8').trim();
  } finally {
    rmSync(resolvedPath, { force: true });
  }
}

const secretFile = process.env.CALLVANI_GOOGLE_CLIENT_SECRET_FILE?.trim();
const clientSecret = (
  secretFile
    ? readSecretFile(secretFile)
    : await readHidden('Google client secret (hidden): ')
).trim();
if (!/^GOCSPX-[A-Za-z0-9_-]{20,}$/.test(clientSecret))
  throw new Error('Google client secret format is invalid.');

const database = new DatabaseSync(resolve(databasePath));
try {
  const encryptedSecret = await encryptSecret(clientSecret);
  database
    .prepare(`INSERT INTO auth_provider_settings
      (provider, display_name, button_visible, enabled, status,
       public_config_json, encrypted_secret, updated_at)
      VALUES ('google', 'Google', 1, 1, 'active', ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(provider) DO UPDATE SET
        display_name = 'Google', button_visible = 1, enabled = 1,
        status = 'active', public_config_json = excluded.public_config_json,
        encrypted_secret = excluded.encrypted_secret,
        updated_at = CURRENT_TIMESTAMP`)
    .run(JSON.stringify({ clientId, redirectUri }), encryptedSecret);
  console.log(JSON.stringify({
    ok: true,
    provider: 'google',
    enabled: true,
    configured: true,
    redirectUri,
  }, null, 2));
} finally {
  database.close();
}
