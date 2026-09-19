#!/usr/bin/env node

import { readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from '../lib/security.ts';

const email = String(process.argv[2] ?? '').trim().toLowerCase();
if (!email || !email.includes('@')) {
  console.error(
    'Usage: node --experimental-strip-types scripts/set-local-user-password.mjs account@example.com',
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
    const detail = matches.length === 0 ? 'No matching account was found.' : 'More than one matching database was found.';
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
