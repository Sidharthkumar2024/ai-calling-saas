#!/usr/bin/env node

import { resolve } from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';

const databasePath = process.env.CALLVANI_SQLITE_PATH?.trim();
const destination = String(process.argv[2] ?? '').replace(/[\s()-]/g, '');
const publicBaseUrl = String(process.env.PUBLIC_BASE_URL ?? '').replace(
  /\/$/,
  '',
);
const voiceStreamUrl = String(process.env.VOICE_STREAM_URL ?? '');
const encryptionKey = process.env.VAANI_ENCRYPTION_KEY?.trim();

if (process.env.CALLVANI_OPERATOR_TEST !== 'YES') {
  console.error(
    'Set CALLVANI_OPERATOR_TEST=YES only for an explicitly authorised operator test call.',
  );
  process.exit(2);
}
if (
  !databasePath ||
  !/^\+[1-9]\d{7,14}$/.test(destination) ||
  !publicBaseUrl.startsWith('https://') ||
  !voiceStreamUrl.startsWith('wss://') ||
  !encryptionKey ||
  encryptionKey.length < 32
) {
  console.error(
    'Production DB, E.164 destination, PUBLIC_BASE_URL, VOICE_STREAM_URL and VAANI_ENCRYPTION_KEY are required.',
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
  return JSON.parse(new TextDecoder().decode(decrypted));
}

const database = new DatabaseSync(resolve(databasePath));
let callId = null;
try {
  const route = database
    .prepare(`SELECT a.id AS agent_id, a.organization_id, a.name,
      n.phone_number, c.public_config_json, c.encrypted_secret
    FROM voice_agents a
    INNER JOIN number_routes r ON r.agent_id = a.id AND r.status = 'active'
    INNER JOIN phone_numbers n ON n.id = r.number_id AND n.status = 'active'
      AND n.provider_code = 'vobiz' AND n.direction != 'inbound'
    INNER JOIN integration_connections c ON c.organization_id = a.organization_id
      AND c.type = 'telephony_vobiz' AND c.status = 'connected'
    WHERE lower(a.name) LIKE '%aarohi%' AND a.status = 'active'
    ORDER BY r.priority LIMIT 1`)
    .get();
  if (!route)
    throw new Error('Aarohi does not have a verified active Vobiz route.');

  const providers = database
    .prepare(`SELECT provider FROM platform_provider_secrets
    WHERE encrypted_secret IS NOT NULL AND length(encrypted_secret) > 0
      AND provider IN ('deepgram','cartesia','elevenlabs','sarvam')`)
    .all()
    .map((row) => row.provider);
  if (
    !providers.some((provider) =>
      ['deepgram', 'elevenlabs', 'sarvam'].includes(provider),
    )
  )
    throw new Error('No production STT provider is configured.');
  if (
    !providers.some((provider) =>
      ['cartesia', 'elevenlabs', 'sarvam'].includes(provider),
    )
  )
    throw new Error('No production TTS provider is configured.');

  const config = JSON.parse(route.public_config_json || '{}');
  const secret = await decryptSecret(route.encrypted_secret);
  const authId = String(config.accountId ?? '').trim();
  const authToken = String(secret.apiKey ?? '').trim();
  const baseUrl = String(config.baseUrl || 'https://api.vobiz.ai').replace(
    /\/$/,
    '',
  );
  if (!authId || !authToken)
    throw new Error('Vobiz credentials are incomplete.');

  callId = `call_${crypto.randomUUID()}`;
  database
    .prepare(`INSERT INTO call_records
    (id, organization_id, agent_id, direction, channel, from_number, to_number,
     status, outcome, recording_status, started_at, analysis_json)
    VALUES (?, ?, ?, 'outbound', 'phone', ?, ?, 'queued', 'unknown', 'pending', CURRENT_TIMESTAMP, ?)`)
    .run(
      callId,
      route.organization_id,
      route.agent_id,
      route.phone_number,
      destination,
      JSON.stringify({
        operatorTest: true,
        consentSource: 'explicit_user_request',
        provider: 'vobiz',
      }),
    );

  const callbackBase = `${publicBaseUrl}/api/webhooks/telephony/vobiz`;
  const response = await fetch(
    `${baseUrl}/api/v1/Account/${encodeURIComponent(authId)}/Call/`,
    {
      method: 'POST',
      headers: {
        'X-Auth-ID': authId,
        'X-Auth-Token': authToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: String(route.phone_number).replace(/\D/g, ''),
        to: destination.replace(/\D/g, ''),
        answer_url: `${callbackBase}/answer/${encodeURIComponent(callId)}`,
        answer_method: 'POST',
        ring_url: `${callbackBase}/status/${encodeURIComponent(callId)}`,
        ring_method: 'POST',
        hangup_url: `${callbackBase}/status/${encodeURIComponent(callId)}`,
        hangup_method: 'POST',
        machine_detection: 'hangup',
        time_limit: 300,
      }),
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    },
  );
  const payload = await response.json().catch(() => null);
  const reference =
    payload &&
    typeof payload === 'object' &&
    typeof payload.request_uuid === 'string'
      ? payload.request_uuid
      : '';
  if (!response.ok || !reference)
    throw new Error(
      `Vobiz refused the operator test call (HTTP ${response.status}).`,
    );
  database
    .prepare(`UPDATE call_records SET status = 'queued', provider_reference = ?,
    analysis_json = json_set(analysis_json, '$.providerReference', ?) WHERE id = ?`)
    .run(reference, reference, callId);
  console.log(
    JSON.stringify(
      {
        ok: true,
        callId,
        provider: 'vobiz',
        providerReference: reference,
        status: 'queued',
        destination: `${'*'.repeat(Math.max(0, destination.length - 4))}${destination.slice(-4)}`,
        note: 'Queued is provider acceptance only; callbacks prove ringing, answer and completion.',
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (callId)
    database
      .prepare(`UPDATE call_records SET status = 'failed',
    disconnect_reason = ?, ended_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(
        error instanceof Error
          ? error.message.slice(0, 300)
          : 'Operator test failed',
        callId,
      );
  throw error;
} finally {
  database.close();
}
