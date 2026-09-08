import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import * as catalog from '../lib/commercial-catalog.ts';
import { reserveRealtime, refundRealtime } from '../lib/realtime-reservations.ts';
import { exotelCredits, settleExotel } from '../lib/exotel-settlement.ts';
import { settlePlaygroundTurn } from '../lib/playground-settlement.ts';
import { contribution, PLANS, CREDIT_PACKS } from '../lib/commercial-catalog.ts';
import { PUBLIC_API_SPEC } from '../lib/public-api-spec.ts';
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`CREATE TABLE organizations(id TEXT PRIMARY KEY); CREATE TABLE voice_agents(id TEXT PRIMARY KEY); INSERT INTO organizations VALUES ('org'),('other'); INSERT INTO voice_agents VALUES ('agent');
CREATE TABLE organization_wallets(organization_id TEXT PRIMARY KEY, balance INTEGER NOT NULL, updated_at TEXT); INSERT INTO organization_wallets VALUES ('org',10,NULL),('other',10,NULL);
CREATE TABLE credit_ledger(id TEXT PRIMARY KEY, organization_id TEXT, type TEXT, amount INTEGER, balance_after INTEGER, reference_type TEXT, reference_id TEXT, description TEXT);
CREATE TABLE agent_test_sessions(id TEXT PRIMARY KEY, organization_id TEXT, agent_id TEXT, mode TEXT,status TEXT,credits_used INTEGER,updated_at TEXT);
CREATE TABLE call_records(id TEXT PRIMARY KEY,organization_id TEXT,cost_credits INTEGER); INSERT INTO call_records VALUES ('call','org',0);`);
sqlite.exec(readFileSync(new URL('../drizzle/0009_naive_lionheart.sql',import.meta.url),'utf8'));
let injectFailure = false;
const db = {
  prepare(sql) { return { sql, args: [], bind(...args) { this.args=args; return this; }, async first(){return sqlite.prepare(sql).get(...this.args) ?? null;}, async run(){return sqlite.prepare(sql).run(...this.args);} }; },
  async batch(statements) { sqlite.exec('BEGIN'); try { const results=statements.map(s=>{ if(injectFailure && s.sql.startsWith('INSERT INTO credit_ledger')) throw new Error('ledger failure'); return sqlite.prepare(s.sql).run(...s.args); }); sqlite.exec('COMMIT'); return results; }catch(e){sqlite.exec('ROLLBACK');throw e;} },
};
const reserve = (id, hash='offer',org='org') => reserveRealtime(db,{id,organizationId:org,agentId:'agent',requestHash:hash});
const balance=()=>sqlite.prepare("SELECT balance FROM organization_wallets WHERE organization_id='org'").get().balance;
const [a,b]=await Promise.all([reserve('a'),reserve('b')]);
assert.equal([a,b].filter(r=>r.status==='reserved').length,1);assert.equal(balance(),0);
assert.equal((await reserve('a')).replay,true);assert.equal(balance(),0);
assert.equal((await reserve('a','different')).mismatch,true);
await Promise.all([refundRealtime(db,'a','rejected'),refundRealtime(db,'a','rejected')]); assert.equal(balance(),10);
assert.equal(sqlite.prepare("SELECT count(*) n FROM credit_ledger WHERE type='refund'").get().n,1);
injectFailure=true;await assert.rejects(reserve('failed'),/ledger failure/);assert.equal(balance(),10);assert.equal(sqlite.prepare("SELECT count(*) n FROM realtime_reservations WHERE id='failed'").get().n,0);
injectFailure=false;await reserve('c');injectFailure=true;await assert.rejects(refundRealtime(db,'c','rejected'));assert.equal(balance(),0);assert.equal(sqlite.prepare("SELECT status FROM realtime_reservations WHERE id='c'").get().status,'reserved');
injectFailure=false;await refundRealtime(db,'c','rejected');
const [sameA,sameB] = await Promise.all([reserve('same'),reserve('same')]);assert.equal([sameA,sameB].filter(r=>!r.replay).length,1);assert.equal(balance(),0);
await reserve('other','offer','other');
sqlite.prepare("UPDATE realtime_reservations SET status='reconciliation_required' WHERE id='same'").run();await refundRealtime(db,'same','unsafe');assert.equal(balance(),0);
sqlite.prepare("UPDATE organization_wallets SET balance=30 WHERE organization_id='org'").run();
const [settledA,settledB]=await Promise.all([settleExotel(db,'org','call',20),settleExotel(db,'org','call',20)]);assert.equal(Number(settledA)+Number(settledB),1);assert.equal(balance(),10);
await reserve('after-call');assert.equal(balance(),0);assert.equal(sqlite.prepare("SELECT balance_after FROM credit_ledger WHERE id='debit_after-call'").get().balance_after,0);
sqlite.prepare("INSERT INTO call_records VALUES ('call2','org',0)").run();await settleExotel(db,'org','call2',10);assert.equal(balance(),-10);
assert.deepEqual([0,1,60,61,120,121].map(exotelCredits),[10,10,10,20,20,30]);assert.throws(()=>exotelCredits(NaN));
assert.equal(PLANS[0].monthly,2999);assert.equal(CREDIT_PACKS[0].amount,190000);assert.equal(contribution(2999,500).gross,6874.03);assert.equal(contribution(1,-1),null);
assert.equal(PUBLIC_API_SPEC.openapi,'3.1.0');assert.deepEqual(Object.keys(PUBLIC_API_SPEC.paths),['/leads','/credits']);
assert.equal(PUBLIC_API_SPEC.paths['/leads'].post.requestBody.required,true);
sqlite.exec(`CREATE TABLE plans(id TEXT PRIMARY KEY,code TEXT UNIQUE,name TEXT,monthly_price INTEGER,included_credits INTEGER,max_agents INTEGER,max_numbers INTEGER,concurrency INTEGER,features_json TEXT,status TEXT);
CREATE TABLE credit_packages(id TEXT PRIMARY KEY,name TEXT,credits INTEGER,amount INTEGER,status TEXT);
CREATE TABLE billing_events(id TEXT PRIMARY KEY,external_event_id TEXT UNIQUE,event_type TEXT,payload_json TEXT);
CREATE TABLE subscriptions(organization_id TEXT PRIMARY KEY,plan_id TEXT,status TEXT,current_period_end TEXT);
INSERT INTO plans VALUES ('plan_growth','growth','Growth',799900,10000,5,3,3,'[]','active');
INSERT INTO credit_packages VALUES ('credits_1000','Old',1000,99900,'active');
INSERT INTO subscriptions VALUES ('org','plan_growth','active','2026-10-01');`);
const pubCode = ts.transpileModule(readFileSync(new URL('../lib/publish-commercial-catalog.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const publication={};compileFunction(pubCode,['require','exports'])(id=>{if(id==='./commercial-catalog')return catalog;throw Error(id);},publication);
const beforeCatalogBalance=balance();
await Promise.all([publication.publishCommercialCatalog(db),publication.publishCommercialCatalog(db)]);
await publication.publishCommercialCatalog(db);
assert.equal(sqlite.prepare('SELECT count(*) n FROM billing_events').get().n,1);
assert.equal(sqlite.prepare("SELECT count(*) n FROM plans WHERE status='active'").get().n,3);
assert.equal(sqlite.prepare("SELECT status FROM plans WHERE id='plan_growth'").get().status,'legacy');
assert.equal(sqlite.prepare("SELECT monthly_price FROM plans WHERE id='plan_growth'").get().monthly_price,799900);
assert.equal(sqlite.prepare('SELECT plan_id FROM subscriptions').get().plan_id,'plan_growth');assert.equal(balance(),beforeCatalogBalance);
const billingRoute=readFileSync(new URL('../app/api/app/billing/route.ts',import.meta.url),'utf8');
const subscriptionSql=billingRoute.match(/`(SELECT p\.id,[\s\S]*?WHERE s\.organization_id = \? LIMIT 1)`/)[1];
const contract=sqlite.prepare(subscriptionSql).get('org');
assert.equal(contract.status,'active');assert.equal(contract.catalog_status,'legacy');

// --- playground turn settlement ------------------------------------------------
// The hole this closes: the debit carried `balance >= cost` as a guard and the
// ledger insert beside it did not, so a wallet that could not pay produced a
// ledger row for a debit that never happened — and the turn was delivered free.
sqlite.prepare("INSERT INTO agent_test_sessions VALUES ('sess','org','agent','text','active',0,NULL)").run();
sqlite.prepare("UPDATE organization_wallets SET balance=25 WHERE organization_id='org'").run();
const settleTurn=(turnId)=>settlePlaygroundTurn(db,{organizationId:'org',sessionId:'sess',turnId,credits:10});
assert.equal((await settleTurn('t1')).charged,true);assert.equal(balance(),15);
// A retry of the same turn settles once, and says so rather than charging again.
const retry=await settleTurn('t1');assert.equal(retry.charged,false);assert.equal(retry.alreadySettled,true);assert.equal(balance(),15);
// Two turns racing on a wallet that can only pay for one: exactly one is
// charged, the other is refused, and the balance never goes negative — which
// is what the shared `balance >= cost` predicate on both statements buys.
sqlite.prepare("UPDATE organization_wallets SET balance=15 WHERE organization_id='org'").run();
const [r1,r2]=await Promise.all([settleTurn('t2'),settleTurn('t3')]);
assert.equal([r1,r2].filter(r=>r.charged).length,1);
assert.equal([r1,r2].filter(r=>r.reason).length,1);
assert.equal(balance(),5);
// With room for both, both settle.
sqlite.prepare("UPDATE organization_wallets SET balance=25 WHERE organization_id='org'").run();
const [r3,r4]=await Promise.all([settleTurn('t2b'),settleTurn('t3b')]);
assert.equal([r3,r4].filter(r=>r.charged).length,2);assert.equal(balance(),5);
// THE ONE THAT LEAKED: with too little left, neither the debit nor the ledger
// row happens — previously the ledger row happened alone.
sqlite.prepare("UPDATE organization_wallets SET balance=4 WHERE organization_id='org'").run();
const poor=await settleTurn('t4');
assert.equal(poor.charged,false);assert.equal(poor.alreadySettled,false);
assert.match(poor.reason,/Not enough credits/);
assert.equal(balance(),4);
assert.equal(sqlite.prepare("SELECT count(*) n FROM credit_ledger WHERE id='playground_turn_t4'").get().n,0);
// `balance_after` comes from the wallet at debit time, not from a value read
// before the provider was called: two settled turns cannot share one.
sqlite.prepare("UPDATE organization_wallets SET balance=100 WHERE organization_id='org'").run();
await settleTurn('t5');await settleTurn('t6');
const afters=sqlite.prepare("SELECT balance_after FROM credit_ledger WHERE id IN ('playground_turn_t5','playground_turn_t6') ORDER BY balance_after DESC").all().map(r=>r.balance_after);
assert.deepEqual(afters,[90,80]);
// The session's own counter moves with the wallet, never on its own.
assert.equal(
  sqlite.prepare("SELECT credits_used FROM agent_test_sessions WHERE id='sess'").get().credits_used,
  10 * sqlite.prepare("SELECT count(*) n FROM credit_ledger WHERE id LIKE 'playground_turn_%'").get().n,
);
assert.rejects(settlePlaygroundTurn(db,{organizationId:'org',sessionId:'sess',turnId:'bad',credits:0}),/Invalid turn charge/);

sqlite.close();console.log('Release safety: reservation races, replay, refunds, rollback, Exotel settlement, debt, playground turn settlement, catalog publication, preserved contracts, pricing and API contract passed.');
