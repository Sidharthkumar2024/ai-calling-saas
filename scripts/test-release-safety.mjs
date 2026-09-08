import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import * as catalog from '../lib/commercial-catalog.ts';
import { reserveRealtime, refundRealtime, reconcileAsNotStarted, reconcileAsStarted, pendingReconciliations } from '../lib/realtime-reservations.ts';
import { exotelCredits, settleExotel } from '../lib/exotel-settlement.ts';
import { settlePlaygroundTurn } from '../lib/playground-settlement.ts';
import { browserCallCredits, settleBrowserCall, closeStaleReservations } from '../lib/browser-call-settlement.ts';
import { MAX_CONCURRENT_CALLS } from '../lib/call-limits.ts';
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
  prepare(sql) { return { sql, args: [], bind(...args) { this.args=args; return this; }, async first(){return sqlite.prepare(sql).get(...this.args) ?? null;}, async all(){return {results: sqlite.prepare(sql).all(...this.args)};}, async run(){const r=sqlite.prepare(sql).run(...this.args); return {...r, meta:{changes:r.changes}};} }; },
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

// --- browser calls ------------------------------------------------------------
// The hole this closes: the dialer read the balance, refused below ten, and
// then charged nothing. The check was a race with nothing held behind it, and
// a browser call was free.
assert.equal(browserCallCredits(0),10);
assert.equal(browserCallCredits(1),10);
assert.equal(browserCallCredits(60),10);
assert.equal(browserCallCredits(61),20);
assert.equal(browserCallCredits(150),30);
assert.throws(()=>browserCallCredits(-1),/Invalid duration/);

sqlite.prepare("UPDATE organization_wallets SET balance=100 WHERE organization_id='org'").run();
sqlite.prepare("INSERT INTO call_records VALUES ('bcall','org',0)").run();
// Start: the reservation is the held first minute.
await reserve('bcall');
assert.equal(balance(),90);
// A call under a minute is already paid for — settlement charges nothing more.
const short = await settleBrowserCall(db,{organizationId:'org',callId:'bcall',seconds:42});
assert.equal(short.settled,true);assert.equal(short.credits,10);assert.equal(short.extra,0);
assert.equal(balance(),90);
assert.equal(sqlite.prepare("SELECT status FROM realtime_reservations WHERE id='bcall'").get().status,'settled');
assert.equal(sqlite.prepare("SELECT cost_credits FROM call_records WHERE id='bcall'").get().cost_credits,10);

// A longer call charges only the minutes beyond the reservation — never the
// reservation over again.
sqlite.prepare("INSERT INTO call_records VALUES ('bcall2','org',0)").run();
await reserve('bcall2');assert.equal(balance(),80);
const long = await settleBrowserCall(db,{organizationId:'org',callId:'bcall2',seconds:185});
assert.equal(long.credits,40);assert.equal(long.extra,30);assert.equal(balance(),50);
assert.equal(sqlite.prepare("SELECT cost_credits FROM call_records WHERE id='bcall2'").get().cost_credits,40);

// Two ends racing — a double-clicked hang-up, or a gateway reporting twice —
// settle once.
sqlite.prepare("INSERT INTO call_records VALUES ('bcall3','org',0)").run();
await reserve('bcall3');const beforeRace=balance();
const [e1,e2]=await Promise.all([
  settleBrowserCall(db,{organizationId:'org',callId:'bcall3',seconds:120}),
  settleBrowserCall(db,{organizationId:'org',callId:'bcall3',seconds:120}),
]);
assert.equal([e1,e2].filter(r=>r.settled).length,1);
assert.equal([e1,e2].filter(r=>r.alreadySettled).length,1);
assert.equal(balance(),beforeRace-10);
assert.equal(sqlite.prepare("SELECT count(*) n FROM credit_ledger WHERE id='browser_settlement_bcall3'").get().n,1);

// Debt is kept, not erased: a long call on a thin wallet goes negative rather
// than quietly costing nothing.
sqlite.prepare("UPDATE organization_wallets SET balance=10 WHERE organization_id='org'").run();
sqlite.prepare("INSERT INTO call_records VALUES ('bcall4','org',0)").run();
await reserve('bcall4');assert.equal(balance(),0);
await settleBrowserCall(db,{organizationId:'org',callId:'bcall4',seconds:300});
assert.equal(balance(),-40);

// An abandoned browser call — a closed tab, or a widget session that has no
// end at all — must not leave its reservation held for ever. The idle closer
// settles it, and settling twice does not charge twice.
sqlite.prepare("UPDATE organization_wallets SET balance=100 WHERE organization_id='org'").run();
sqlite.prepare("INSERT INTO call_records VALUES ('abandoned','org',0)").run();
await reserve('abandoned');assert.equal(balance(),90);
const swept = await settleBrowserCall(db,{organizationId:'org',callId:'abandoned',seconds:0});
assert.equal(swept.settled,true);assert.equal(swept.extra,0);
assert.equal(sqlite.prepare("SELECT status FROM realtime_reservations WHERE id='abandoned'").get().status,'settled');
const sweptAgain = await settleBrowserCall(db,{organizationId:'org',callId:'abandoned',seconds:0});
assert.equal(sweptAgain.alreadySettled,true);assert.equal(balance(),90);

// --- concurrency ceiling -------------------------------------------------------
// A reservation holds one started minute, which is the right floor and no
// ceiling at all: nothing stopped a workspace opening calls in parallel, each
// holding ten credits and each free to run for an hour.
sqlite.prepare("DELETE FROM realtime_reservations").run();
sqlite.prepare("UPDATE organization_wallets SET balance=1000 WHERE organization_id='org'").run();
const opened=[];
for (let i=0;i<MAX_CONCURRENT_CALLS;i+=1) opened.push(await reserve(`cap${i}`,`hash${i}`));
assert.equal(opened.filter(r=>r.status==='reserved').length,MAX_CONCURRENT_CALLS);
// The one past the limit is refused, and the wallet is not touched for it.
const beforeCap=balance();
const overflow=await reserve('cap-overflow','hash-overflow');
assert.equal(overflow.status,'at_capacity');
assert.equal(balance(),beforeCap);
assert.equal(sqlite.prepare("SELECT count(*) n FROM credit_ledger WHERE id='debit_cap-overflow'").get().n,0);
// Ending one makes room for exactly one more.
sqlite.prepare("INSERT INTO call_records VALUES ('cap0','org',0)").run();
await settleBrowserCall(db,{organizationId:'org',callId:'cap0',seconds:30});
assert.equal((await reserve('cap-after','hash-after')).status,'reserved');
// Another workspace's open calls are not counted against this one.
sqlite.prepare("UPDATE organization_wallets SET balance=1000 WHERE organization_id='other'").run();
assert.equal((await reserve('other-cap','hash-other','other')).status,'reserved');

// --- reservations nothing ever closed -----------------------------------------
// A realtime session reserves and runs, and nothing ends it. Invisible until a
// concurrency cap was put on that table: six of them and the workspace could
// never call again, because the slots were held by sessions that ended hours
// ago in the only place that knew — the browser.
sqlite.prepare("DELETE FROM realtime_reservations").run();
sqlite.prepare("UPDATE organization_wallets SET balance=1000 WHERE organization_id='org'").run();
await reserve('fresh','hash-fresh');
await reserve('stale','hash-stale');
sqlite.prepare("UPDATE realtime_reservations SET created_at = datetime('now','-120 minutes') WHERE id='stale'").run();
const balanceBeforeSweep = balance();
const released = await closeStaleReservations(db,'org',90);
assert.equal(released,1);
assert.equal(sqlite.prepare("SELECT status FROM realtime_reservations WHERE id='stale'").get().status,'settled');
assert.equal(sqlite.prepare("SELECT error_code FROM realtime_reservations WHERE id='stale'").get().error_code,'closed_without_end_signal');
// A session still inside the ceiling keeps its slot.
assert.equal(sqlite.prepare("SELECT status FROM realtime_reservations WHERE id='fresh'").get().status,'reserved');
// Nothing is charged for minutes nobody measured.
assert.equal(balance(),balanceBeforeSweep);
// Sweeping again finds nothing and charges nothing.
assert.equal(await closeStaleReservations(db,'org',90),0);
assert.equal(balance(),balanceBeforeSweep);
// Another workspace's stale reservation is not this one's to close.
await reserve('other-stale','hash-os','other');
sqlite.prepare("UPDATE realtime_reservations SET created_at = datetime('now','-120 minutes') WHERE id='other-stale'").run();
assert.equal(await closeStaleReservations(db,'org',90),0);
assert.equal(sqlite.prepare("SELECT status FROM realtime_reservations WHERE id='other-stale'").get().status,'reserved');
// And the freed slot is usable again.
sqlite.prepare("DELETE FROM realtime_reservations WHERE id='fresh'").run();
assert.equal((await reserve('after-release','hash-ar')).status,'reserved');

// --- reconciliation ------------------------------------------------------------
// An uncertain negotiation parks the reservation and keeps the credits held.
// Nothing listed those rows and nothing resolved them, so a workspace was
// simply ten credits short with no line anywhere saying why.
sqlite.prepare("DELETE FROM realtime_reservations").run();
sqlite.prepare("UPDATE organization_wallets SET balance=100 WHERE organization_id='org'").run();
await reserve('uncertain-a','h-a');await reserve('uncertain-b','h-b');
sqlite.prepare("UPDATE realtime_reservations SET status='reconciliation_required', error_code='acceptance_uncertain' WHERE id IN ('uncertain-a','uncertain-b')").run();
const held = balance();
const queue = await pendingReconciliations(db,'org');
assert.equal(queue.length,2);
// Resolved as never started: the customer gets the credits back, once.
const refundOutcome = await reconcileAsNotStarted(db,'uncertain-a','provider shows no session');
assert.equal(refundOutcome.resolved,true);assert.equal(balance(),held+10);
assert.equal(sqlite.prepare("SELECT status FROM realtime_reservations WHERE id='uncertain-a'").get().status,'refunded');
const twice = await reconcileAsNotStarted(db,'uncertain-a','again');
assert.equal(twice.resolved,false);assert.equal(balance(),held+10);
// Resolved as started: the reservation becomes the charge, with no second debit.
const settledOutcome = await reconcileAsStarted(db,'uncertain-b','provider invoice shows the session');
assert.equal(settledOutcome.resolved,true);assert.equal(balance(),held+10);
assert.equal(sqlite.prepare("SELECT status FROM realtime_reservations WHERE id='uncertain-b'").get().status,'settled');
assert.equal((await reconcileAsStarted(db,'uncertain-b','again')).resolved,false);
// The queue empties as they are resolved.
assert.equal((await pendingReconciliations(db,'org')).length,0);
// A normal reservation cannot be resolved through this path — it is not parked.
await reserve('normal','h-normal');
assert.equal((await reconcileAsNotStarted(db,'normal','wrong path')).resolved,false);
assert.equal((await reconcileAsStarted(db,'normal','wrong path')).resolved,false);
assert.equal(sqlite.prepare("SELECT status FROM realtime_reservations WHERE id='normal'").get().status,'reserved');

sqlite.close();console.log('Release safety: reservation races, replay, refunds, rollback, Exotel settlement, debt, playground turn settlement, browser call reservation and settlement, concurrency ceiling, stale reservation release, reconciliation, catalog publication, preserved contracts, pricing and API contract passed.');
