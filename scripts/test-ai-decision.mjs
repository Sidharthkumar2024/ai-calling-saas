import assert from 'node:assert/strict';

import {
  TRANSCRIPT_LIMIT,
  decisionMessages,
  decisionSystemPrompt,
  fallbackOutcome,
  readDecision,
  undecidedReason,
} from '../lib/ai-decision.ts';

let checks = 0;
const check = (fn) => {
  fn();
  checks += 1;
};

const OUTCOMES = ['buying', 'renting', 'just looking'];
const read = (said) => readDecision(said, OUTCOMES);

// --- reading the answer ---------------------------------------------------------

check(() => assert.deepEqual(read('buying'), { kind: 'decided', outcome: 'buying' }));
// Forgiving about how it was written.
check(() => assert.deepEqual(read('  Buying  '), { kind: 'decided', outcome: 'buying' }));
check(() => assert.deepEqual(read('"renting"'), { kind: 'decided', outcome: 'renting' }));
check(() => assert.deepEqual(read('renting.'), { kind: 'decided', outcome: 'renting' }));
check(() => assert.deepEqual(read('The answer is buying'), { kind: 'decided', outcome: 'buying' }));
check(() => assert.deepEqual(read('Outcome: renting'), { kind: 'decided', outcome: 'renting' }));
check(() =>
  assert.deepEqual(read('just_looking'), { kind: 'decided', outcome: 'just looking' }),
);
check(() =>
  assert.deepEqual(read('JUST-LOOKING'), { kind: 'decided', outcome: 'just looking' }),
);
// A model that wrapped the outcome in a sentence still named it.
check(() =>
  assert.deepEqual(read('I think they are renting'), {
    kind: 'decided',
    outcome: 'renting',
  }),
);

// Unforgiving about *which*. Routing a customer down a path nobody chose is
// worse than admitting the decision failed.
check(() => assert.equal(read('leasing').kind, 'unreadable'));
check(() => assert.equal(read('').kind, 'unreadable'));
check(() => assert.equal(read(null).kind, 'unreadable'));
check(() => assert.equal(read(42).kind, 'unreadable'));
check(() => assert.equal(read({ outcome: 'buying' }).kind, 'unreadable'));
// A sentence that discussed both is not one answer.
check(() => assert.equal(read('could be buying or renting').kind, 'unreadable'));
check(() => assert.deepEqual(read('UNCLEAR'), { kind: 'unclear' }));
check(() => assert.deepEqual(read('unclear'), { kind: 'unclear' }));
check(() => assert.equal(read('x'.repeat(500)).said.length, 200));
// The first outcome is never a default — that is the defect this replaces.
check(() => assert.notEqual(read('something else').kind, 'decided'));

// --- the fallback the author chose ----------------------------------------------

check(() => assert.equal(fallbackOutcome('renting', OUTCOMES), 'renting'));
check(() => assert.equal(fallbackOutcome('  RENTING ', OUTCOMES), 'renting'));
check(() => assert.equal(fallbackOutcome('just_looking', OUTCOMES), 'just looking'));
// A fallback that is not an exit cannot be taken; the run stops instead.
check(() => assert.equal(fallbackOutcome('escalate', OUTCOMES), null));
check(() => assert.equal(fallbackOutcome('', OUTCOMES), null));
check(() => assert.equal(fallbackOutcome(undefined, OUTCOMES), null));
check(() => assert.equal(fallbackOutcome(null, OUTCOMES), null));

// --- the prompt -----------------------------------------------------------------

check(() => assert.match(decisionSystemPrompt(OUTCOMES), /buying \| renting \| just looking/));
check(() => assert.match(decisionSystemPrompt(OUTCOMES), /UNCLEAR/));

check(() => {
  const [message] = decisionMessages({
    instruction: 'Are they buying or renting?',
    outcomes: OUTCOMES,
    transcript: [
      { from: 'customer', text: 'Do you have 2BHK in Andheri?' },
      { from: 'business', text: 'For purchase or rent?' },
      { from: 'customer', text: 'Rent, for 11 months' },
    ],
  });
  assert.match(message.content, /Customer: Do you have 2BHK/);
  assert.match(message.content, /Business: For purchase or rent\?/);
  assert.match(message.content, /Decide: Are they buying or renting\?/);
});
// A long conversation is trimmed to the end: the recent turns are the ones the
// decision is about.
check(() => {
  const [message] = decisionMessages({
    instruction: 'x',
    outcomes: OUTCOMES,
    transcript: Array.from({ length: 60 }, (_, index) => ({
      from: 'customer',
      text: `line ${index}`,
    })),
  });
  assert.equal(message.content.includes('line 0'), false);
  assert.equal(message.content.includes('line 59'), true);
  assert.equal(
    message.content.split('\n').filter((line) => line.startsWith('Customer:')).length,
    TRANSCRIPT_LIMIT,
  );
});
check(() => {
  const [message] = decisionMessages({
    instruction: 'x',
    outcomes: OUTCOMES,
    transcript: [],
  });
  assert.match(message.content, /\(no messages yet\)/);
});

// --- what a stopped run says -----------------------------------------------------

check(() => assert.match(undecidedReason({ kind: 'unclear' }), /did not clearly indicate/));
check(() =>
  assert.match(undecidedReason({ kind: 'unreadable', said: 'leasing' }), /“leasing”/),
);
check(() => assert.match(undecidedReason({ kind: 'unreadable', said: '' }), /nothing to read/));

console.log(`ai decision: ${checks} assertions passed`);
