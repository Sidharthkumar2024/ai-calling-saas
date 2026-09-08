import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import * as tax from '../lib/tax.ts';
import * as security from '../lib/security.ts';

// Execute the actual billing service against an isolated transactional D1 adapter.
// No real workspace, payment provider or persisted database is touched.
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`CREATE TABLE organizations(id TEXT PRIMARY KEY,currency TEXT);
CREATE TABLE organization_settings(organization_id TEXT,gstin TEXT,legal_name TEXT,billing_state TEXT,billing_country TEXT);
CREATE TABLE invoice_sequences(series TEXT,financial_year TEXT,next_value INTEGER, UNIQUE(series,financial_year));
CREATE TABLE organization_wallets(organization_id TEXT PRIMARY KEY,balance INTEGER,low_balance_threshold INTEGER,updated_at TEXT);
CREATE TABLE invoices(id TEXT PRIMARY KEY,organization_id TEXT,invoice_number TEXT,sequence_number INTEGER,financial_year TEXT,status TEXT,line_items_json TEXT,subtotal INTEGER,tax INTEGER,total INTEGER,currency TEXT,tax_kind TEXT,cgst INTEGER,sgst INTEGER,igst INTEGER,tax_note TEXT,supplier_gstin TEXT,customer_gstin TEXT,place_of_supply TEXT,external_invoice_id TEXT,paid_at TEXT);
CREATE TABLE credit_ledger(id TEXT PRIMARY KEY,organization_id TEXT,type TEXT,amount INTEGER,balance_after INTEGER,reference_type TEXT,reference_id TEXT,description TEXT);
CREATE TABLE plans(id TEXT PRIMARY KEY,name TEXT,included_credits INTEGER,status TEXT);
CREATE TABLE subscriptions(id TEXT PRIMARY KEY,organization_id TEXT UNIQUE,plan_id TEXT,status TEXT,external_customer_id TEXT,external_subscription_id TEXT,current_period_end TEXT);
INSERT INTO organizations VALUES ('one','INR'),('two','INR');
INSERT INTO plans VALUES ('basic','Basic',50,'active'),('growth','Growth',100,'active');`);
let failLedger = false;
const db = {
  prepare(sql) {
    return { bind(...args) {
      return { sql, args, first: async () => sqlite.prepare(sql).get(...args) ?? null, run: async () => sqlite.prepare(sql).run(...args) };
    } };
  },
  async batch(statements) {
    sqlite.exec('BEGIN');
    try {
      for (const {sql,args} of statements) {
        if (failLedger && sql.includes('INSERT INTO credit_ledger')) throw new Error('Injected ledger failure');
        sqlite.prepare(sql).run(...args);
      }
      sqlite.exec('COMMIT');
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};
const code = ts.transpileModule(readFileSync(new URL('../lib/billing.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
const modules = { '@/db/bootstrap': { ensureSchema: async () => {} }, '@/db/index': { getRawDb: () => db }, '@/lib/tax': tax, '@/lib/security': security };
compileFunction(code,['require','exports'])((id) => { if (!(id in modules)) throw new Error(`Unexpected import ${id}`); return modules[id]; },exports);
const buy = (externalId, organizationId = 'one', credits = 100) => exports.applyCreditPurchase({organizationId,credits,amount:1000,description:'Isolated test',externalId});
const first = await buy('cs_test_one');
assert.equal(first.balance,100);
assert.equal(first.creditsAdded,100);
assert.equal((await buy('cs_test_one')).invoiceId,first.invoiceId);
assert.equal((await buy('cs_test_one')).balance,100);
const other = await buy('cs_test_one','two');
assert.notEqual(other.invoiceId,first.invoiceId);
assert.equal(other.balance,100);
const [retryA,retryB] = await Promise.all([buy('cs_test_concurrent'),buy('cs_test_concurrent')]);
assert.equal(retryA.invoiceId,retryB.invoiceId);
assert.equal(sqlite.prepare("SELECT balance FROM organization_wallets WHERE organization_id='one'").get().balance,200);
failLedger = true;
await assert.rejects(buy('cs_test_failure'),/Injected ledger failure/);
assert.equal(sqlite.prepare("SELECT balance FROM organization_wallets WHERE organization_id='one'").get().balance,200);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM invoices WHERE external_invoice_id='cs_test_failure'").get().n,0);
failLedger = false;
assert.equal((await buy('cs_test_failure')).balance,300);
assert.equal((await buy('cs_zero','one',0)).creditsAdded,0);
await assert.rejects(buy('cs_invalid','one',-1),/Invalid purchase/);
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM invoices').get().n,5);
assert.deepEqual(sqlite.prepare('SELECT sequence_number FROM invoices ORDER BY sequence_number').all().map(x=>x.sequence_number),[1,2,3,4,5]);
const plan = (planId,externalCheckoutId) => exports.applyPlanPurchase({organizationId:'one',planId,externalCheckoutId,amount:1000});
failLedger = true;
await assert.rejects(plan('basic','cs_plan_basic'),/Injected ledger failure/);
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM subscriptions').get().n,0);
assert.equal(sqlite.prepare("SELECT balance FROM organization_wallets WHERE organization_id='one'").get().balance,300);
failLedger = false;
await plan('basic','cs_plan_basic');
assert.equal(sqlite.prepare('SELECT plan_id FROM subscriptions').get().plan_id,'basic');
await plan('growth','cs_plan_growth');
const renewal = sqlite.prepare('SELECT current_period_end FROM subscriptions').get().current_period_end;
await plan('basic','cs_plan_basic');
assert.equal(sqlite.prepare('SELECT plan_id FROM subscriptions').get().plan_id,'growth');
assert.equal(sqlite.prepare('SELECT current_period_end FROM subscriptions').get().current_period_end,renewal);
assert.equal(sqlite.prepare("SELECT balance FROM organization_wallets WHERE organization_id='one'").get().balance,450);
assert.deepEqual(sqlite.prepare('SELECT sequence_number FROM invoices ORDER BY sequence_number').all().map(x=>x.sequence_number),[1,2,3,4,5,6,7]);
sqlite.prepare("UPDATE plans SET status='legacy' WHERE id='basic'").run();
await plan('basic','cs_pending_before_catalog_change');
assert.equal(sqlite.prepare('SELECT plan_id FROM subscriptions').get().plan_id,'basic');
assert.equal(sqlite.prepare("SELECT balance FROM organization_wallets WHERE organization_id='one'").get().balance,500);
await plan('basic','cs_pending_before_catalog_change');
assert.equal(sqlite.prepare("SELECT balance FROM organization_wallets WHERE organization_id='one'").get().balance,500);
sqlite.prepare("UPDATE plans SET status='disabled' WHERE id='basic'").run();
await assert.rejects(plan('basic','cs_disabled'),/Plan not found/);
sqlite.close();
console.log('Billing fulfillment: 28 assertions passed (isolated SQLite).');
