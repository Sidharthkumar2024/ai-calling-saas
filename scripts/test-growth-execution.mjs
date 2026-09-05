import assert from 'node:assert/strict';

import {
  actionSummary,
  alreadyDone,
  HOT_LEAD_THRESHOLD,
  offersFor,
} from '../lib/growth-execution.ts';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

const context = (overrides = {}) => ({
  hotLeadCount: 12,
  hotLeadsWithConsent: 12,
  hotLeadThreshold: HOT_LEAD_THRESHOLD,
  agentCount: 2,
  topObjection: 'too expensive',
  negativeCallCount: 7,
  assignableCount: 4,
  ...overrides,
});

const hotLeads = { id: 'work_hot_leads', title: '12 leads are scoring hot and waiting' };
const objection = { id: 'answer_objection', title: 'Your most common objection has no approved answer' };
const sentiment = { id: 'sentiment_review', title: 'More calls than usual are ending badly' };
const transfers = { id: 'reduce_transfers', title: 'A quarter of calls are reaching a person' };

console.log('offers say what they will do, in this workspace’s numbers');

check('the campaign offer names the exact number of leads and the threshold', () => {
  const [campaign] = offersFor(hotLeads, context());
  assert.equal(campaign.kind, 'campaign');
  assert.match(campaign.effect, /12 leads/);
  assert.match(campaign.effect, /75 or above/);
});

check('and says it will not start dialling', () => {
  const [campaign] = offersFor(hotLeads, context());
  assert.match(campaign.effect, /does not start dialling/);
});

check('one lead reads as one lead, not "1 leads"', () => {
  const [campaign] = offersFor(hotLeads, context({ hotLeadCount: 1, hotLeadsWithConsent: 1 }));
  assert.match(campaign.effect, /1 lead scoring/);
});

check('the consent gap is in the offer, not discovered afterwards', () => {
  // The dialer refuses a contact with no consent, so learning this after the
  // campaign exists is learning it too late.
  const [none] = offersFor(hotLeads, context({ hotLeadsWithConsent: 0 }));
  assert.match(none.effect, /None of them has consent on record/);
  const [some] = offersFor(hotLeads, context({ hotLeadsWithConsent: 4 }));
  assert.match(some.effect, /4 of them has consent on record/);
  const [all] = offersFor(hotLeads, context());
  assert.doesNotMatch(all.effect, /consent on record/);
});

check('the objection task quotes the caller’s own words', () => {
  const [task] = offersFor(objection, context());
  assert.equal(task.kind, 'task');
  assert.match(task.effect, /too expensive/);
});

check('with no objection recorded it does not invent one', () => {
  const [task] = offersFor(objection, context({ topObjection: null }));
  assert.doesNotMatch(task.effect, /“/);
  assert.match(task.effect, /most common objection/);
});

console.log('\nan offer that cannot be done is refused in words, not hidden');

check('no hot leads blocks the campaign and says why', () => {
  const offers = offersFor(hotLeads, context({ hotLeadCount: 0, hotLeadsWithConsent: 0 }));
  const campaign = offers.find((offer) => offer.kind === 'campaign');
  // Still offered, so the screen can explain itself.
  assert.ok(campaign);
  assert.match(campaign.blockedBy, /No lead is scoring 75/);
});

check('no agent blocks the campaign for a different reason', () => {
  const offers = offersFor(hotLeads, context({ agentCount: 0 }));
  const campaign = offers.find((offer) => offer.kind === 'campaign');
  assert.match(campaign.blockedBy, /No agent is configured/);
});

check('an empty audience outranks a missing agent — the first thing to fix comes first', () => {
  const offers = offersFor(
    hotLeads,
    context({ hotLeadCount: 0, hotLeadsWithConsent: 0, agentCount: 0 }),
  );
  const campaign = offers.find((offer) => offer.kind === 'campaign');
  assert.match(campaign.blockedBy, /No lead is scoring/);
});

check('a workspace with nobody in it cannot be assigned a task', () => {
  const offers = offersFor(transfers, context({ assignableCount: 0 }));
  const task = offers.find((offer) => offer.kind === 'task');
  assert.match(task.blockedBy, /nobody in this workspace/);
});

check('a sentiment review with no calls left in the window is blocked', () => {
  const offers = offersFor(sentiment, context({ negativeCallCount: 0 }));
  assert.match(offers[0].blockedBy, /no longer in the window/);
});

check('everything else is unblocked', () => {
  for (const offer of offersFor(hotLeads, context()))
    assert.equal(offer.blockedBy, null, offer.id);
});

console.log('\nwhich offers exist at all');

check('a campaign is only offered where the evidence is a set of rows to dial', () => {
  // Otherwise "create a campaign" would mean "create an empty campaign".
  for (const recommendation of [objection, sentiment, transfers])
    assert.equal(
      offersFor(recommendation, context()).some((offer) => offer.kind === 'campaign'),
      false,
      recommendation.id,
    );
});

check('every recommendation can be given to a person', () => {
  for (const recommendation of [hotLeads, objection, sentiment, transfers])
    assert.ok(
      offersFor(recommendation, context()).some((offer) => offer.kind === 'task'),
      recommendation.id,
    );
});

check('a recommendation with its own task does not also get the generic one', () => {
  const tasks = offersFor(objection, context()).filter((offer) => offer.kind === 'task');
  assert.equal(tasks.length, 1);
});

check('offer ids are stable per recommendation and kind', () => {
  const first = offersFor(hotLeads, context());
  const second = offersFor(hotLeads, context({ hotLeadCount: 3 }));
  assert.deepEqual(first.map((offer) => offer.id), second.map((offer) => offer.id));
  assert.equal(first[0].id, 'work_hot_leads:campaign');
});

console.log('\nwhat was already done');

const action = (overrides = {}) => ({
  id: 'a1',
  recommendationId: 'work_hot_leads',
  kind: 'campaign',
  title: 'x',
  detail: 'y',
  status: 'open',
  targetType: 'campaign',
  targetId: 'campaign_1',
  createdAt: '2026-09-05',
  completedAt: null,
  ...overrides,
});

check('an open action marks its offer as done', () => {
  const offers = offersFor(hotLeads, context());
  assert.ok(alreadyDone(offers, [action()]).has('work_hot_leads:campaign'));
});

check('a dropped action does not — the offer comes back', () => {
  const offers = offersFor(hotLeads, context());
  assert.equal(alreadyDone(offers, [action({ status: 'dropped' })]).size, 0);
});

check('an action on another recommendation does not mark this one', () => {
  const offers = offersFor(hotLeads, context());
  assert.equal(
    alreadyDone(offers, [action({ recommendationId: 'answer_objection' })]).size,
    0,
  );
});

check('the summary says which kind, and where it got to', () => {
  assert.match(actionSummary(action()), /Campaign created\. Still open\./);
  assert.match(actionSummary(action({ status: 'done' })), /marked done/);
  assert.match(actionSummary(action({ kind: 'workflow' })), /Workflow installed/);
  assert.match(actionSummary(action({ kind: 'task', status: 'dropped' })), /then dropped/);
});

console.log(`\n${passed} assertions passed.`);
