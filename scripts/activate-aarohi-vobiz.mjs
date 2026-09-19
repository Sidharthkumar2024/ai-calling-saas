#!/usr/bin/env node

import { resolve } from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';

const databasePath = process.env.CALLVANI_SQLITE_PATH?.trim();
const phoneNumber = String(process.argv[2] ?? '').replace(/[\s()-]/g, '');

if (!databasePath || !/^\+[1-9]\d{7,14}$/.test(phoneNumber)) {
  console.error(
    'Usage: CALLVANI_SQLITE_PATH=/absolute/app.sqlite VAANI_ENCRYPTION_KEY=... node scripts/activate-aarohi-vobiz.mjs +919876543210',
  );
  process.exit(2);
}

const encryptionKey = process.env.VAANI_ENCRYPTION_KEY?.trim();
if (!encryptionKey || encryptionKey.length < 32) {
  console.error(
    'VAANI_ENCRYPTION_KEY must be available to verify Vobiz safely.',
  );
  process.exit(2);
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return new Uint8Array(Buffer.from(normalized, 'base64'));
}

async function decryptSecret(encoded) {
  const [version, ivValue, encryptedValue] = String(encoded ?? '').split('.');
  if (version !== 'v1' || !ivValue || !encryptedValue)
    throw new Error(
      'The stored Vobiz credential is not encrypted in the supported format.',
    );
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

function normalizePhone(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function providerOwnsNumber(payload) {
  return (
    Array.isArray(payload?.items) &&
    payload.items.some(
      (item) =>
        item &&
        typeof item === 'object' &&
        normalizePhone(item.e164) === normalizePhone(phoneNumber) &&
        typeof item.id === 'string' &&
        item.id.length > 0 &&
        item.status === 'active' &&
        item.voice_enabled === true &&
        item.is_blocked === false,
    )
  );
}

const database = new DatabaseSync(resolve(databasePath));

try {
  const agents = database
    .prepare(`SELECT id, organization_id, name, status, calling_config_json
    FROM voice_agents WHERE lower(name) LIKE '%aarohi%' ORDER BY updated_at DESC`)
    .all();
  if (agents.length !== 1)
    throw new Error(
      `Expected exactly one Aarohi agent, found ${agents.length}.`,
    );
  const agent = agents[0];

  const connection = database
    .prepare(`SELECT id, public_config_json, encrypted_secret
    FROM integration_connections
    WHERE organization_id = ? AND type = 'telephony_vobiz' LIMIT 1`)
    .get(agent.organization_id);
  if (!connection?.encrypted_secret)
    throw new Error(
      "Aarohi's customer workspace has no encrypted Vobiz credential.",
    );

  const config = JSON.parse(connection.public_config_json || '{}');
  const secret = await decryptSecret(connection.encrypted_secret);
  const authId = String(config.accountId ?? '').trim();
  const authToken = String(secret.apiKey ?? '').trim();
  const baseUrl = String(config.baseUrl || 'https://api.vobiz.ai').replace(
    /\/$/,
    '',
  );
  if (!/^[A-Za-z0-9_-]{5,100}$/.test(authId) || !authToken)
    throw new Error('The stored Vobiz Auth ID or token is incomplete.');

  const ownershipUrl = `${baseUrl}/api/v1/Account/${encodeURIComponent(authId)}/numbers?search=${encodeURIComponent(phoneNumber)}`;
  const response = await fetch(ownershipUrl, {
    headers: { 'X-Auth-ID': authId, 'X-Auth-Token': authToken },
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(
      `Vobiz ownership verification returned HTTP ${response.status}.`,
    );
  const payload = await response.json();
  if (!providerOwnsNumber(payload))
    throw new Error(
      'Vobiz did not confirm this number as active, voice-enabled and unblocked.',
    );

  const collision = database
    .prepare(`SELECT id, organization_id FROM phone_numbers
    WHERE phone_number = ? LIMIT 1`)
    .get(phoneNumber);
  if (collision && collision.organization_id !== agent.organization_id)
    throw new Error(
      'The Vobiz number is already owned by another customer workspace.',
    );

  const suffix = normalizePhone(phoneNumber).slice(-10);
  const numberId = collision?.id || `number_vobiz_${suffix}`;
  const existingRoute = database
    .prepare(`SELECT id FROM number_routes
    WHERE number_id = ? AND agent_id = ? LIMIT 1`)
    .get(numberId, agent.id);
  const routeId = existingRoute?.id || `nroute_aarohi_vobiz_${suffix}`;
  const otherRoute = database
    .prepare(`SELECT id, agent_id FROM number_routes
    WHERE number_id = ? AND status = 'active' AND coalesce(agent_id, '') != ? LIMIT 1`)
    .get(numberId, agent.id);
  if (otherRoute)
    throw new Error(
      'This number already has a different active route; no routing was changed.',
    );

  let callingConfig = {};
  try {
    callingConfig = JSON.parse(agent.calling_config_json || '{}');
  } catch {}

  database.exec('BEGIN IMMEDIATE');
  try {
    database
      .prepare(`INSERT INTO phone_numbers
      (id, organization_id, phone_number, country, number_type, acquisition_type,
       public_provider_name, provider_code, connection_mode, onboarding_status,
       assigned_agent_name, direction, kyc_status, status, monthly_rental)
      VALUES (?, ?, ?, 'IN', 'existing', 'bring_your_own', 'Vobiz', 'vobiz',
       'native_import', 'connected', ?, 'inbound_outbound', 'provider_managed', 'active', 0)
      ON CONFLICT(phone_number) DO UPDATE SET
        public_provider_name = 'Vobiz', provider_code = 'vobiz',
        connection_mode = 'native_import', onboarding_status = 'connected',
        assigned_agent_name = excluded.assigned_agent_name,
        direction = 'inbound_outbound', kyc_status = 'provider_managed', status = 'active'`)
      .run(numberId, agent.organization_id, phoneNumber, agent.name);
    database
      .prepare(`INSERT INTO number_routes
      (id, organization_id, number_id, route_type, agent_id, language, priority,
       off_hours_action, status)
      VALUES (?, ?, ?, 'reception', ?, 'hinglish', 1, 'voicemail', 'active')
      ON CONFLICT(id) DO UPDATE SET agent_id = excluded.agent_id,
        language = excluded.language, priority = excluded.priority, status = 'active'`)
      .run(routeId, agent.organization_id, numberId, agent.id);
    database
      .prepare(`UPDATE voice_agents SET status = 'active',
      calling_config_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(
        JSON.stringify({
          ...callingConfig,
          inbound: true,
          outbound: true,
          trialMode: false,
        }),
        agent.id,
      );
    database
      .prepare(`UPDATE integration_connections SET status = 'connected',
      last_checked_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(connection.id);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        ownershipVerified: true,
        agent: { id: agent.id, name: agent.name, status: 'active' },
        number: {
          id: numberId,
          masked: `${'*'.repeat(Math.max(0, phoneNumber.length - 4))}${phoneNumber.slice(-4)}`,
          status: 'active',
        },
        route: { id: routeId, status: 'active', direction: 'inbound_outbound' },
        vobizConnection: 'connected',
      },
      null,
      2,
    ),
  );
} finally {
  database.close();
}
