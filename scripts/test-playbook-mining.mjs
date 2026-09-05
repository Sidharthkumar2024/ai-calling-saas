import assert from 'node:assert/strict';

import {
  buildPlaybook,
  contrastPhrases,
  customerVocabulary,
  documentFrequency,
  MIN_COHORT,
  miningConfidence,
  ngrams,
  PLAYBOOK_CAVEAT,
  splitCohorts,
  splitTurns,
  textOf,
  tokenise,
  VOCABULARY_MIN_CALLS,
} from '../lib/playbook-mining.ts';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

const call = (id, outcome, transcript) => ({ id, outcome, transcript });
const many = (n, outcome, transcript) =>
  Array.from({ length: n }, (_, i) => call(`${outcome}${i}`, outcome, transcript));

console.log('cohorts — two piles or no claim');

check('wins and losses are separated by outcome', () => {
  const cohorts = splitCohorts([
    call('a', 'appointment_booked', 'Agent: hello'),
    call('b', 'not_interested', 'Agent: hello'),
  ]);
  assert.equal(cohorts.won.length, 1);
  assert.equal(cohorts.lost.length, 1);
});

check('an ambiguous outcome is excluded, with the reason', () => {
  // Forcing a callback into one pile to make the cohorts bigger would corrupt
  // every contrast drawn from them.
  const cohorts = splitCohorts([call('a', 'callback_scheduled', 'Agent: hi')]);
  assert.equal(cohorts.won.length + cohorts.lost.length, 0);
  assert.equal(cohorts.excluded[0].outcome, 'callback_scheduled');
  assert.match(cohorts.excluded[0].reason, /Neither a win nor a loss/);
});

check('an unrecognised outcome is excluded rather than guessed at', () => {
  const cohorts = splitCohorts([call('a', 'sent_a_pigeon', 'Agent: hi')]);
  assert.match(cohorts.excluded[0].reason, /cannot place on either side|Not an outcome/);
});

check('a call with no transcript is excluded and counted', () => {
  const cohorts = splitCohorts([call('a', 'converted', '   ')]);
  assert.equal(cohorts.won.length, 0);
  assert.match(cohorts.excluded[0].reason, /No transcript/);
});

check('excluded outcomes are grouped with counts, not listed one by one', () => {
  const cohorts = splitCohorts(many(4, 'callback_scheduled', 'Agent: hi'));
  assert.equal(cohorts.excluded.length, 1);
  assert.equal(cohorts.excluded[0].count, 4);
});

console.log('\nthe cohort floor');

check('too few wins blocks the contrast and names the number', () => {
  const cohorts = splitCohorts([
    ...many(MIN_COHORT - 1, 'converted', 'Agent: hi'),
    ...many(40, 'not_interested', 'Agent: hi'),
  ]);
  assert.ok(cohorts.blocked);
  assert.match(cohorts.blocked, new RegExp(String(MIN_COHORT - 1)));
});

check('too few losses blocks it too — for the right reason', () => {
  // Without a comparison group, a phrase common in the wins is just how the
  // agent talks.
  const cohorts = splitCohorts([
    ...many(40, 'converted', 'Agent: hi'),
    ...many(MIN_COHORT - 1, 'not_interested', 'Agent: hi'),
  ]);
  assert.match(cohorts.blocked, /Without a comparison group/);
});

check('enough of both is not blocked', () => {
  const cohorts = splitCohorts([
    ...many(MIN_COHORT, 'converted', 'Agent: hi'),
    ...many(MIN_COHORT, 'not_interested', 'Agent: hi'),
  ]);
  assert.equal(cohorts.blocked, null);
});

console.log('\nreading a transcript');

check('agent and customer turns are kept apart', () => {
  const turns = splitTurns('Agent: hello there\nCustomer: I need a flat\nAgent: which area');
  assert.deepEqual(turns.map((turn) => turn.speaker), ['agent', 'customer', 'agent']);
  assert.equal(textOf('Agent: a\nCustomer: b', 'customer'), 'b');
});

check('a wrapped line stays with whoever was speaking', () => {
  const turns = splitTurns('Customer: I need\na two bedroom flat');
  assert.equal(turns.length, 1);
  assert.match(turns[0].text, /two bedroom/);
});

check('Devanagari survives tokenising — \\w would have thrown it away', () => {
  const tokens = tokenise('नमस्ते, मुझे 2 BHK चाहिए');
  assert.ok(tokens.includes('नमस्ते'));
  assert.ok(tokens.includes('चाहिए'));
  assert.ok(tokens.includes('bhk'));
});

check('a Hindi transcript yields Hindi customer text', () => {
  const text = textOf('Agent: नमस्ते\nCustomer: मुझे फ्लैट चाहिए', 'customer');
  assert.equal(text, 'मुझे फ्लैट चाहिए');
});

check('n-grams and document frequency count documents, not repeats', () => {
  assert.deepEqual(ngrams(['a', 'b', 'c'], 2), ['a b', 'b c']);
  const frequency = documentFrequency([['x', 'x', 'y'], ['x']]);
  assert.equal(frequency.get('x'), 2);
  assert.equal(frequency.get('y'), 1);
});

console.log('\nvocabulary — bounds instead of a stop-word list');

check('a word in nearly every call is not vocabulary', () => {
  // "hello" is in all of them; that is what the upper bound replaces a
  // hand-written stop-word list with, and it works in any script.
  const transcripts = Array.from({ length: 10 }, (_, i) =>
    `Agent: hi\nCustomer: hello hello ${i < 5 ? 'balcony' : 'nothing'}`,
  );
  const vocabulary = customerVocabulary(transcripts);
  assert.equal(vocabulary.some((entry) => entry.term === 'hello'), false);
  assert.ok(vocabulary.some((entry) => entry.term === 'balcony'));
});

check('a word one talkative caller used is not vocabulary either', () => {
  const transcripts = [
    'Customer: mezzanine mezzanine mezzanine',
    ...Array.from({ length: 6 }, () => 'Customer: balcony parking'),
  ];
  const vocabulary = customerVocabulary(transcripts);
  assert.equal(vocabulary.some((entry) => entry.term === 'mezzanine'), false);
});

check('only what customers said counts, not the agent’s own script', () => {
  // The agent says "exclusive" on every call. Counting the whole transcript
  // would rank the agent's own script as the customer's vocabulary.
  const transcripts = Array.from({ length: 10 }, (_, i) =>
    `Agent: exclusive premium offer\nCustomer: ${i < 6 ? 'parking' : 'garden'} please`,
  );
  const vocabulary = customerVocabulary(transcripts);
  assert.equal(vocabulary.some((entry) => entry.term === 'exclusive'), false);
  assert.ok(vocabulary.some((entry) => entry.term === 'parking'));
});

check('too few calls produce no vocabulary at all', () => {
  assert.deepEqual(customerVocabulary(['Customer: one'], 10), []);
  assert.equal(VOCABULARY_MIN_CALLS >= 2, true);
});

console.log('\ncontrast — the counts travel with the claim');

check('a phrase in the wins and not the losses is found, with both counts', () => {
  const won = Array.from({ length: 6 }, () => 'Agent: shall we book a site visit');
  const lost = Array.from({ length: 6 }, () => 'Agent: I will send you a brochure');
  const { winning } = contrastPhrases({ won, lost, speaker: 'agent' });
  const found = winning.find((entry) => entry.phrase.includes('site visit'));
  assert.ok(found);
  assert.equal(found.wonCalls, 6);
  assert.equal(found.lostCalls, 0);
  assert.equal(found.lift, 1);
});

check('a phrase in BOTH piles is not a finding — that is just how the agent talks', () => {
  const shared = 'Agent: thank you for your time today';
  const { winning, losing } = contrastPhrases({
    won: Array.from({ length: 6 }, () => shared),
    lost: Array.from({ length: 6 }, () => shared),
    speaker: 'agent',
  });
  assert.deepEqual(winning, []);
  assert.deepEqual(losing, []);
});

check('what the losing calls say is reported too', () => {
  // That is where the objection you keep failing to answer shows up.
  const { losing } = contrastPhrases({
    won: Array.from({ length: 6 }, () => 'Agent: shall we book a visit'),
    lost: Array.from({ length: 6 }, () => 'Agent: the price is fixed sorry'),
    speaker: 'agent',
  });
  assert.ok(losing.some((entry) => entry.phrase.includes('price is fixed')));
});

check('a longer phrase covering the same calls replaces the shorter one', () => {
  // Otherwise one observation renders as three rows and looks like three
  // pieces of evidence.
  const { winning } = contrastPhrases({
    won: Array.from({ length: 6 }, () => 'Agent: book a site visit today'),
    lost: Array.from({ length: 6 }, () => 'Agent: nothing relevant here'),
    speaker: 'agent',
  });
  const phrases = winning.map((entry) => entry.phrase);
  const redundant = phrases.filter(
    (phrase) => phrases.some((other) => other !== phrase && other.includes(phrase)),
  );
  assert.deepEqual(redundant, []);
});

check('an empty side yields nothing rather than dividing by zero', () => {
  assert.deepEqual(contrastPhrases({ won: [], lost: ['Agent: x'], speaker: 'agent' }), {
    winning: [],
    losing: [],
  });
});

console.log('\nconfidence and the caveat');

check('confidence comes from how many calls were read, not how cleanly they split', () => {
  // 5 of 5 versus 0 of 5 looks perfect and rests on ten conversations.
  assert.equal(miningConfidence(10), 'low');
  assert.equal(miningConfidence(20), 'medium');
  assert.equal(miningConfidence(80), 'high');
});

console.log('\nthe playbook');

check('vocabulary survives even when the contrast is blocked', () => {
  const calls = [
    ...many(3, 'converted', 'Agent: hi\nCustomer: parking balcony'),
    ...many(3, 'not_interested', 'Agent: hi\nCustomer: parking price'),
  ];
  const playbook = buildPlaybook({ calls });
  assert.ok(playbook.blocked);
  assert.ok(playbook.entries.some((entry) => entry.section === 'vocabulary'));
  assert.equal(playbook.entries.some((entry) => entry.section === 'winning_phrase'), false);
});

check('with both cohorts, phrase entries carry their counts in words', () => {
  const playbook = buildPlaybook({
    calls: [
      ...many(6, 'converted', 'Agent: shall we book a site visit\nCustomer: yes'),
      ...many(6, 'not_interested', 'Agent: I will send a brochure\nCustomer: no'),
    ],
  });
  assert.equal(playbook.blocked, null);
  const winning = playbook.entries.find((entry) => entry.section === 'winning_phrase');
  assert.match(winning.evidence, /6 of 6 calls that succeeded/);
  assert.match(winning.evidence, /0 of 6 that did not/);
});

check('objections come through with how often they were raised', () => {
  const playbook = buildPlaybook({
    calls: many(3, 'converted', 'Agent: hi'),
    objections: [{ label: 'too expensive', occurrences: 12 }],
  });
  const objection = playbook.entries.find((entry) => entry.section === 'objection');
  assert.equal(objection.content, 'too expensive');
  assert.match(objection.evidence, /12 calls/);
});

check('the correlation caveat is part of the playbook, not left to be inferred', () => {
  const playbook = buildPlaybook({ calls: many(3, 'converted', 'Agent: hi') });
  assert.equal(playbook.caveat, PLAYBOOK_CAVEAT);
  assert.match(playbook.caveat, /correlation, not a cause/);
});

check('what was left out is reported alongside what was used', () => {
  const playbook = buildPlaybook({
    calls: [
      ...many(6, 'converted', 'Agent: a'),
      ...many(6, 'not_interested', 'Agent: b'),
      ...many(9, 'callback_scheduled', 'Agent: c'),
    ],
  });
  assert.equal(playbook.wonCount, 6);
  assert.equal(playbook.lostCount, 6);
  assert.equal(playbook.excluded.find((e) => e.outcome === 'callback_scheduled').count, 9);
});

console.log(`\n${passed} assertions passed.`);
