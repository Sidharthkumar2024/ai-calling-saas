import assert from 'node:assert/strict';

import {
  DISCOVERY_QUESTIONS,
  MIN_SAMPLE,
  confidenceFor,
  discoveryState,
  insufficientData,
  observe,
  rankRecommendations,
  recommend,
} from '../lib/growth-manager.ts';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

console.log('discovery');

check('every question explains why it is asked', () => {
  // A question whose answer nothing reads is a form field wearing an
  // interview's clothes.
  for (const q of DISCOVERY_QUESTIONS) {
    assert.ok(q.id && q.question && q.purpose, q.id);
  }
});

check(
  'an empty interview is at zero and asks a required question first',
  () => {
    const state = discoveryState({});
    assert.equal(state.progress, 0);
    assert.equal(state.complete, false);
    assert.equal(state.nextQuestion.required, true);
  },
);

check('progress counts only required questions', () => {
  const optional = DISCOVERY_QUESTIONS.find((q) => !q.required);
  const state = discoveryState({ [optional.id]: 'something' });
  assert.equal(state.progress, 0);
  assert.ok(state.answered.includes(optional.id));
});

check('a one-character answer does not count as answered', () => {
  const required = DISCOVERY_QUESTIONS.find((q) => q.required);
  assert.equal(discoveryState({ [required.id]: 'x' }).progress, 0);
  assert.equal(discoveryState({ [required.id]: '   ' }).progress, 0);
});

check('answering everything required completes it', () => {
  const answers = {};
  for (const q of DISCOVERY_QUESTIONS.filter((x) => x.required))
    answers[q.id] = 'a real answer';
  const state = discoveryState(answers);
  assert.equal(state.complete, true);
  assert.equal(state.progress, 1);
  // Optional questions remain, so there is still something to ask.
  assert.equal(state.nextQuestion.required, false);
});

check('a completed interview eventually has nothing left to ask', () => {
  const answers = {};
  for (const q of DISCOVERY_QUESTIONS) answers[q.id] = 'a real answer';
  assert.equal(discoveryState(answers).nextQuestion, null);
});

console.log('confidence and observation');

check('confidence is sample size, honestly', () => {
  // A conversion rate from nine calls is a conversion rate from nine calls
  // however cleverly it is computed.
  assert.equal(confidenceFor(9), 'low');
  assert.equal(confidenceFor(30), 'medium');
  assert.equal(confidenceFor(99), 'medium');
  assert.equal(confidenceFor(100), 'high');
  assert.equal(confidenceFor(0), 'low');
  assert.equal(confidenceFor(Number.NaN), 'low');
});

const obs = (over = {}) =>
  observe({
    id: 'o1',
    statement: 'x',
    source: 'calls',
    metric: { label: 'Conversion', value: 12 },
    sampleSize: 50,
    ...over,
  });

check('an observation carries its number, source and sample', () => {
  const o = obs();
  assert.equal(o.metric.value, 12);
  assert.equal(o.source, 'calls');
  assert.equal(o.sampleSize, 50);
  assert.equal(o.confidence, 'medium');
});

check('too little data produces no observation at all', () => {
  // Not a greyed-out claim: grey text still gets read, quoted and acted on.
  assert.equal(obs({ sampleSize: MIN_SAMPLE - 1 }), null);
  assert.equal(obs({ sampleSize: 0 }), null);
});

check('a number that is not a number is refused', () => {
  assert.equal(obs({ metric: { label: 'x', value: Number.NaN } }), null);
  assert.equal(obs({ metric: { label: 'x', value: 'lots' } }), null);
});

console.log('recommendations');

check('a recommendation cannot exist without evidence', () => {
  // The structural rule of the whole module.
  assert.equal(
    recommend({
      id: 'r1',
      title: 'Improve your follow-up cadence',
      action: 'Do better',
      area: 'follow_up',
      evidence: [],
      priority: 90,
    }),
    null,
  );
  assert.equal(
    recommend({
      id: 'r1',
      title: 'x',
      action: 'y',
      area: 'conversion',
      evidence: [null, null],
      priority: 50,
    }),
    null,
  );
});

check('it cites the observations it rests on', () => {
  const a = obs({ id: 'conv' });
  const b = obs({ id: 'refuse' });
  const r = recommend({
    id: 'r1',
    title: 'x',
    action: 'y',
    area: 'conversion',
    evidence: [a, b],
    priority: 50,
  });
  assert.deepEqual(r.evidence, ['conv', 'refuse']);
});

check('advice is only as confident as its weakest evidence', () => {
  // Advice built on one solid number and one shaky one is shaky advice — not
  // the average, and certainly not the best of the two.
  const strong = obs({ id: 'a', sampleSize: 500 });
  const weak = obs({ id: 'b', sampleSize: 6 });
  const r = recommend({
    id: 'r1',
    title: 'x',
    action: 'y',
    area: 'conversion',
    evidence: [strong, weak],
    priority: 50,
  });
  assert.equal(strong.confidence, 'high');
  assert.equal(r.confidence, 'low');
});

check('confidence outranks priority in the plan', () => {
  const solid = obs({ id: 'solid', sampleSize: 500 });
  const shaky = obs({ id: 'shaky', sampleSize: 6 });
  const plan = rankRecommendations(
    [
      recommend({
        id: 'guess',
        title: 'urgent guess',
        action: 'a',
        area: 'cost',
        evidence: [shaky],
        priority: 99,
      }),
      recommend({
        id: 'known',
        title: 'solid finding',
        action: 'b',
        area: 'conversion',
        evidence: [solid],
        priority: 40,
      }),
    ],
    [solid, shaky],
  );
  // A high-confidence, moderately important finding is better advice than a
  // guess about something important.
  assert.equal(plan[0].id, 'known');
});

check('within the same confidence, more evidence wins', () => {
  const a = obs({ id: 'a', sampleSize: 40 });
  const b = obs({ id: 'b', sampleSize: 90 });
  const plan = rankRecommendations(
    [
      recommend({
        id: 'thin',
        title: 't',
        action: 'a',
        area: 'cost',
        evidence: [a],
        priority: 50,
      }),
      recommend({
        id: 'thick',
        title: 'k',
        action: 'b',
        area: 'cost',
        evidence: [b],
        priority: 50,
      }),
    ],
    [a, b],
  );
  assert.equal(plan[0].id, 'thick');
});

check('nulls are dropped from the plan rather than rendered', () => {
  assert.deepEqual(rankRecommendations([null, null], []), []);
});

console.log('insufficientData');

check('a new workspace is told what would fill the board', () => {
  // §6 promises a growth plan; a workspace two days old cannot have one, and
  // filler dressed as insight is worse than saying so.
  const message = insufficientData({ calls: 1, leads: 0 });
  assert.match(message, /Not enough/);
  assert.match(message, /more calls or leads/);
});

check('enough of either kind silences it', () => {
  assert.equal(insufficientData({ calls: MIN_SAMPLE, leads: 0 }), null);
  assert.equal(insufficientData({ calls: 0, leads: MIN_SAMPLE }), null);
});

console.log(`\n${passed} assertions passed.`);
