import assert from 'node:assert/strict';

import {
  buildObjectionLibrary,
  findMergeTarget,
  objectionBriefing,
  objectionKey,
  objectionLabel,
  objectionTokens,
  rescoreLead,
} from '../lib/sales-intelligence.ts';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

console.log('rescoreLead');

check('booking an appointment moves a lead up decisively', () => {
  const result = rescoreLead(40, {
    outcome: 'appointment_booked',
    sentiment: 'positive',
  });
  assert.equal(result.previous, 40);
  assert.ok(result.score > 40, 'score must rise');
  assert.equal(result.status, 'won');
  assert.ok(result.reasons.some((r) => r.signal === 'outcome'));
});

check('an explicit refusal is allowed past the bound', () => {
  const result = rescoreLead(80, { outcome: 'not_interested' });
  // -35 exceeds the -25 bound, and is deliberately not clamped: someone saying
  // "do not call me" must not stay a warm lead for two more calls.
  assert.equal(result.score, 45);
  assert.equal(result.status, 'lost');
  assert.match(result.nextAction, /do not call again/i);
});

check('every other outcome is bounded', () => {
  const result = rescoreLead(10, {
    outcome: 'appointment_booked',
    sentiment: 'positive',
    durationSeconds: 300,
  });
  // 28 + 8 + 6 = 42, bounded to 30.
  assert.equal(result.score, 40);
});

check('a bad call cannot bound below -25', () => {
  const result = rescoreLead(90, {
    outcome: 'incomplete',
    sentiment: 'negative',
    durationSeconds: 5,
    objections: ['too expensive', 'not now', 'need to ask my wife'],
  });
  // -4 -12 -6 -6 = -28, bounded to -25.
  assert.equal(result.score, 65);
});

check('the score never leaves 0..100', () => {
  assert.equal(rescoreLead(5, { outcome: 'not_interested' }).score, 0);
  assert.equal(
    rescoreLead(99, { outcome: 'appointment_booked', sentiment: 'positive' })
      .score,
    100,
  );
});

check('a nonsense previous score is coerced, not trusted', () => {
  assert.equal(rescoreLead(Number.NaN, {}).previous, 0);
  assert.equal(rescoreLead(-40, {}).previous, 0);
  assert.equal(rescoreLead(880, {}).previous, 100);
});

check('an unknown outcome contributes nothing rather than guessing', () => {
  const result = rescoreLead(50, { outcome: 'banana' });
  assert.equal(result.score, 50);
  assert.equal(result.reasons.length, 0);
});

check('a long call counts as engagement', () => {
  const long = rescoreLead(50, { durationSeconds: 200 });
  assert.equal(long.delta, 6);
  const turns = rescoreLead(50, { customerTurns: 9 });
  assert.equal(turns.delta, 6);
});

check('a call that ends in seconds costs the lead', () => {
  assert.equal(rescoreLead(50, { durationSeconds: 8 }).delta, -6);
  // No duration at all is unknown, not short.
  assert.equal(rescoreLead(50, { durationSeconds: 0 }).delta, 0);
});

check('objections cost little and are capped', () => {
  assert.equal(rescoreLead(50, { objections: ['a'] }).delta, -2);
  assert.equal(rescoreLead(50, { objections: ['a', 'b'] }).delta, -4);
  // Five objections is an engaged argument, not five times the rejection.
  assert.equal(
    rescoreLead(50, { objections: ['a', 'b', 'c', 'd', 'e'] }).delta,
    -6,
  );
});

check('an objection is worth far less than a refusal', () => {
  const arguing = rescoreLead(60, {
    outcome: 'information_provided',
    objections: ['too expensive', 'competitor is cheaper'],
  });
  const refusing = rescoreLead(60, { outcome: 'not_interested' });
  assert.ok(
    arguing.score > refusing.score + 20,
    'a lead who argues about price must outrank one who refused',
  );
});

check('status thresholds follow the resulting score', () => {
  assert.equal(rescoreLead(70, { outcome: 'resolved' }).status, 'qualified');
  assert.equal(rescoreLead(50, { outcome: 'resolved' }).status, 'nurture');
  assert.equal(rescoreLead(20, { outcome: 'resolved' }).status, 'new');
});

check('every reason carries its own delta so a change is explainable', () => {
  const result = rescoreLead(50, {
    outcome: 'callback_scheduled',
    sentiment: 'negative',
    durationSeconds: 400,
    objections: ['price'],
  });
  const sum = result.reasons.reduce((total, r) => total + r.delta, 0);
  assert.equal(sum, 8 - 12 + 6 - 2);
  assert.equal(result.delta, sum);
});

check('the next action names the objection to prepare for', () => {
  const result = rescoreLead(50, {
    outcome: 'information_provided',
    objections: ['the price is above our budget'],
  });
  assert.match(result.nextAction, /above our budget/);
});

console.log('objectionKey');

check('wording and punctuation collapse to one key', () => {
  const key = objectionKey('Too expensive');
  assert.equal(objectionKey("It's too expensive"), key);
  assert.equal(objectionKey('too expensive!'), key);
  assert.equal(objectionKey('  TOO   EXPENSIVE  '), key);
});

check('reported speech is stripped', () => {
  assert.equal(
    objectionKey('Customer said price is too high'),
    objectionKey('price is too high'),
  );
});

check('Devanagari survives normalisation', () => {
  // The same bug that shredded knowledge search: matras are combining marks,
  // so a class of only letters and digits splits a word at its own vowel sign.
  const key = objectionKey('कीमत बहुत ज़्यादा है');
  assert.ok(key.includes('कीमत'), key);
  assert.ok(key.includes('ज़्यादा'), key);
});

check('an empty or symbol-only objection has no key', () => {
  assert.equal(objectionKey(''), '');
  assert.equal(objectionKey('!!! ???'), '');
  assert.equal(objectionKey(null), '');
});

check('a key that is only a stripped opener keeps the original', () => {
  // "the" alone would strip to nothing; the raw form is better than a lost row.
  assert.equal(objectionKey('the'), 'the');
});

console.log('objectionTokens / findMergeTarget');

const target = (text, ...labels) =>
  findMergeTarget(
    objectionTokens(text),
    labels.map((label) => ({ key: label, tokens: objectionTokens(label) })),
  );

check('noise words are dropped but negations survive', () => {
  assert.deepEqual(objectionTokens('It is too expensive for us'), [
    'expensive',
  ]);
  // "not now" must not become an empty objection that merges with everything.
  assert.deepEqual(objectionTokens('not now'), ['not', 'now']);
});

check('token order does not matter', () => {
  assert.deepEqual(
    objectionTokens('expensive price'),
    objectionTokens('price expensive'),
  );
});

check('a rephrasing merges into the row it belongs to', () => {
  // The live failure this rule was written for: two calls, one objection, two
  // rows, and a count that never reaches two.
  assert.equal(
    target('too expensive', 'price too expensive'),
    'price too expensive',
  );
  assert.equal(target('price is too expensive', 'expensive'), 'expensive');
});

check('an unrelated objection does not merge', () => {
  assert.equal(target('needs spouse discussion', 'price too expensive'), null);
  assert.equal(target('location is far', 'possession date too late'), null);
});

check('a vague one-word row does not swallow specific ones', () => {
  // Over-merging is the failure that hides itself: the library still shows a
  // rising count, of a bucket that means nothing.
  assert.equal(target('price not clear to me', 'price'), null);
  assert.equal(target('price above our budget range', 'price'), null);
});

check('the difference cap is exactly one content word', () => {
  assert.equal(target('expensive', 'price expensive'), 'price expensive');
  assert.equal(target('expensive', 'builder price expensive'), null);
});

check('an objection with no tokens merges with nothing', () => {
  assert.equal(findMergeTarget([], [{ key: 'x', tokens: ['x'] }]), null);
  assert.equal(target('too expensive'), null);
});

check('the first matching row wins, so merging is stable', () => {
  const first = target('expensive', 'price expensive', 'expensive now');
  assert.equal(first, 'price expensive');
});

check('Hindi objections tokenize and merge too', () => {
  assert.ok(objectionTokens('कीमत बहुत ज़्यादा है').includes('कीमत'));
  assert.equal(target('कीमत ज़्यादा', 'कीमत बहुत ज़्यादा है'), 'कीमत बहुत ज़्यादा है');
});

console.log('objectionLabel');

check('a machine identifier is rendered as something a person reads', () => {
  // The extraction model returns snake_case despite being asked for the
  // caller's words, and this label is what the workspace sees and what the
  // agent is briefed with.
  assert.equal(objectionLabel('price_too_high'), 'Price too high');
  assert.equal(
    objectionLabel('needs_spouse_consultation'),
    'Needs spouse consultation',
  );
});

check('ordinary wording is left alone apart from its first letter', () => {
  assert.equal(
    objectionLabel('the price is above our budget'),
    'The price is above our budget',
  );
  assert.equal(objectionLabel('  spaced   out  '), 'Spaced out');
});

check(
  'a label with nothing in it stays empty rather than becoming a blank row',
  () => {
    assert.equal(objectionLabel(''), '');
    assert.equal(objectionLabel('   '), '');
    assert.equal(objectionLabel(null), '');
  },
);

check('a Devanagari label is not mangled by capitalisation', () => {
  assert.equal(objectionLabel('कीमत ज़्यादा है'), 'कीमत ज़्यादा है');
});

console.log('buildObjectionLibrary');

check('variants merge and count once', () => {
  const library = buildObjectionLibrary([
    'Too expensive',
    "it's too expensive",
    'TOO EXPENSIVE',
    'Need to discuss with family',
  ]);
  assert.equal(library.length, 2);
  assert.equal(library[0].count, 3);
  assert.equal(library[1].count, 1);
});

check('the label is the most common raw wording, not the key', () => {
  const library = buildObjectionLibrary([
    "It's too expensive",
    "It's too expensive",
    'too expensive',
  ]);
  assert.equal(library[0].objection, "It's too expensive");
  assert.notEqual(library[0].objection, library[0].key);
});

check('unusable entries are dropped rather than counted as blanks', () => {
  const library = buildObjectionLibrary(['', '   ', '???', 'real objection']);
  assert.equal(library.length, 1);
  assert.equal(library[0].count, 1);
});

check('the library is ranked and limited', () => {
  const raw = [];
  for (let i = 0; i < 12; i += 1)
    for (let n = 0; n <= i; n += 1) raw.push(`objection ${i}`);
  const library = buildObjectionLibrary(raw, 3);
  assert.equal(library.length, 3);
  assert.equal(library[0].objection, 'Objection 11');
  assert.ok(library[0].count > library[1].count);
});

console.log('objectionBriefing');

check('a workspace has no playbook until it has heard something twice', () => {
  assert.equal(objectionBriefing([]), '');
  assert.equal(
    objectionBriefing([{ objection: 'too expensive', count: 1 }]),
    '',
  );
});

check('a repeated objection is briefed without a suggested answer', () => {
  const text = objectionBriefing([{ objection: 'too expensive', count: 4 }]);
  assert.ok(text.includes('too expensive'));
  assert.ok(text.includes('approved_response="none"'));
  assert.ok(!text.includes('<approved_response>'));
});

check('a one-off with an approved answer is briefed anyway', () => {
  // The whole point of writing a rebuttal is that it gets used.
  const text = objectionBriefing([
    {
      objection: 'is this a scam',
      count: 1,
      rebuttal: 'We are RERA registered.',
    },
  ]);
  assert.ok(text.includes('<approved_response>We are RERA registered.'));
});

check('the model is told never to invent commercial terms', () => {
  const text = objectionBriefing([{ objection: 'too expensive', count: 9 }]);
  assert.match(text, /never invent a discount/i);
});

check('the briefing is limited so it cannot crowd out the prompt', () => {
  const library = Array.from({ length: 20 }, (_, i) => ({
    objection: `objection ${i}`,
    count: 20 - i,
  }));
  const text = objectionBriefing(library, 3);
  assert.equal(text.split('<objection ').length - 1, 3);
});

check('a blank rebuttal is treated as no rebuttal', () => {
  const text = objectionBriefing([
    { objection: 'once only', count: 1, rebuttal: '   ' },
  ]);
  // It still qualifies for inclusion (a rebuttal row exists) but must not emit
  // an empty approved_response the model would read as an approved silence.
  assert.ok(text.includes('approved_response="none"'));
});

console.log(`\n${passed} assertions passed.`);
