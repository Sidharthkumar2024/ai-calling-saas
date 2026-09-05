import assert from 'node:assert/strict';

import {
  assignVariant,
  isOpeningStyle,
  MIN_LIFT_POINTS,
  MIN_VARIANT_CALLS,
  OPENING_STYLES,
  readTest,
  scoreCaller,
  STYLE_GUIDANCE,
} from '../lib/campaign-studio.ts';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

console.log('opening styles');

check('the five §2.2 styles exist and each says something different', () => {
  assert.deepEqual([...OPENING_STYLES], ['standard', 'premium', 'consultative', 'short', 'custom']);
  const guidance = OPENING_STYLES.map((style) => STYLE_GUIDANCE[style]);
  assert.equal(new Set(guidance).size, OPENING_STYLES.length);
});

check('an unknown style is not a style', () => {
  assert.equal(isOpeningStyle('aggressive'), false);
  assert.equal(isOpeningStyle('consultative'), true);
});

console.log('\nA/B assignment must not drift');

const AB = [
  { key: 'a', label: 'Opening A', share: 50 },
  { key: 'b', label: 'Opening B', share: 50 },
];

check('the same contact always gets the same opening', () => {
  // A redial that lands on the other variant measures the dialer's retry
  // pattern, not the wording.
  const first = assignVariant('contact_123', AB);
  for (let i = 0; i < 20; i += 1)
    assert.equal(assignVariant('contact_123', AB).key, first.key);
});

check('a 50/50 split is roughly even across many contacts', () => {
  let a = 0;
  for (let i = 0; i < 2000; i += 1)
    if (assignVariant(`c${i}`, AB).key === 'a') a += 1;
  assert.ok(a > 850 && a < 1150, `got ${a}/2000 on A`);
});

check('consecutive phone numbers do not fall into a repeating pattern', () => {
  // The defect this catches: FNV-1a's low bits stay correlated for inputs
  // differing near the end, and phone numbers are allocated in blocks. The
  // split looked even in aggregate while producing "aabbaabbaabb" — every
  // other contact, forever.
  const seq = [];
  for (let i = 0; i < 400; i += 1)
    seq.push(assignVariant(`+9198120${String(i).padStart(5, '0')}`, AB).key);
  for (const period of [2, 3, 4, 5, 6]) {
    const repeats = seq
      .slice(0, 200)
      .every((key, index) => key === seq[index % period]);
    assert.equal(repeats, false, `assignment repeats every ${period}`);
  }
});

check('numbers sharing a repeated suffix still spread', () => {
  // 1111, 2222, 3333… all landed on the same variant before the mixing step.
  const keys = ['1111', '2222', '3333', '4444', '5555', '6666'].map(
    (tail) => assignVariant(`+9198120${tail}`, AB).key,
  );
  assert.equal(new Set(keys).size, 2, `all on one side: ${keys.join('')}`);
});

check('consecutive numbers still split roughly evenly overall', () => {
  let a = 0;
  for (let i = 0; i < 2000; i += 1)
    if (assignVariant(`+9198120${String(i).padStart(5, '0')}`, AB).key === 'a') a += 1;
  assert.ok(a > 850 && a < 1150, `got ${a}/2000 on A`);
});

check('an uneven share is honoured', () => {
  const skewed = [
    { key: 'a', label: 'A', share: 90 },
    { key: 'b', label: 'B', share: 10 },
  ];
  let a = 0;
  for (let i = 0; i < 2000; i += 1) if (assignVariant(`c${i}`, skewed).key === 'a') a += 1;
  assert.ok(a > 1650, `got ${a}/2000 on A`);
});

check('a zero share is never assigned', () => {
  const off = [
    { key: 'a', label: 'A', share: 100 },
    { key: 'b', label: 'B', share: 0 },
  ];
  for (let i = 0; i < 200; i += 1) assert.equal(assignVariant(`c${i}`, off).key, 'a');
});

check('no usable variants is null, not a crash or a default', () => {
  assert.equal(assignVariant('c', []), null);
  assert.equal(assignVariant('c', [{ key: 'a', label: 'A', share: 0 }]), null);
});

console.log('\nand a split with no outcomes is not a result');

const result = (key, calls, conversions) => ({ key, label: `Opening ${key.toUpperCase()}`, calls, conversions });

check('a handful of calls declares no winner, and says how many more are needed', () => {
  // The mistake this exists to prevent: a bar chart of four calls.
  const verdict = readTest([result('a', 3, 2), result('b', 1, 0)]);
  assert.equal(verdict.decided, false);
  assert.equal(verdict.winner, null);
  assert.match(verdict.message, new RegExp(`${MIN_VARIANT_CALLS - 3} more`));
  assert.match(verdict.message, new RegExp(`${MIN_VARIANT_CALLS - 1} more`));
});

check('one variant alone has nothing to compare with', () => {
  assert.match(readTest([result('a', 500, 100)]).message, /nothing to compare/);
});

check('enough calls but a narrow gap is called noise, not a winner', () => {
  const verdict = readTest([result('a', 100, 22), result('b', 100, 20)]);
  assert.equal(verdict.decided, false);
  assert.match(verdict.message, /close enough to be noise/);
  assert.ok(MIN_LIFT_POINTS >= 2);
});

check('a wide gap on enough calls does declare a winner', () => {
  const verdict = readTest([result('a', 100, 30), result('b', 100, 12)]);
  assert.equal(verdict.decided, true);
  assert.equal(verdict.winner, 'a');
  assert.match(verdict.message, /18 points better/);
});

check('and it does not claim the wording caused it', () => {
  // It is a comparison of two openings, not a controlled experiment.
  const verdict = readTest([result('a', 100, 30), result('b', 100, 12)]);
  assert.match(verdict.message, /not proof that the wording caused/);
});

check('rates are always returned, decided or not', () => {
  const verdict = readTest([result('a', 4, 1), result('b', 2, 0)]);
  assert.equal(verdict.rates.length, 2);
  assert.equal(verdict.rates[0].rate, 25);
});

console.log('\nqualification');

const qual = {
  threshold: 10,
  rules: [
    { variable: 'budget', operator: 'at_least', value: '5000000', points: 8 },
    { variable: 'timeline', operator: 'contains', value: 'month', points: 5 },
    { variable: 'city', operator: 'equals', value: 'gurgaon', points: 3 },
    { variable: 'city', operator: 'equals', value: 'overseas', points: 0, disqualifies: true },
  ],
};

check('points add up and the caller qualifies', () => {
  const scored = scoreCaller({
    qualification: qual,
    answers: { budget: '60,00,000', timeline: 'next month', city: 'Gurgaon' },
  });
  assert.equal(scored.score, 16);
  assert.equal(scored.qualified, true);
  assert.equal(scored.disqualified, false);
});

check('below the threshold is not qualified', () => {
  const scored = scoreCaller({ qualification: qual, answers: { city: 'Gurgaon' } });
  assert.equal(scored.score, 3);
  assert.equal(scored.qualified, false);
});

check('a disqualifier beats any score', () => {
  // Somebody outside the service area is not a better prospect for having
  // answered three other questions well.
  const scored = scoreCaller({
    qualification: qual,
    answers: { budget: '90,00,000', timeline: 'this month', city: 'overseas' },
  });
  assert.equal(scored.disqualified, true);
  assert.equal(scored.qualified, false);
  assert.ok(scored.score > qual.threshold);
});

check('every rule that fired is explained, so a score is not a bare number', () => {
  const scored = scoreCaller({ qualification: qual, answers: { city: 'Gurgaon' } });
  assert.match(scored.reasons[0], /city is “gurgaon” — \+3/);
});

check('a question that was never asked is reported, not scored as zero', () => {
  // "We never asked" and "they answered badly" are different facts.
  const scored = scoreCaller({ qualification: qual, answers: { city: 'Gurgaon' } });
  assert.ok(scored.unanswered.includes('budget'));
  assert.ok(scored.unanswered.includes('timeline'));
});

check('an empty answer counts as unanswered', () => {
  const scored = scoreCaller({ qualification: qual, answers: { budget: '   ' } });
  assert.ok(scored.unanswered.includes('budget'));
  assert.equal(scored.score, 0);
});

check('numbers written with commas and words still compare', () => {
  const scored = scoreCaller({
    qualification: { threshold: 1, rules: [qual.rules[0]] },
    answers: { budget: 'about 55,00,000 rupees' },
  });
  assert.equal(scored.score, 8);
});

check('a non-numeric answer to a numeric rule simply does not match', () => {
  const scored = scoreCaller({
    qualification: { threshold: 1, rules: [qual.rules[0]] },
    answers: { budget: 'not sure yet' },
  });
  assert.equal(scored.score, 0);
  assert.equal(scored.unanswered.length, 0);
});

check('negative points are allowed and subtract', () => {
  const scored = scoreCaller({
    qualification: {
      threshold: 0,
      rules: [{ variable: 'intent', operator: 'contains', value: 'just looking', points: -5 }],
    },
    answers: { intent: 'just looking around' },
  });
  assert.equal(scored.score, -5);
});

check('no rules at all qualifies nobody by accident', () => {
  const scored = scoreCaller({ qualification: { threshold: 10, rules: [] }, answers: {} });
  assert.equal(scored.qualified, false);
});

console.log(`\n${passed} assertions passed.`);
