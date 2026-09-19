#!/usr/bin/env node

import { resolve } from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';

const path = process.env.CALLVANI_SQLITE_PATH?.trim();
if (!path) {
  console.error('Set CALLVANI_SQLITE_PATH to the production application database.');
  process.exit(2);
}

const database = new DatabaseSync(resolve(path), { readOnly: true });

function all(sql, ...values) {
  return database.prepare(sql).all(...values).map((row) => ({ ...row }));
}

function maskPhone(value) {
  const text = String(value ?? '');
  return text.length > 4 ? `${'*'.repeat(Math.min(8, text.length - 4))}${text.slice(-4)}` : text;
}

try {
  const providers = all(`SELECT provider,
      encrypted_secret IS NOT NULL AND length(encrypted_secret) > 0 AS configured,
      updated_at
    FROM platform_provider_secrets
    WHERE provider IN ('deepgram', 'cartesia', 'elevenlabs', 'sarvam')
    ORDER BY provider`).map((row) => ({
      provider: row.provider,
      configured: Boolean(row.configured),
      updatedAt: row.updated_at,
    }));

  const agents = all(`SELECT id, organization_id, name, status,
      primary_language, voice_name
    FROM voice_agents
    WHERE lower(name) LIKE '%aarohi%'
    ORDER BY updated_at DESC`);

  const routes = all(`SELECT r.id, r.status, r.route_type, r.language,
      n.phone_number, n.status AS number_status,
      n.public_provider_name, a.id AS agent_id, a.name AS agent_name,
      a.status AS agent_status
    FROM number_routes r
    INNER JOIN phone_numbers n ON n.id = r.number_id
    LEFT JOIN voice_agents a ON a.id = r.agent_id
    WHERE lower(coalesce(a.name, '')) LIKE '%aarohi%'
       OR lower(n.public_provider_name) = 'vobiz'
    ORDER BY r.priority, r.created_at`).map((row) => ({
      ...row,
      phone_number: maskPhone(row.phone_number),
    }));

  const vobizConnections = all(`SELECT id, organization_id, status,
      encrypted_secret IS NOT NULL AND length(encrypted_secret) > 0 AS configured,
      last_checked_at
    FROM integration_connections
    WHERE type = 'telephony_vobiz'
    ORDER BY created_at DESC`).map((row) => ({
      ...row,
      configured: Boolean(row.configured),
    }));

  const recentCalls = all(`SELECT id, direction, status, outcome,
      duration_seconds, disconnect_reason, started_at
    FROM call_records
    WHERE agent_id IN (
      SELECT id FROM voice_agents WHERE lower(name) LIKE '%aarohi%'
    )
    ORDER BY started_at DESC
    LIMIT 5`);

  console.log(
    JSON.stringify(
      { providers, agents, routes, vobizConnections, recentCalls },
      null,
      2,
    ),
  );
} finally {
  database.close();
}
