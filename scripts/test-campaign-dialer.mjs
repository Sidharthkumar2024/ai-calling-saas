/**
 * A campaign, from the first dial to the last retry.
 *
 * The dial loop used to stop before the call: every eligible contact was
 * recorded `blocked` with the reason `origination_not_wired`, because placing
 * calls is only half of a dialer and the other half was missing. Nothing joined
 * a call back to the contact it was placed for, so a contact who answered would
 * be dialled again on the next backoff until the attempt limit ran out — the
 * product would telephone somebody it had already spoken to.
 *
 * This walks the whole thing against in-memory SQLite: the pass that dials, the
 * webhook that settles, the retry that is actually scheduled from the
 * customer's own policy, and the sweep that rescues a contact whose webhook
 * never came. The carrier is a stub that records what it was asked to do. No
 * provider is contacted and no call is placed.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { compileFunction } from 'node:vm';
import ts from 'typescript';

import * as settlement from '../lib/campaign-settlement.ts';
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
    name TEXT, status TEXT, attempted INTEGER DEFAULT 0, connected INTEGER DEFAULT 0,
    concurrency INTEGER, retry_policy_json TEXT, calling_window_json TEXT);
  CREATE TABLE campaign_contacts (id TEXT PRIMARY KEY, organization_id TEXT,
    campaign_id TEXT, lead_id TEXT, phone TEXT, consent_status TEXT, status TEXT,
    attempt_count INTEGER DEFAULT 0, next_attempt_at TEXT, outcome TEXT,
    last_call_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE call_records (id TEXT PRIMARY KEY, organization_id TEXT, agent_id TEXT,
    lead_id TEXT, campaign_id TEXT, campaign_contact_id TEXT, direction TEXT,
    from_number TEXT, to_number TEXT, status TEXT, outcome TEXT, recording_status TEXT,
    provider_reference TEXT, disconnect_reason TEXT, started_at TEXT, ended_at TEXT,
    analysis_json TEXT DEFAULT '{}');
  CREATE TABLE suppression_entries (id TEXT PRIMARY KEY, organization_id TEXT,
    phone_hash TEXT, scope TEXT, expires_at TEXT);
  CREATE TABLE organization_wallets (organization_id TEXT PRIMARY KEY, balance INTEGER);
  CREATE TABLE organization_settings (organization_id TEXT PRIMARY KEY, recording_policy TEXT);
`);
sqlite
  .prepare(
    'INSERT INTO organization_wallets (organization_id, balance) VALUES (?,?)',
  )
  .run(ORG, 5000);
sqlite
  .prepare(
    'INSERT INTO organization_settings (organization_id, recording_policy) VALUES (?,?)',
  )
  .run(ORG, 'record_with_consent');
// Two hours, then a day — the ladder the campaign form has always written and
// nothing has ever read.
sqlite
  .prepare(`INSERT INTO campaigns (id, organization_id, agent_id, name, status, concurrency, retry_policy_json, calling_window_json)
  VALUES (?,?,?,?,'running',10,'{"attempts":3,"backoffMinutes":[120,1440]}','{"start":"00:00","end":"23:59"}')`)
  .run(CAMP, ORG, 'agent_1', 'Walk');

const addContact = (id, over = {}) =>
  sqlite
    .prepare(`INSERT INTO campaign_contacts (id, organization_id, campaign_id, phone, consent_status, status, attempt_count)
    VALUES (?,?,?,?,?,?,?)`)
    .run(
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
const db = { prepare: statement };

/** Every job the pass raised — the only thing it is allowed to send anywhere. */
const jobs = [];
/** Every call the carrier was asked to place, and whether it agreed. */
const dialled = [];
let carrierRefuses = null;

const modules = {
  '@/db/index': { getRawDb: () => db },
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
  '@/lib/security': { sha256: async (value) => `hash:${value}` },
  '@/lib/shifts': shifts,
  '@/lib/campaign-settlement': settlement,
  '@/lib/carrier-router': {
    chooseCarrier: async () => ({ carrier: 'exotel', fromNumber: null }),
  },
  '@/lib/provider-adapters': {
    startOutboundCall: async (input) => {
      if (carrierRefuses) throw new Error(carrierRefuses);
      dialled.push(input);
      return {
        providerReference: `carrier_${dialled.length}`,
        status: 'queued',
        latencyMs: 12,
      };
    },
    startVobizCall: async () => {
      throw new Error('this walk never chooses Vobiz');
    },
  },
};

const dialer = {};
compileFunction(
  ts.transpileModule(
    readFileSync(new URL('../lib/campaign-dialer.ts', import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  ['require', 'exports'],
)((id) => {
  if (!modules[id]) throw Error(id);
  return modules[id];
}, dialer);

const contactRow = (id) =>
  sqlite
    .prepare(
      'SELECT status, outcome, attempt_count, next_attempt_at, last_call_id FROM campaign_contacts WHERE id = ?',
    )
    .get(id);
const campaignRow = () =>
  sqlite
    .prepare('SELECT status, attempted, connected FROM campaigns WHERE id = ?')
    .get(CAMP);
const callFor = (contactId) =>
  sqlite
    .prepare(
      'SELECT * FROM call_records WHERE campaign_contact_id = ? ORDER BY started_at DESC',
    )
    .get(contactId);

// --- a pass that dials ------------------------------------------------------------

process.env.VOICE_STREAM_URL = 'wss://gateway.example.com/stream';
addContact('cc_1');
addContact('cc_2');
const pass = await dialer.dialCampaign(ORG, CAMP);

equal(pass.attempted, 2, 'both contacts were dialled');
equal(campaignRow().attempted, 2, 'and the campaign total moved by that much');
equal(dialled.length, 2, 'the carrier was asked twice, once per contact');
equal(
  dialled.map((call) => call.destination).sort((a, b) => a.localeCompare(b)),
  ['+91980000001', '+91980000002'],
  'and asked for the contacts own numbers',
);

for (const id of ['cc_1', 'cc_2']) {
  const row = contactRow(id);
  equal(row.status, 'dialing', `${id} is on a call`);
  equal(row.attempt_count, 1, 'one attempt consumed, by one call');
  equal(
    row.next_attempt_at,
    null,
    'and no retry scheduled while it is ringing',
  );
  const call = callFor(id);
  ok(call, 'a call record exists for the contact');
  // THE LINK THAT WAS MISSING. Without it nothing can tell this campaign how
  // its own call ended, which is why the dialer refused to place one.
  equal(
    call.campaign_contact_id,
    id,
    'and it names the contact it was placed for',
  );
  equal(call.campaign_id, CAMP);
  equal(call.agent_id, 'agent_1', 'somebody is on this end of the call');
  equal(call.to_number, contactPhone(id), 'and the number it was placed to');
  equal(call.status, 'queued', 'queued is what the carrier said, not answered');
  ok(
    call.provider_reference,
    'the carrier call id is on the column, not only in a blob',
  );
}
function contactPhone(id) {
  return sqlite
    .prepare('SELECT phone FROM campaign_contacts WHERE id = ?')
    .get(id).phone;
}

// A campaign whose last contacts are still ringing is not finished.
equal(
  campaignRow().status,
  'running',
  'a ringing audience is not a completed campaign',
);

// THE ONE THAT WAS BROKEN, in its new form: the second pass must not ring the
// same two people again. `dialing` is not due, and nothing else makes it due.
const second = await dialer.dialCampaign(ORG, CAMP);
equal(second.considered, 0, 'nobody is due while their phone is ringing');
equal(dialled.length, 2, 'and the carrier was not asked a third time');

// --- the webhook that settles -----------------------------------------------------

const answered = await settlement.settleCampaignContactForCall(db, {
  callId: callFor('cc_1').id,
  status: 'completed',
  now: new Date('2026-09-12T10:00:00Z'),
});
equal(answered.settled, true);
equal(contactRow('cc_1').status, 'completed', 'a contact who answered is done');
equal(contactRow('cc_1').outcome, 'connected');
equal(contactRow('cc_1').next_attempt_at, null, 'and is never called again');
equal(
  contactRow('cc_1').last_call_id,
  callFor('cc_1').id,
  'the campaign can open the call',
);
equal(campaignRow().connected, 1, 'the campaign counts one connection');

// Carriers deliver callbacks more than once. The second delivery must change
// nothing — above all it must not count a second connection.
const again = await settlement.settleCampaignContactForCall(db, {
  callId: callFor('cc_1').id,
  status: 'completed',
  now: new Date('2026-09-12T10:00:05Z'),
});
equal(again.settled, false, 'a retried callback settles nothing twice');
equal(again.reason, 'already_settled');
equal(campaignRow().connected, 1, 'and the connected count does not drift');

// Nobody picked up: retried on the customer's own first rung, two hours.
const missed = await settlement.settleCampaignContactForCall(db, {
  callId: callFor('cc_2').id,
  status: 'no_answer',
  now: new Date('2026-09-12T10:00:00Z'),
});
equal(missed.settled, true);
equal(contactRow('cc_2').status, 'retry');
equal(contactRow('cc_2').outcome, 'no_answer');
equal(
  contactRow('cc_2').next_attempt_at,
  '2026-09-12T12:00:00.000Z',
  'two hours, which is what the campaign form was told and nothing had ever read',
);
equal(campaignRow().connected, 1, 'an unanswered call is not a connection');

// --- the retry, and the end of retries ---------------------------------------------

// Due again. The contact is dialled a second time and the ladder moves to its
// second rung, a day.
sqlite
  .prepare(
    "UPDATE campaign_contacts SET next_attempt_at = '2026-01-01T00:00:00.000Z' WHERE id = 'cc_2'",
  )
  .run();
const retryPass = await dialer.dialCampaign(ORG, CAMP);
equal(retryPass.attempted, 1, 'the retry is a real dial');
equal(contactRow('cc_2').attempt_count, 2);
const secondMiss = await settlement.settleCampaignContactForCall(db, {
  callId: callFor('cc_2').id,
  status: 'busy',
  now: new Date('2026-09-13T10:00:00Z'),
});
equal(secondMiss.settled, true);
equal(
  contactRow('cc_2').next_attempt_at,
  '2026-09-14T10:00:00.000Z',
  'the second rung is a day, not the first rung again',
);

// Third attempt, and the policy says three. Nobody is called a fourth time.
sqlite
  .prepare(
    "UPDATE campaign_contacts SET next_attempt_at = '2026-01-01T00:00:00.000Z' WHERE id = 'cc_2'",
  )
  .run();
await dialer.dialCampaign(ORG, CAMP);
equal(contactRow('cc_2').attempt_count, 3);
const lastMiss = await settlement.settleCampaignContactForCall(db, {
  callId: callFor('cc_2').id,
  status: 'no_answer',
  now: new Date('2026-09-14T10:00:00Z'),
});
equal(
  contactRow('cc_2').status,
  'exhausted',
  'three attempts is three attempts',
);
equal(contactRow('cc_2').outcome, 'max_attempts_reached');
equal(lastMiss.nextAttemptAt, null, 'and there is no fourth');

// With nobody left dialling or due, the campaign ends.
const finishing = await dialer.dialCampaign(ORG, CAMP);
equal(
  finishing.status,
  'completed',
  'the campaign ends rather than looping for ever',
);

// --- a carrier that says no --------------------------------------------------------

sqlite
  .prepare('UPDATE campaigns SET status = ? WHERE id = ?')
  .run('running', CAMP);
addContact('cc_6');
carrierRefuses = 'The telephony account has no balance left.';
const refused = await dialer.dialCampaign(ORG, CAMP);
carrierRefuses = null;
equal(
  refused.attempted,
  0,
  'a call the carrier refused is not an attempt that reached anyone',
);
equal(
  campaignRow().attempted,
  4,
  'and the campaign total counts only the four it placed',
);
equal(callFor('cc_6').status, 'failed');
ok(
  callFor('cc_6').disconnect_reason.includes('balance'),
  'the reason the carrier gave is kept',
);
// The contact must not be stranded: no webhook is coming for a call that was
// never placed, so the failure settles it here.
equal(
  contactRow('cc_6').status,
  'retry',
  'and the contact is retried rather than left ringing for ever',
);

// --- a webhook that never comes ----------------------------------------------------

sqlite
  .prepare('UPDATE campaigns SET status = ? WHERE id = ?')
  .run('running', CAMP);
addContact('cc_7');
const stranded = await dialer.dialCampaign(ORG, CAMP);
equal(stranded.attempted, 1);
equal(contactRow('cc_7').status, 'dialing');
// Nothing tells it how that call ended. Without the sweep the contact stays
// here for ever and the audience simply stops shrinking.
sqlite
  .prepare(
    "UPDATE call_records SET started_at = '2026-09-12T00:00:00.000Z' WHERE campaign_contact_id = 'cc_7'",
  )
  .run();
const swept = await settlement.reconcileDialingContacts(
  db,
  ORG,
  90,
  new Date('2026-09-12T06:00:00Z'),
);
equal(swept.reconciled, 1, 'the sweep rescues the contact');
equal(
  contactRow('cc_7').status,
  'retry',
  'a call nobody reported did not reach anybody',
);

// --- the gates that were already right ---------------------------------------------

sqlite
  .prepare('UPDATE campaigns SET status = ? WHERE id = ?')
  .run('running', CAMP);
addContact('cc_3', { consent: 'pending' });
addContact('cc_4', { phone: '+919800000099' });
sqlite
  .prepare(
    `INSERT INTO suppression_entries (id, organization_id, phone_hash, scope) VALUES (?,?,?,?)`,
  )
  .run('sup_1', ORG, 'hash:+919800000099', 'organization');
const gated = await dialer.dialCampaign(ORG, CAMP);
equal(gated.skipped.no_consent, 1);
equal(gated.skipped.suppressed, 1);
// By destination rather than by count, because this same pass legitimately
// redials cc_7 — the sweep above put it back in the queue and its two hours
// are long past. Counting would have hidden which number was called.
const called = dialled.map((call) => call.destination);
ok(
  !called.includes('+91980000003'),
  'a contact who never consented is not called',
);
ok(
  !called.includes('+919800000099'),
  'and a suppressed number is not called, however it got into the audience',
);

// No gateway configured at all: nothing is connected, and nothing is dialled.
sqlite
  .prepare('UPDATE campaigns SET status = ? WHERE id = ?')
  .run('running', CAMP);
process.env.VOICE_STREAM_URL = '';
addContact('cc_5');
const unconfigured = await dialer.dialCampaign(ORG, CAMP);
equal(unconfigured.skipped.telephony_unconfigured, 1);
equal(contactRow('cc_5').outcome, 'telephony_unconfigured');
equal(unconfigured.attempted, 0);
process.env.VOICE_STREAM_URL = 'wss://gateway.example.com/stream';

// A campaign with no agent has nobody on this end. It must not ring anyone.
sqlite
  .prepare('UPDATE campaigns SET status = ?, agent_id = NULL WHERE id = ?')
  .run('running', CAMP);
sqlite
  .prepare(
    "UPDATE campaign_contacts SET status = 'pending', next_attempt_at = NULL WHERE id = 'cc_5'",
  )
  .run();
const agentless = await dialer.dialCampaign(ORG, CAMP);
equal(agentless.reason, 'no_agent_assigned');
equal(agentless.attempted, 0, 'and nobody is rung into silence');

ok(
  jobs.every((job) => job.type === 'campaign.dial'),
  'the only thing a pass sends anywhere is its own next pass',
);

sqlite.close();
console.log(
  `campaign dialer: ${checks} assertions passed; no provider contacted, no call placed.`,
);
