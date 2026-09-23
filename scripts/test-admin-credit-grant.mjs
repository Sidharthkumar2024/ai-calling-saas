import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const directory = mkdtempSync(join(tmpdir(), 'callvani-credit-grant-'));
const databasePath = join(directory, 'app.sqlite');
const database = new DatabaseSync(databasePath);

database.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL
  );
  CREATE TABLE app_users (
    id TEXT PRIMARY KEY,
    organization_id TEXT,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL,
    status TEXT NOT NULL,
    FOREIGN KEY (organization_id) REFERENCES organizations(id)
  );
  CREATE TABLE organization_wallets (
    organization_id TEXT PRIMARY KEY,
    balance INTEGER NOT NULL,
    low_balance_threshold INTEGER NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id)
  );
  CREATE TABLE credit_ledger (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reference_type TEXT,
    reference_id TEXT,
    description TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id)
  );
  CREATE TABLE audit_events (
    id TEXT PRIMARY KEY,
    organization_id TEXT,
    actor_user_id TEXT,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    metadata_json TEXT DEFAULT '{}' NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id)
  );
  INSERT INTO organizations VALUES ('org_test', 'Test customer', 'active');
  INSERT INTO organizations VALUES ('org_other', 'Other customer', 'active');
  INSERT INTO app_users VALUES (
    'user_test', 'org_test', 'callvani2028@gmail.com', 'customer_owner', 'active'
  );
  INSERT INTO app_users VALUES (
    'user_other', 'org_other', 'other@example.com', 'customer_owner', 'active'
  );
  INSERT INTO organization_wallets (
    organization_id, balance, low_balance_threshold
  ) VALUES ('org_test', 125, 500);
`);
database.close();
const originalFiles = readdirSync(directory);
const originalMtime = statSync(databasePath).mtimeMs;
chmodSync(databasePath, 0o444);
chmodSync(directory, 0o555);

const baseArgs = [
  'scripts/grant-customer-credits.mjs',
  '--email',
  'callvani2028@gmail.com',
  '--organization',
  'org_test',
  '--minimum-balance',
  '1000',
  '--reference',
  'launch-credit-2026-09-23',
];

function run(args) {
  return spawnSync(process.execPath, args, {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, CALLVANI_SQLITE_PATH: databasePath },
    encoding: 'utf8',
  });
}

try {
  const dryRun = run(baseArgs);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  const planned = JSON.parse(dryRun.stdout);
  assert.equal(planned.dryRun, true);
  assert.equal(planned.creditsToGrant, 875);
  const noWalletDryRun = run([
    'scripts/grant-customer-credits.mjs',
    '--email',
    'other@example.com',
    '--organization',
    'org_other',
    '--minimum-balance',
    '100',
    '--reference',
    'read-only-no-wallet-plan',
  ]);
  assert.equal(noWalletDryRun.status, 0, noWalletDryRun.stderr);
  const noWalletPlan = JSON.parse(noWalletDryRun.stdout);
  assert.equal(noWalletPlan.dryRun, true);
  assert.equal(noWalletPlan.balanceBefore, 0);
  assert.equal(noWalletPlan.creditsToGrant, 100);
  assert.deepEqual(readdirSync(directory), originalFiles);
  assert.equal(statSync(databasePath).mtimeMs, originalMtime);
  let inspection = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(
    inspection
      .prepare(
        "SELECT balance FROM organization_wallets WHERE organization_id = 'org_test'",
      )
      .get().balance,
    125,
  );
  assert.equal(
    inspection.prepare('SELECT count(*) AS n FROM credit_ledger').get().n,
    0,
  );
  assert.equal(
    inspection
      .prepare(
        "SELECT count(*) AS n FROM organization_wallets WHERE organization_id = 'org_other'",
      )
      .get().n,
    0,
  );
  inspection.close();
  chmodSync(directory, 0o700);
  chmodSync(databasePath, 0o600);

  const appliedRun = run([...baseArgs, '--apply']);
  assert.equal(appliedRun.status, 0, appliedRun.stderr);
  const applied = JSON.parse(appliedRun.stdout);
  assert.equal(applied.applied, true);
  assert.equal(applied.creditsGranted, 875);
  assert.equal(applied.balanceAfter, 1000);

  const retryRun = run([...baseArgs, '--apply']);
  assert.equal(retryRun.status, 0, retryRun.stderr);
  const retry = JSON.parse(retryRun.stdout);
  assert.equal(retry.alreadyApplied, true);

  inspection = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(
    inspection
      .prepare(
        "SELECT balance FROM organization_wallets WHERE organization_id = 'org_test'",
      )
      .get().balance,
    1000,
  );
  const ledger = inspection
    .prepare(
      `SELECT type, amount, balance_after, reference_type, reference_id
       FROM credit_ledger WHERE reference_id = ?`,
    )
    .get('launch-credit-2026-09-23');
  assert.deepEqual(
    { ...ledger },
    {
      type: 'admin_grant',
      amount: 875,
      balance_after: 1000,
      reference_type: 'admin_credit_grant',
      reference_id: 'launch-credit-2026-09-23',
    },
  );
  const audit = inspection
    .prepare(
      `SELECT action, target_type, target_id, metadata_json
       FROM audit_events WHERE action = 'wallet.credit_granted'`,
    )
    .get();
  assert.equal(audit.action, 'wallet.credit_granted');
  assert.equal(audit.target_type, 'organization_wallet');
  assert.equal(audit.target_id, 'org_test');
  assert.equal(JSON.parse(audit.metadata_json).balanceAfter, 1000);
  assert.equal(
    inspection.prepare('SELECT count(*) AS n FROM credit_ledger').get().n,
    1,
  );
  assert.equal(
    inspection.prepare('SELECT count(*) AS n FROM audit_events').get().n,
    1,
  );
  inspection.close();

  const satisfiedArgs = baseArgs.map((value) =>
    value === 'launch-credit-2026-09-23'
      ? 'launch-credit-already-funded-2026-09-23'
      : value,
  );
  const satisfiedDryRun = run(satisfiedArgs);
  assert.equal(satisfiedDryRun.status, 0, satisfiedDryRun.stderr);
  const satisfiedPlan = JSON.parse(satisfiedDryRun.stdout);
  assert.equal(satisfiedPlan.dryRun, true);
  assert.equal(satisfiedPlan.alreadySatisfied, true);
  assert.equal(satisfiedPlan.idempotencyRecorded, false);
  inspection = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(
    inspection.prepare('SELECT count(*) AS n FROM credit_ledger').get().n,
    1,
  );
  assert.equal(
    inspection.prepare('SELECT count(*) AS n FROM audit_events').get().n,
    1,
  );
  inspection.close();

  const satisfiedApply = run([...satisfiedArgs, '--apply']);
  assert.equal(satisfiedApply.status, 0, satisfiedApply.stderr);
  const satisfied = JSON.parse(satisfiedApply.stdout);
  assert.equal(satisfied.applied, false);
  assert.equal(satisfied.alreadySatisfied, true);
  assert.equal(satisfied.idempotencyRecorded, true);
  assert.equal(satisfied.creditsGranted, 0);

  inspection = new DatabaseSync(databasePath);
  const satisfiedLedger = inspection
    .prepare(
      `SELECT type, amount, balance_after, reference_type
       FROM credit_ledger WHERE reference_id = ?`,
    )
    .get('launch-credit-already-funded-2026-09-23');
  assert.deepEqual(
    { ...satisfiedLedger },
    {
      type: 'admin_grant',
      amount: 0,
      balance_after: 1000,
      reference_type: 'admin_credit_grant',
    },
  );
  const satisfiedAudit = inspection
    .prepare(
      `SELECT action, metadata_json FROM audit_events
       WHERE action = 'wallet.credit_grant_satisfied'`,
    )
    .get();
  assert.equal(satisfiedAudit.action, 'wallet.credit_grant_satisfied');
  assert.equal(JSON.parse(satisfiedAudit.metadata_json).alreadySatisfied, true);
  inspection
    .prepare(
      `UPDATE organization_wallets SET balance = 500
       WHERE organization_id = 'org_test'`,
    )
    .run();
  inspection.close();

  const satisfiedRetry = run([...satisfiedArgs, '--apply']);
  assert.equal(satisfiedRetry.status, 0, satisfiedRetry.stderr);
  const satisfiedReplay = JSON.parse(satisfiedRetry.stdout);
  assert.equal(satisfiedReplay.alreadyApplied, true);
  assert.equal(satisfiedReplay.alreadySatisfied, true);
  assert.equal(satisfiedReplay.creditsGranted, 0);
  assert.equal(satisfiedReplay.balance, 500);
  inspection = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(
    inspection
      .prepare(
        "SELECT balance FROM organization_wallets WHERE organization_id = 'org_test'",
      )
      .get().balance,
    500,
  );
  assert.equal(
    inspection.prepare('SELECT count(*) AS n FROM credit_ledger').get().n,
    2,
  );
  assert.equal(
    inspection.prepare('SELECT count(*) AS n FROM audit_events').get().n,
    2,
  );
  inspection.close();

  const changedSatisfiedRequest = run([
    ...satisfiedArgs.map((value) => (value === '1000' ? '1100' : value)),
    '--apply',
  ]);
  assert.notEqual(changedSatisfiedRequest.status, 0);
  assert.match(changedSatisfiedRequest.stderr, /different or incomplete grant/);

  const wrongOrganization = run([
    ...baseArgs.map((value) => {
      if (value === 'org_test') return 'org_other';
      if (value === 'launch-credit-2026-09-23') return 'wrong-org-attempt';
      return value;
    }),
    '--apply',
  ]);
  assert.notEqual(wrongOrganization.status, 0);
  assert.match(wrongOrganization.stderr, /belongs to org_test/);

  const reusedReference = run([
    ...baseArgs.map((value) => (value === '1000' ? '2000' : value)),
    '--apply',
  ]);
  assert.notEqual(reusedReference.status, 0);
  assert.match(reusedReference.stderr, /different or incomplete grant/);

  console.log('Admin credit grant assertions passed.');
} finally {
  try {
    chmodSync(directory, 0o700);
    chmodSync(databasePath, 0o600);
  } catch {
    // The database may already have been removed after a very early failure.
  }
  rmSync(directory, { recursive: true, force: true });
}
