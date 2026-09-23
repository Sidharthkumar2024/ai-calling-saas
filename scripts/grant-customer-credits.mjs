#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';

function usage() {
  return [
    'Usage:',
    '  CALLVANI_SQLITE_PATH=/absolute/app.sqlite node scripts/grant-customer-credits.mjs \\',
    '    --email customer@example.com --organization org_123 \\',
    '    --minimum-balance 1000 --reference launch-credit-2026-09-23 [--apply]',
    '',
    'Use --credits N instead of --minimum-balance N for an additive grant.',
    'Without --apply the command is read-only and prints the planned mutation.',
  ].join('\n');
}

function parseArgs(argv) {
  const values = new Map();
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') {
      apply = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (!argument.startsWith('--'))
      throw new Error(`Unexpected argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--'))
      throw new Error(`Missing value for ${argument}.`);
    if (values.has(argument))
      throw new Error(`Duplicate argument: ${argument}.`);
    values.set(argument, value);
    index += 1;
  }
  return { values, apply };
}

function positiveInteger(value, label) {
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 10_000_000)
    throw new Error(`${label} must be an integer between 1 and 10000000.`);
  return parsed;
}

function stableId(prefix, organizationId, reference) {
  return `${prefix}_${createHash('sha256')
    .update(`${organizationId}:${reference}`)
    .digest('hex')
    .slice(0, 40)}`;
}

const { values, apply } = parseArgs(process.argv.slice(2));
const databaseArgument = process.env.CALLVANI_SQLITE_PATH?.trim();
const email = String(values.get('--email') ?? '')
  .trim()
  .toLowerCase();
const expectedOrganizationId = String(
  values.get('--organization') ?? '',
).trim();
const reference = String(values.get('--reference') ?? '').trim();
const description = String(
  values.get('--description') ?? 'Admin launch credit grant',
).trim();
const credits = positiveInteger(values.get('--credits'), '--credits');
const minimumBalance = positiveInteger(
  values.get('--minimum-balance'),
  '--minimum-balance',
);

if (!databaseArgument || !isAbsolute(databaseArgument))
  throw new Error(
    'CALLVANI_SQLITE_PATH must be the absolute path of the active application database.',
  );
if (!email || !email.includes('@'))
  throw new Error('A valid --email is required.');
if (!/^org_[A-Za-z0-9_-]{3,100}$/.test(expectedOrganizationId))
  throw new Error('A valid --organization is required.');
if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/.test(reference))
  throw new Error(
    '--reference must be a stable 3-120 character idempotency key.',
  );
if (!description || description.length > 240)
  throw new Error('--description must contain 1-240 characters.');
if ((credits === null) === (minimumBalance === null))
  throw new Error('Choose exactly one of --credits or --minimum-balance.');

const mode = credits === null ? 'minimum_balance' : 'additive';
const requestedValue = credits ?? minimumBalance;
// A plan is a real read-only operation: opening the database read-only prevents
// accidental journal/WAL creation and makes any future write before --apply
// fail closed at SQLite itself.
const database = new DatabaseSync(resolve(databaseArgument), {
  readOnly: !apply,
});
database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 15000;');

try {
  if (apply) database.exec('BEGIN IMMEDIATE');
  try {
    const schema = database
      .prepare(
        `SELECT count(*) AS found FROM sqlite_master
         WHERE type = 'table'
           AND name IN ('app_users', 'organizations', 'organization_wallets',
                        'credit_ledger', 'audit_events')`,
      )
      .get();
    if (Number(schema?.found) !== 5)
      throw new Error(
        'The selected database is not a complete Call Vani application database.',
      );

    const account = database
      .prepare(
        `SELECT u.id AS user_id, u.email, u.role, u.status AS user_status,
                u.organization_id, o.name AS organization_name,
                o.status AS organization_status
         FROM app_users u
         INNER JOIN organizations o ON o.id = u.organization_id
         WHERE lower(u.email) = ? LIMIT 1`,
      )
      .get(email);
    if (!account) throw new Error('No customer account matches that email.');
    if (account.organization_id !== expectedOrganizationId)
      throw new Error(
        `Account belongs to ${String(account.organization_id)}, not ${expectedOrganizationId}; nothing was changed.`,
      );
    if (account.role === 'platform_admin' || !account.organization_id)
      throw new Error(
        'Platform-admin accounts cannot receive customer credits.',
      );
    if (account.user_status !== 'active')
      throw new Error(
        `Customer account is ${String(account.user_status)}, not active.`,
      );
    if (account.organization_status !== 'active')
      throw new Error(
        `Customer organization is ${String(account.organization_status)}, not active.`,
      );

    let wallet = database
      .prepare(
        `SELECT balance FROM organization_wallets
         WHERE organization_id = ? LIMIT 1`,
      )
      .get(account.organization_id);
    if (!wallet && apply) {
      database
        .prepare(
          `INSERT INTO organization_wallets
           (organization_id, balance, low_balance_threshold)
           VALUES (?, 0, 500)`,
        )
        .run(account.organization_id);
      wallet = { balance: 0 };
    }
    const balanceBefore = Number(wallet?.balance ?? 0);
    const grantAmount =
      mode === 'additive'
        ? requestedValue
        : Math.max(0, requestedValue - balanceBefore);
    const ledgerId = stableId(
      'admin_grant',
      account.organization_id,
      reference,
    );
    const auditId = stableId(
      'audit_admin_grant',
      account.organization_id,
      reference,
    );
    const existing = database
      .prepare(
        `SELECT l.id, l.type, l.amount, l.balance_after, l.reference_type,
                l.reference_id, a.id AS audit_id, a.action AS audit_action,
                a.metadata_json
         FROM credit_ledger l
         LEFT JOIN audit_events a ON a.id = ?
         WHERE l.id = ? AND l.organization_id = ? LIMIT 1`,
      )
      .get(auditId, ledgerId, account.organization_id);

    if (existing) {
      let metadata = {};
      try {
        metadata = JSON.parse(existing.metadata_json || '{}');
      } catch {
        throw new Error(
          'The existing grant has malformed audit metadata; manual review is required.',
        );
      }
      const recordedOutcome =
        typeof metadata.outcome === 'string'
          ? metadata.outcome
          : Number(existing.amount) > 0 &&
              existing.audit_action === 'wallet.credit_granted'
            ? 'granted'
            : '';
      const expectedAuditAction =
        recordedOutcome === 'already_satisfied'
          ? 'wallet.credit_grant_satisfied'
          : 'wallet.credit_granted';
      if (
        !existing.audit_id ||
        existing.type !== 'admin_grant' ||
        existing.reference_type !== 'admin_credit_grant' ||
        existing.reference_id !== reference ||
        !['granted', 'already_satisfied'].includes(recordedOutcome) ||
        existing.audit_action !== expectedAuditAction ||
        metadata.reference !== reference ||
        metadata.grantMode !== mode ||
        Number(metadata.requestedValue) !== requestedValue
      )
        throw new Error(
          'That reference belongs to a different or incomplete grant; nothing was changed.',
        );
      if (apply) database.exec('COMMIT');
      console.log(
        JSON.stringify(
          {
            ok: true,
            applied: false,
            alreadyApplied: true,
            alreadySatisfied: recordedOutcome === 'already_satisfied',
            email: account.email,
            organizationId: account.organization_id,
            reference,
            creditsGranted: Number(existing.amount),
            balance: balanceBefore,
            recordedBalance: Number(existing.balance_after),
            ledgerId,
            auditId,
          },
          null,
          2,
        ),
      );
    } else if (grantAmount === 0) {
      const metadata = JSON.stringify({
        source: 'production_cli',
        email: account.email,
        reference,
        grantMode: mode,
        requestedValue,
        creditsGranted: 0,
        balanceBefore,
        balanceAfter: balanceBefore,
        outcome: 'already_satisfied',
        alreadySatisfied: true,
      });
      if (!apply) {
        console.log(
          JSON.stringify(
            {
              ok: true,
              dryRun: true,
              applied: false,
              alreadySatisfied: true,
              idempotencyRecorded: false,
              email: account.email,
              organizationId: account.organization_id,
              reference,
              balance: balanceBefore,
              minimumBalance: requestedValue,
              ledgerId,
              auditId,
            },
            null,
            2,
          ),
        );
      } else {
        database
          .prepare(
            `INSERT INTO credit_ledger
             (id, organization_id, type, amount, balance_after, reference_type,
              reference_id, description)
             VALUES (?, ?, 'admin_grant', 0, ?, 'admin_credit_grant', ?, ?)`,
          )
          .run(
            ledgerId,
            account.organization_id,
            balanceBefore,
            reference,
            description,
          );
        database
          .prepare(
            `INSERT INTO audit_events
             (id, organization_id, actor_user_id, action, target_type, target_id,
              metadata_json)
             VALUES (?, ?, NULL, 'wallet.credit_grant_satisfied',
                     'organization_wallet', ?, ?)`,
          )
          .run(
            auditId,
            account.organization_id,
            account.organization_id,
            metadata,
          );
        database.exec('COMMIT');
        console.log(
          JSON.stringify(
            {
              ok: true,
              applied: false,
              alreadySatisfied: true,
              idempotencyRecorded: true,
              email: account.email,
              organizationId: account.organization_id,
              reference,
              creditsGranted: 0,
              balance: balanceBefore,
              minimumBalance: requestedValue,
              ledgerId,
              auditId,
            },
            null,
            2,
          ),
        );
      }
    } else {
      const balanceAfter = balanceBefore + grantAmount;
      const metadata = JSON.stringify({
        source: 'production_cli',
        email: account.email,
        reference,
        grantMode: mode,
        requestedValue,
        creditsGranted: grantAmount,
        balanceBefore,
        balanceAfter,
        outcome: 'granted',
      });

      if (!apply) {
        console.log(
          JSON.stringify(
            {
              ok: true,
              dryRun: true,
              email: account.email,
              organizationId: account.organization_id,
              organizationName: account.organization_name,
              reference,
              grantMode: mode,
              requestedValue,
              creditsToGrant: grantAmount,
              balanceBefore,
              balanceAfter,
              ledgerId,
              auditId,
            },
            null,
            2,
          ),
        );
      } else {
        database
          .prepare(
            `UPDATE organization_wallets
             SET balance = ?, updated_at = CURRENT_TIMESTAMP
             WHERE organization_id = ?`,
          )
          .run(balanceAfter, account.organization_id);
        database
          .prepare(
            `INSERT INTO credit_ledger
             (id, organization_id, type, amount, balance_after, reference_type,
              reference_id, description)
             VALUES (?, ?, 'admin_grant', ?, ?, 'admin_credit_grant', ?, ?)`,
          )
          .run(
            ledgerId,
            account.organization_id,
            grantAmount,
            balanceAfter,
            reference,
            description,
          );
        database
          .prepare(
            `INSERT INTO audit_events
             (id, organization_id, actor_user_id, action, target_type, target_id,
              metadata_json)
             VALUES (?, ?, NULL, 'wallet.credit_granted', 'organization_wallet', ?, ?)`,
          )
          .run(
            auditId,
            account.organization_id,
            account.organization_id,
            metadata,
          );
        database.exec('COMMIT');

        console.log(
          JSON.stringify(
            {
              ok: true,
              applied: true,
              email: account.email,
              organizationId: account.organization_id,
              reference,
              creditsGranted: grantAmount,
              balanceBefore,
              balanceAfter,
              ledgerId,
              auditId,
            },
            null,
            2,
          ),
        );
      }
    }
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK');
    throw error;
  }
} finally {
  database.close();
}
