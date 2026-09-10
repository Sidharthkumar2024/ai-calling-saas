/**
 * What a campaign pass does to the contacts it looked at.
 *
 * Nothing in this product places a call for a campaign: `startOutboundCall`
 * exists and is reached only by POST /api/app/calls, one number at a time. The
 * dial loop nonetheless marked every eligible contact `dialing`, consumed an
 * attempt, scheduled a retry and added it to `campaigns.attempted` — so a
 * workspace with a stream URL configured watched the attempt count climb
 * through its audience while no phone rang.
 *
 * Compiles the real lib/campaign-dialer.ts against in-memory SQLite. No
 * provider is contacted and no call is placed.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { compileFunction } from 'node:vm';
import ts from 'typescript';

import * as shifts from '../lib/shifts.ts';

let checks = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks += 1;
};
const ok = (value, message) => {
  assert.ok(value, message);
  checks += 1;
};

const ORG = 'org_test';
const CAMP = 'camp_1';
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`
  CREATE TABLE campaigns (id TEXT PRIMARY KEY, organization_id TEXT, agent_id TEXT,
    name TEXT, status TEXT, attempted INTEGER DEFAULT 0, concurrency INTEGER,
    retry_policy_json TEXT, calling_window_json TEXT);
  CREATE TABLE campaign_contacts (id TEXT PRIMARY KEY, organization_id TEXT,
    campaign_id TEXT, phone TEXT, consent_status TEXT, status TEXT,
    attempt_count INTEGER DEFAULT 0, next_attempt_at TEXT, outcome TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE call_records (id TEXT PRIMARY KEY, organization_id TEXT,
    campaign_id TEXT, status TEXT);
  CREATE TABLE suppression_entries (id TEXT PRIMARY KEY, organization_id TEXT,
    phone_hash TEXT, scope TEXT, expires_at TEXT);
  CREATE TABLE organization_wallets (organization_id TEXT PRIMARY KEY, balance INTEGER);
`);
sqlite.prepare('INSERT INTO organization_wallets (organization_id, balance) VALUES (?,?)').run(ORG, 5000);
sqlite.prepare(`INSERT INTO campaigns (id, organization_id, agent_id, name, status, concurrency, retry_policy_json, calling_window_json)
  VALUES (?,?,?,?,'running',10,'{"attempts":3}','{"start":"00:00","end":"23:59"}')`).run(CAMP, ORG, 'agent_1', 'Walk');

const addContact = (id, over = {}) =>
  sqlite.prepare(`INSERT INTO campaign_contacts (id, organization_id, campaign_id, phone, consent_status, status, attempt_count)
    VALUES (?,?,?,?,?,?,?)`).run(
    id,
    ORG,
    CAMP,
    over.phone ?? `+9198000000${id.slice(-1)}`,
    over.consent ?? 'granted',
    over.status ?? 'pending',
    over.attempts ?? 0,
  );

function statement(query, args = []) {
  return {
    bind: (...values) => statement(query, values),
    async first() {
      return sqlite.prepare(query).get(...args) ?? null;
    },
    async all() {
      return { results: sqlite.prepare(query).all(...args) };
    },
    async run() {
      const info = sqlite.prepare(query).run(...args);
      return { meta: { changes: Number(info.changes ?? 0) } };
    },
  };
}

/** Every job the pass raised — the only thing it is allowed to send anywhere. */
const jobs = [];
const modules = {
  '@/db/index': { getRawDb: () => ({ prepare: statement }) },
  '@/lib/job-enqueue': {
    enqueueJob: async (job) => {
      jobs.push(job);
      return {};
    },
  },
  '@/lib/onboarding-service': {
    assertCanPlaceRealCall: async () => ({ allowed: true }),
  },
  '@/lib/plan-limits': {
    checkPlanLimit: async () => ({ allowed: true, limit: 10 }),
  },
  '@/lib/security': {
    sha256: async (value) => `hash:${value}`,
  },
  '@/lib/shifts': shifts,
};

const dialer = {};
compileFunction(
  ts.transpileModule(
    readFileSync(new URL('../lib/campaign-dialer.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  ['require', 'exports'],
)(
  (id) => {
    if (!modules[id]) throw Error(id);
    return modules[id];
  },
  dialer,
);

const contactRow = (id) =>
  sqlite.prepare('SELECT status, outcome, attempt_count, next_attempt_at FROM campaign_contacts WHERE id = ?').get(id);
const campaignRow = () =>
  sqlite.prepare('SELECT status, attempted FROM campaigns WHERE id = ?').get(CAMP);

// --- a pass over contacts nothing is stopping ------------------------------------

process.env.VOICE_STREAM_URL = 'wss://gateway.example.com/stream';
addContact('cc_1');
addContact('cc_2');
const pass = await dialer.dialCampaign(ORG, CAMP);

// THE ONE THAT WAS BROKEN.
equal(pass.attempted, 0, 'a pass that placed no call reports no attempts');
equal(campaignRow().attempted, 0, 'and the campaign total does not move');
equal(
  sqlite.prepare('SELECT COUNT(*) AS n FROM call_records').get().n,
  0,
  'no call record is written, because no call was placed',
);
equal(pass.skipped.origination_not_wired, 2, 'both contacts are accounted for by name');
for (const id of ['cc_1', 'cc_2']) {
  const row = contactRow(id);
  equal(row.status, 'blocked', `${id} is not left looking dialled`);
  equal(row.outcome, 'origination_not_wired');
  equal(row.attempt_count, 0, 'and an attempt nobody made is not consumed');
  equal(row.next_attempt_at, null, 'nor a retry scheduled for a call that never happened');
}
// A blocked contact is out of the due set, so the next pass does not churn it.
equal(pass.considered, 2);
const second = await dialer.dialCampaign(ORG, CAMP);
equal(second.considered, 0, 'the next pass finds nothing left to look at');
equal(second.status, 'completed', 'and the campaign ends rather than looping for ever');

// --- the gates that were already right -------------------------------------------

sqlite.prepare('UPDATE campaigns SET status = ? WHERE id = ?').run('running', CAMP);
addContact('cc_3', { consent: 'pending' });
addContact('cc_4', { phone: '+919800000099' });
sqlite.prepare(`INSERT INTO suppression_entries (id, organization_id, phone_hash, scope) VALUES (?,?,?,?)`)
  .run('sup_1', ORG, 'hash:+919800000099', 'organization');
const gated = await dialer.dialCampaign(ORG, CAMP);
equal(gated.skipped.no_consent, 1);
equal(gated.skipped.suppressed, 1);
equal(gated.attempted, 0);

// With no gateway configured the reason is the older, different one: nothing
// is connected at all, rather than connected-but-unreachable-from-a-campaign.
sqlite.prepare('UPDATE campaigns SET status = ? WHERE id = ?').run('running', CAMP);
process.env.VOICE_STREAM_URL = '';
addContact('cc_5');
const unconfigured = await dialer.dialCampaign(ORG, CAMP);
equal(unconfigured.skipped.telephony_unconfigured, 1);
equal(contactRow('cc_5').outcome, 'telephony_unconfigured');
equal(unconfigured.attempted, 0);

ok(
  jobs.every((job) => job.type === 'campaign.dial'),
  'the only thing a pass sends anywhere is its own next pass',
);

console.log(`campaign dialer: ${checks} assertions passed; no call placed.`);
