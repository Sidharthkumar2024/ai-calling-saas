#!/usr/bin/env node

import { readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';

const encoder = new TextEncoder();

async function hashPassword(password) {
  const iterations = 120_000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
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

const command = String(process.argv[2] ?? '').trim();
const accountArgument =
  command === '--create-admin' ? String(process.argv[3] ?? '').trim() : command;
const email = accountArgument.toLowerCase();
if (command !== '--list' && (!email || !email.includes('@'))) {
  console.error(
    'Usage:\n' +
      '  node scripts/set-local-user-password.mjs --list\n' +
      '  node scripts/set-local-user-password.mjs account@example.com\n' +
      '  node scripts/set-local-user-password.mjs --create-admin account@example.com',
  );
  process.exit(2);
}

function walk(directory, depth = 0) {
  if (depth > 7) return [];
  let entries = [];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path, depth + 1);
    return /\.(?:db|sqlite|sqlite3)$/i.test(entry.name) ? [path] : [];
  });
}

function candidateDatabases() {
  const explicit = process.env.CALLVANI_SQLITE_PATH?.trim();
  if (explicit) return [resolve(explicit)];
  return walk('/var/lib/callvani/runtime');
}

if (command === '--list') {
  let accountCount = 0;
  for (const path of candidateDatabases()) {
    let database;
    try {
      database = new DatabaseSync(path, { readOnly: true });
      const table = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_users'",
        )
        .get();
      if (!table) continue;
      const accounts = database
        .prepare('SELECT email, role, status FROM app_users ORDER BY email')
        .all();
      if (accounts.length === 0) continue;
      console.log(path);
      for (const account of accounts) {
        console.log(`  ${account.email} (${account.role}, ${account.status})`);
        accountCount += 1;
      }
    } catch {
      // Ignore unrelated or concurrently locked runtime databases.
    } finally {
      database?.close();
    }
  }
  if (accountCount === 0) {
    console.error('No application accounts were found.');
    process.exitCode = 1;
  }
  process.exit();
}

function applicationDatabases() {
  const matches = [];
  for (const path of candidateDatabases()) {
    let database;
    try {
      database = new DatabaseSync(path, { readOnly: true });
      const table = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_users'",
        )
        .get();
      if (table) matches.push(path);
    } catch {
      // Wrangler keeps unrelated SQLite files in the same persistence tree.
    } finally {
      database?.close();
    }
  }
  if (matches.length !== 1) {
    const detail =
      matches.length === 0
        ? 'No application database was found.'
        : `More than one application database was found: ${matches.join(', ')}`;
    throw new Error(
      `${detail} Set CALLVANI_SQLITE_PATH to the exact application database and retry.`,
    );
  }
  return matches[0];
}

function matchingDatabase() {
  const matches = [];
  for (const path of candidateDatabases()) {
    let database;
    try {
      database = new DatabaseSync(path);
      const table = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_users'",
        )
        .get();
      if (!table) continue;
      const account = database
        .prepare(
          'SELECT id, email, role, status FROM app_users WHERE lower(email) = ? LIMIT 1',
        )
        .get(email);
      if (account) matches.push({ path, account });
    } catch {
      // Wrangler keeps unrelated SQLite files in the same persistence tree.
    } finally {
      database?.close();
    }
  }
  if (matches.length !== 1) {
    const detail =
      matches.length === 0
        ? 'No matching account was found.'
        : `More than one matching database was found: ${matches.map((match) => match.path).join(', ')}`;
    throw new Error(`${detail} Set CALLVANI_SQLITE_PATH to the exact application database and retry.`);
  }
  return matches[0];
}

async function hidden(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error('Run this command in an interactive terminal.');
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  let value = '';
  try {
    return await new Promise((resolveInput, reject) => {
      const onData = (chunk) => {
        for (const character of chunk) {
          if (character === '\u0003') {
            process.stdout.write('\n');
            reject(new Error('Cancelled.'));
            return;
          }
          if (character === '\r' || character === '\n') {
            process.stdout.write('\n');
            resolveInput(value);
            return;
          }
          if (character === '\u007f' || character === '\b') {
            value = value.slice(0, -1);
            continue;
          }
          value += character;
        }
      };
      process.stdin.once('error', reject);
      process.stdin.on('data', onData);
    });
  } finally {
    process.stdin.removeAllListeners('data');
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}

try {
  if (command === '--create-admin') {
    const path = applicationDatabases();
    const database = new DatabaseSync(path);
    let existing;
    try {
      existing = database
        .prepare(
          'SELECT id, email, role, status FROM app_users WHERE lower(email) = ? LIMIT 1',
        )
        .get(email);
    } finally {
      database.close();
    }
    if (existing && existing.role !== 'platform_admin') {
      throw new Error(
        'That email belongs to a customer account. Use a different email for the admin portal.',
      );
    }

    console.log(
      existing
        ? `Admin account: ${existing.email} (${existing.status})`
        : `Creating platform admin: ${email}`,
    );
    const password = await hidden('New password (hidden): ');
    if (password.length < 12)
      throw new Error('Use at least 12 characters. The account was not changed.');
    if (!/[a-zA-Z]/.test(password) || !/\d/.test(password))
      throw new Error(
        'Use at least one letter and one number. The account was not changed.',
      );
    const confirmation = await hidden('Confirm password (hidden): ');
    if (password !== confirmation)
      throw new Error('Passwords did not match. The account was not changed.');

    const writable = new DatabaseSync(path);
    try {
      writable.exec('BEGIN IMMEDIATE');
      const encoded = await hashPassword(password);
      if (existing) {
        writable
          .prepare(
            "UPDATE app_users SET password_hash = ?, status = 'active', admin_role = 'super_admin' WHERE id = ? AND role = 'platform_admin'",
          )
          .run(encoded, existing.id);
      } else {
        const userId = `user_${crypto.randomUUID()}`;
        writable
          .prepare(`INSERT INTO app_users
            (id, organization_id, name, email, password_hash, role, status, admin_role)
            VALUES (?, NULL, 'Sidharth Kumar', ?, ?, 'platform_admin', 'active', 'super_admin')`)
          .run(userId, email, encoded);
        const securityTable = writable
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_security_settings'",
          )
          .get();
        if (securityTable) {
          writable
            .prepare(`INSERT INTO user_security_settings
              (user_id, email_verified_at, mfa_enabled, updated_at)
              VALUES (?, CURRENT_TIMESTAMP, 0, CURRENT_TIMESTAMP)
              ON CONFLICT(user_id) DO UPDATE SET
                email_verified_at = COALESCE(user_security_settings.email_verified_at, CURRENT_TIMESTAMP),
                updated_at = CURRENT_TIMESTAMP`)
            .run(userId);
        }
      }
      writable.exec('COMMIT');
    } catch (error) {
      try {
        writable.exec('ROLLBACK');
      } catch {
        // The failure may have happened before the transaction began.
      }
      throw error;
    } finally {
      writable.close();
    }
    console.log(
      `${existing ? 'Password updated' : 'Platform admin created'} for ${email}.`,
    );
    process.exit();
  }

  const match = matchingDatabase();
  console.log(`Account: ${match.account.email} (${match.account.role}, ${match.account.status})`);
  const password = await hidden('New password (hidden): ');
  if (password.length < 12)
    throw new Error('Use at least 12 characters. The password was not changed.');
  const confirmation = await hidden('Confirm password (hidden): ');
  if (password !== confirmation)
    throw new Error('Passwords did not match. The password was not changed.');

  const database = new DatabaseSync(match.path);
  try {
    const result = database
      .prepare('UPDATE app_users SET password_hash = ? WHERE id = ?')
      .run(await hashPassword(password), match.account.id);
    if (Number(result.changes) !== 1)
      throw new Error('The account changed while the password was being updated.');
  } finally {
    database.close();
  }
  console.log(`Password updated for ${match.account.email}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
