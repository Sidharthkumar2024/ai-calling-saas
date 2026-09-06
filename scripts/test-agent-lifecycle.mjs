import assert from 'node:assert/strict';

import {
  AGENT_STATES,
  allowedTransitions,
  canTransition,
  cloneName,
  describeRollback,
  diffVersions,
  isAgentState,
  LIVE_STATE,
  MIN_PROMPT_LENGTH,
  publishReadiness,
  VERSIONED_FIELDS,
  agentRemoval,
  AGENT_REFERENCE_LABELS,
} from '../lib/agent-lifecycle.ts';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

console.log('states');

check('the six §2.1 states exist, and "active" is the live one', () => {
  // Kept as `active` rather than renamed to `published`: every query that
  // decides whether an agent may take a call filters on it, and a rename that
  // misses one is an agent still answering after it was archived.
  assert.equal(AGENT_STATES.length, 6);
  assert.equal(LIVE_STATE, 'active');
  assert.ok(AGENT_STATES.includes('active'));
});

check('an unknown state is not a state', () => {
  assert.equal(isAgentState('published'), false);
  assert.equal(isAgentState('active'), true);
});

check('a draft has to be tested before it can be ready', () => {
  assert.equal(canTransition('draft', 'ready'), false);
  assert.equal(canTransition('draft', 'testing'), true);
  assert.equal(canTransition('testing', 'ready'), true);
});

check('nothing reaches live except from ready or paused', () => {
  const toLive = AGENT_STATES.filter((state) => canTransition(state, 'active'));
  assert.deepEqual(toLive, ['ready', 'paused']);
});

check('an archived agent cannot go straight back to answering customers', () => {
  // It has to be reopened and looked at first.
  assert.deepEqual(allowedTransitions('archived'), ['draft']);
  assert.equal(canTransition('archived', 'active'), false);
});

check('a live agent can be paused or pulled back to draft, not archived outright', () => {
  assert.deepEqual(allowedTransitions('active'), ['paused', 'draft']);
});

console.log('\npublishing is earned, not clicked');

const full = {
  name: 'Sara',
  systemPrompt: 'You are Sara, answering for UrbanNest Realty. Qualify the caller and book a site visit.',
  welcomeMessage: 'Namaste, Sara here.',
  primaryLanguage: 'hi-IN',
  voiceName: 'Vaani Tara',
  tools: ['book_appointment'],
};

check('a complete agent is ready', () => {
  const result = publishReadiness(full);
  assert.equal(result.ready, true);
  assert.deepEqual(result.missing, []);
});

check('each missing piece is named, not just refused', () => {
  const result = publishReadiness({});
  assert.equal(result.ready, false);
  for (const piece of ['a name', 'a system prompt', 'an opening line', 'a language', 'a voice'])
    assert.ok(result.missing.includes(piece), piece);
});

check('a two-word prompt is refused with its own length', () => {
  // The single most common way a published agent goes wrong: it improvises
  // everything, and nobody can see why from the config screen.
  const result = publishReadiness({ ...full, systemPrompt: 'Be helpful' });
  assert.equal(result.ready, false);
  assert.ok(result.missing.some((m) => /not instructions/.test(m)));
  assert.ok(MIN_PROMPT_LENGTH > 10);
});

check('a voice profile counts as a voice', () => {
  const result = publishReadiness({ ...full, voiceName: '', voiceProfileId: 'vp_1' });
  assert.equal(result.ready, true);
});

check('no tools is a warning, not a blocker', () => {
  // An agent that only talks is a legitimate thing to publish; one that
  // cannot book or charge without knowing it is not.
  const result = publishReadiness({ ...full, tools: [] });
  assert.equal(result.ready, true);
  assert.match(result.warnings[0], /cannot book, charge or look anything up/);
});

console.log('\nversions and rollback');

const v1 = {
  name: 'Sara',
  system_prompt: 'Old prompt',
  voice_name: 'Tara',
  tools_json: '["book_appointment"]',
  temperature: 20,
};
const v2 = { ...v1, system_prompt: 'New prompt', voice_name: 'Meera' };

check('a diff names the fields in words a person reads', () => {
  assert.deepEqual(diffVersions(v1, v2), ['system prompt', 'voice']);
});

check('identical versions differ in nothing', () => {
  assert.deepEqual(diffVersions(v1, { ...v1 }), []);
});

check('null and empty and missing all count as the same nothing', () => {
  // Otherwise every rollback claims to change fields nobody touched.
  assert.deepEqual(diffVersions({ name: null }, { name: '' }), []);
  assert.deepEqual(diffVersions({ name: 'x' }, {}), ['name']);
});

check('a number stored as text is not a change', () => {
  assert.deepEqual(diffVersions({ temperature: 20 }, { temperature: '20' }), []);
});

check('every field that changes behaviour is versioned', () => {
  for (const field of ['system_prompt', 'welcome_message', 'tools_json', 'voice_name', 'send_policy_json'])
    assert.ok(VERSIONED_FIELDS.includes(field), field);
});

check('the rollback sentence says what moves, and warns when it is live', () => {
  // "Restore version 3" tells nobody anything; this tells them whether to do
  // it to an agent that is answering calls.
  const line = describeRollback({ version: 3, changed: ['system prompt', 'voice'], isLive: true });
  assert.match(line, /changes: system prompt, voice/);
  assert.match(line, /reaches the next call/);
});

check('and says plainly when a rollback would do nothing', () => {
  const line = describeRollback({ version: 3, changed: [], isLive: false });
  assert.match(line, /identical to what is configured now/);
});

check('a draft rollback does not warn about live calls', () => {
  const line = describeRollback({ version: 2, changed: ['voice'], isLive: false });
  assert.doesNotMatch(line, /next call/);
});

console.log('\ncloning');

check('a copy is obviously the copy', () => {
  assert.equal(cloneName('Sara', []), 'Sara (copy)');
});

check('a second copy does not collide with the first', () => {
  assert.equal(cloneName('Sara', ['Sara (copy)']), 'Sara (copy 2)');
  assert.equal(cloneName('Sara', ['Sara (copy)', 'Sara (copy 2)']), 'Sara (copy 3)');
});

check('cloning a copy does not stack the word', () => {
  // "Sara (copy) (copy)" is how this normally goes wrong.
  assert.equal(cloneName('Sara (copy)', ['Sara (copy)']), 'Sara (copy 2)');
  assert.equal(cloneName('Sara (copy 3)', []), 'Sara (copy)');
});

check('existing names are matched case-insensitively', () => {
  assert.equal(cloneName('Sara', ['sara (COPY)']), 'Sara (copy 2)');
});

check('an empty name still produces something usable', () => {
  assert.equal(cloneName('   ', []), 'Agent (copy)');
});

// An agent created by mistake and never used is clutter; making somebody
// archive it for ever is silly. One that has taken calls is a different thing:
// `call_records.agent_id` is ON DELETE SET NULL, so deleting it would blank the
// agent on every call it handled — the history survives and stops saying who
// did the work.
check('an agent nothing points at can simply be deleted', () => {
  const removal = agentRemoval({});
  assert.equal(removal.deletable, true);
  assert.match(removal.reason, /can be deleted outright/);
  assert.deepEqual(removal.counts, []);
});

check('one that has handled calls is archived instead, and says why', () => {
  const removal = agentRemoval({ calls: 12 });
  assert.equal(removal.deletable, false);
  assert.match(removal.reason, /12 calls still point at this agent/);
  assert.match(removal.reason, /blank the agent on work it actually did/);
  assert.match(removal.reason, /archive it instead/);
});

check('a single reference is named in the singular', () => {
  assert.match(agentRemoval({ campaigns: 1 }).reason, /1 campaign still point/);
});

check('every kind that holds it is listed', () => {
  const removal = agentRemoval({ calls: 3, routes: 1, tests: 2 });
  assert.equal(removal.counts.length, 3);
  assert.match(removal.reason, /3 calls/);
  assert.match(removal.reason, /1 number route/);
  assert.match(removal.reason, /2 playground sessions/);
});

check('a zero count is not a reference', () => {
  assert.equal(agentRemoval({ calls: 0, campaigns: 0 }).deletable, true);
});

check('and rubbish in the counts does not make it undeletable', () => {
  assert.equal(agentRemoval({ calls: Number.NaN }).deletable, true);
  assert.equal(agentRemoval({ calls: -4 }).deletable, true);
});

check('every reference kind has a readable label', () => {
  for (const label of Object.values(AGENT_REFERENCE_LABELS))
    assert.match(label, /^[a-z ]+$/);
});

console.log(`\n${passed} assertions passed.`);
