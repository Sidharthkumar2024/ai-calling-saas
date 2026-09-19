import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { compileFunction } from 'node:vm';
import ts from 'typescript';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`
CREATE TABLE organization_wallets(
  organization_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL,
  low_balance_threshold INTEGER,
  updated_at TEXT
);
CREATE TABLE credit_ledger(
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  description TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO organization_wallets VALUES ('org_1', 100, 500, CURRENT_TIMESTAMP);
INSERT INTO organization_wallets VALUES ('org_low', 1, 500, CURRENT_TIMESTAMP);
`);

const db = {
  prepare(sql) {
    return {
      bind(...args) {
        return {
          sql,
          args,
          first: async () => sqlite.prepare(sql).get(...args) ?? null,
          run: async () => sqlite.prepare(sql).run(...args),
        };
      },
    };
  },
  async batch(statements) {
    sqlite.exec('BEGIN');
    try {
      for (const { sql, args } of statements) sqlite.prepare(sql).run(...args);
      sqlite.exec('COMMIT');
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  },
};

const pricingExports = {};
const pricingCode = ts.transpileModule(
  readFileSync(
    new URL('../lib/customer-usage-pricing.ts', import.meta.url),
    'utf8',
  ),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
compileFunction(pricingCode, ['require', 'exports'])(
  (id) => {
    throw new Error(`Unexpected import ${id}`);
  },
  pricingExports,
);

const walletExports = {};
const walletCode = ts.transpileModule(
  readFileSync(new URL('../lib/usage-wallet.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
compileFunction(walletCode, ['require', 'exports'])(
  (id) => {
    if (id === '@/db/index') return { getRawDb: () => db };
    if (id === '@/lib/customer-usage-pricing') return pricingExports;
    throw new Error(`Unexpected import ${id}`);
  },
  walletExports,
);

const { holdUsageCredits, finalizeUsageCredits, releaseUsageHold } =
  walletExports;

const hold = await holdUsageCredits({
  organizationId: 'org_1',
  referenceType: 'whatsapp',
  referenceId: 'msg_1',
  rateId: 'whatsapp_marketing_message',
  quantity: 2,
});
assert.equal(hold.status, 'held');
assert.equal(hold.estimatedCredits, 12);
assert.equal(hold.balance, 88);

const replayHold = await holdUsageCredits({
  organizationId: 'org_1',
  referenceType: 'whatsapp',
  referenceId: 'msg_1',
  rateId: 'whatsapp_marketing_message',
  quantity: 2,
});
assert.equal(replayHold.status, 'already_done');
assert.equal(replayHold.balance, 88);

const finalized = await finalizeUsageCredits({
  organizationId: 'org_1',
  referenceType: 'whatsapp',
  referenceId: 'msg_1',
  rateId: 'whatsapp_marketing_message',
  quantity: 3,
});
assert.equal(finalized.status, 'finalized');
assert.equal(finalized.estimatedCredits, 12);
assert.equal(finalized.finalCredits, 18);
assert.equal(finalized.balance, 82);

const replayFinalize = await finalizeUsageCredits({
  organizationId: 'org_1',
  referenceType: 'whatsapp',
  referenceId: 'msg_1',
  rateId: 'whatsapp_marketing_message',
  quantity: 3,
});
assert.equal(replayFinalize.status, 'already_done');
assert.equal(replayFinalize.balance, 82);

await holdUsageCredits({
  organizationId: 'org_1',
  referenceType: 'sms',
  referenceId: 'sms_1',
  rateId: 'sms_message',
  quantity: 5,
});
const released = await releaseUsageHold({
  organizationId: 'org_1',
  referenceType: 'sms',
  referenceId: 'sms_1',
});
assert.equal(released.status, 'released');
assert.equal(released.estimatedCredits, 10);
assert.equal(released.balance, 82);

const low = await holdUsageCredits({
  organizationId: 'org_low',
  referenceType: 'call',
  referenceId: 'call_1',
  rateId: 'call_outbound_minute',
  quantity: 1,
});
assert.equal(low.status, 'insufficient');
assert.equal(low.balance, 1);

assert.equal(
  sqlite.prepare("SELECT balance FROM organization_wallets WHERE organization_id='org_1'").get()
    .balance,
  82,
);
assert.equal(
  sqlite.prepare("SELECT count(*) AS n FROM credit_ledger WHERE organization_id='org_1'").get()
    .n,
  4,
);

sqlite.close();
console.log('Usage wallet: 17 assertions passed (isolated SQLite).');
