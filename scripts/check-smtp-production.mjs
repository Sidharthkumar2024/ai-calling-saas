#!/usr/bin/env node

import process from 'node:process';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import nodemailer from 'nodemailer';

const databasePath =
  process.env.CALLVANI_SQLITE_PATH?.trim() ||
  '/var/lib/callvani/runtime/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite';
const encryptionKey = process.env.VAANI_ENCRYPTION_KEY?.trim();

if (!encryptionKey || encryptionKey.length < 32) {
  console.error('VAANI_ENCRYPTION_KEY is missing or invalid.');
  process.exit(2);
}

function fromBase64Url(value) {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

async function decryptSecret(value) {
  const [version, ivValue, encryptedValue] = String(value || '').split('.');
  if (version !== 'v1' || !ivValue || !encryptedValue)
    throw new Error('Stored SMTP secret is not encrypted with the supported format.');
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
  return JSON.parse(new TextDecoder().decode(decrypted));
}

const database = new DatabaseSync(resolve(databasePath), { readOnly: true });
try {
  const row = database
    .prepare(
      `SELECT encrypted_secret, public_config_json
       FROM platform_provider_secrets WHERE provider = 'smtp' LIMIT 1`,
    )
    .get();
  if (!row?.encrypted_secret)
    throw new Error('SMTP is not configured in the encrypted provider vault.');
  const config = JSON.parse(row.public_config_json || '{}');
  const secrets = await decryptSecret(row.encrypted_secret);
  const transport = nodemailer.createTransport({
    host: String(config.host || ''),
    port: Math.max(1, Number(config.port) || 465),
    secure: String(config.secure ?? 'true') !== 'false',
    auth: {
      user: String(config.username || ''),
      pass: String(secrets.password || ''),
    },
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 20_000,
  });
  await transport.verify();
  transport.close();
  console.log(
    JSON.stringify({
      ok: true,
      provider: 'smtp',
      host: String(config.host || ''),
      port: Math.max(1, Number(config.port) || 465),
      username: String(config.username || '').replace(/^(.{2}).+(@.+)$/, '$1***$2'),
    }),
  );
} catch (error) {
  const smtpError = error || {};
  console.error(
    JSON.stringify({
      ok: false,
      name: typeof smtpError.name === 'string' ? smtpError.name : 'Error',
      code: typeof smtpError.code === 'string' ? smtpError.code : 'unknown',
      command:
        typeof smtpError.command === 'string' ? smtpError.command : 'unknown',
      message:
        typeof smtpError.message === 'string'
          ? smtpError.message.replace(/[\w.+-]+@[\w.-]+/g, '[redacted-email]')
          : 'SMTP verification failed.',
    }),
  );
  process.exitCode = 1;
} finally {
  database.close();
}
