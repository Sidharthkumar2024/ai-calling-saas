#!/usr/bin/env node

import { resolve } from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';

const databasePath = process.env.CALLVANI_SQLITE_PATH?.trim();
const email = String(process.argv[2] ?? '').trim().toLowerCase();

if (!databasePath || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error(
    'Usage: CALLVANI_SQLITE_PATH=/absolute/app.sqlite node scripts/provision-google-customer.mjs owner@example.com',
  );
  process.exit(2);
}

async function hashPassword(password) {
  const iterations = 120_000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    256,
  );
  return `pbkdf2$${iterations}$${Buffer.from(salt).toString('base64')}$${Buffer.from(derived).toString('base64')}`;
}

const database = new DatabaseSync(resolve(databasePath));

try {
  // Keep the operator script safe to run immediately after a code pull, even
  // before the first HTTP request has exercised ensureSchema on the new build.
  database.exec(`CREATE TABLE IF NOT EXISTS oauth_identities (
    id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL, subject TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    email TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_identities_provider_subject
    ON oauth_identities (provider, subject);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_identities_provider_user
    ON oauth_identities (provider, user_id);
  CREATE TABLE IF NOT EXISTS oauth_account_links (
    id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    email TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_oauth_account_links_pending
    ON oauth_account_links (provider, user_id, email, expires_at, consumed_at);`);

  const agent = database
    .prepare(`SELECT id, organization_id, name FROM voice_agents
      WHERE lower(name) LIKE '%aarohi%' ORDER BY updated_at DESC`)
    .all();
  if (agent.length !== 1)
    throw new Error(`Expected exactly one Aarohi agent, found ${agent.length}.`);

  const organizationId = agent[0].organization_id;
  const malformed = database
    .prepare(`SELECT u.id, u.email
      FROM app_users u
      LEFT JOIN user_security_settings s ON s.user_id = u.id
      LEFT JOIN auth_sessions session ON session.user_id = u.id
      WHERE u.organization_id = ? AND u.role = 'customer_owner'
        AND lower(u.email) LIKE lower(?) AND lower(u.email) != lower(?)
        AND s.email_verified_at IS NULL AND session.id IS NULL
      GROUP BY u.id, u.email`)
    .all(organizationId, `${email}%`, email);
  for (const row of malformed) {
    if (String(row.email).toLowerCase().startsWith(email))
      database.prepare('DELETE FROM app_users WHERE id = ?').run(row.id);
  }
  const existing = database
    .prepare('SELECT id, organization_id, role, status FROM app_users WHERE lower(email) = lower(?)')
    .get(email);
  if (existing && existing.organization_id !== organizationId)
    throw new Error('This email already belongs to another workspace.');
  if (existing && existing.role !== 'customer_owner')
    throw new Error('This email already exists with a non-customer role.');

  const suffix = crypto.randomUUID();
  const userId = existing?.id || `user_${suffix}`;
  const linkId = `oauth_link_${crypto.randomUUID()}`;
  const passwordHash = existing
    ? null
    : await hashPassword(crypto.randomUUID() + crypto.randomUUID());

  database.exec('BEGIN IMMEDIATE');
  try {
    if (!existing)
      database
        .prepare(`INSERT INTO app_users
          (id, organization_id, name, email, password_hash, role, status)
          VALUES (?, ?, 'Call Vani Owner', ?, ?, 'customer_owner', 'active')`)
        .run(userId, organizationId, email, passwordHash);
    database
      .prepare(`INSERT OR IGNORE INTO organization_members
        (id, organization_id, user_id, email, role)
        VALUES (?, ?, ?, ?, 'owner')`)
      .run(`member_${suffix}`, organizationId, userId, email);
    database
      .prepare(`INSERT INTO user_security_settings
        (user_id, email_verified_at, mfa_enabled, updated_at)
        VALUES (?, NULL, 0, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO NOTHING`)
      .run(userId);
    database
      .prepare(`UPDATE oauth_account_links SET consumed_at = CURRENT_TIMESTAMP
        WHERE provider = 'google' AND user_id = ? AND consumed_at IS NULL`)
      .run(userId);
    database
      .prepare(`INSERT INTO oauth_account_links
        (id, provider, user_id, email, expires_at)
        VALUES (?, 'google', ?, ?, datetime('now', '+24 hours'))`)
      .run(linkId, userId, email);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  console.log(JSON.stringify({
    ok: true,
    email,
    organizationId,
    agent: { id: agent[0].id, name: agent[0].name },
    googleFirstLoginExpiresInHours: 24,
    passwordLogin: 'disabled-by-unknown-random-secret',
    malformedPlaceholdersRemoved: malformed.length,
  }, null, 2));
} finally {
  database.close();
}
