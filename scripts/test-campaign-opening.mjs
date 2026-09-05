import assert from 'node:assert/strict';

import {
  buildOpening,
  DEFAULT_OPENING,
  isOpeningMode,
  OPENING_MODES,
  openingProblems,
  parseOpening,
  previewOpening,
} from '../lib/campaign-opening.ts';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

const build = (config, lead) =>
  buildOpening({
    config: { ...DEFAULT_OPENING, ...config },
    businessName: 'UrbanNest Realty',
    agentName: 'Sara',
    lead,
  });

console.log('the four §19 personalisations');

check('company names the business', () => {
  const opening = build({ mode: 'company' });
  assert.match(opening.text, /this is Sara calling from UrbanNest Realty/);
  assert.equal(opening.degraded, false);
});

check('team names the team inside the business', () => {
  const opening = build({ mode: 'team', team: 'admissions' });
  assert.match(opening.text, /from the admissions team at UrbanNest Realty/);
});

check('executive calls on somebody’s behalf', () => {
  const opening = build({ mode: 'executive', executive: 'Mr Rana' });
  assert.match(opening.text, /on behalf of Mr Rana at UrbanNest Realty/);
});

check('customer greets the lead by name and what they asked about', () => {
  const opening = build(
    { mode: 'customer' },
    { name: 'Priya', productInterest: 'the 3 BHK' },
  );
  assert.match(opening.text, /Hello Priya, this is Sara calling from UrbanNest Realty about the 3 BHK\./);
  assert.equal(opening.degraded, false);
});

check('the default leaves the agent’s own welcome alone', () => {
  const opening = build({ mode: 'agent_default' });
  assert.equal(opening.text, null);
  assert.equal(opening.usedMode, 'agent_default');
});

console.log('\nthe hole is the whole risk');

check('a lead with no name does NOT get "Hello , this is"', () => {
  // The default outcome of any template system that trusts its data, and the
  // thing an actual person would hear.
  const opening = build({ mode: 'customer' }, { name: '', productInterest: 'a flat' });
  assert.doesNotMatch(opening.text, /Hello ,/);
  assert.doesNotMatch(opening.text, /\{\{/);
  assert.equal(opening.usedMode, 'company');
  assert.equal(opening.degraded, true);
  assert.deepEqual(opening.missing, ['lead name']);
});

check('no lead row at all degrades the same way', () => {
  const opening = build({ mode: 'customer' }, null);
  assert.equal(opening.usedMode, 'company');
  assert.equal(opening.degraded, true);
});

check('a name with no interest simply does not mention one', () => {
  // Not "about ." — the clause is dropped, and the omission is reported.
  const opening = build({ mode: 'customer' }, { name: 'Priya' });
  assert.equal(opening.text, 'Hello Priya, this is Sara calling from UrbanNest Realty.');
  assert.deepEqual(opening.missing, ['product interest']);
  assert.equal(opening.degraded, false);
});

check('team mode with no team falls back rather than saying "the  team"', () => {
  const opening = build({ mode: 'team', team: '' });
  assert.doesNotMatch(opening.text, /the\s+team/);
  assert.equal(opening.usedMode, 'company');
  assert.equal(opening.degraded, true);
});

check('executive mode with no executive falls back too', () => {
  const opening = build({ mode: 'executive', executive: '   ' });
  assert.doesNotMatch(opening.text, /on behalf of/);
  assert.equal(opening.degraded, true);
});

check('degrading is reported, not silent', () => {
  // A campaign that falls back for every contact should be visible, not
  // assumed to be working.
  assert.equal(build({ mode: 'customer' }, {}).degraded, true);
  assert.equal(build({ mode: 'company' }).degraded, false);
});

console.log('\nthe reason, and tidying what people type');

check('a reason joins the sentence instead of trailing after the full stop', () => {
  // Appended the other way it came out as "…from UrbanNest Realty. about your
  // recent enquiry." — a lowercase fragment on its own, which is what a caller
  // would actually have heard.
  const opening = build({ mode: 'company', reason: 'about your recent enquiry' });
  assert.equal(
    opening.text,
    'Hello, this is Sara calling from UrbanNest Realty, about your recent enquiry.',
  );
});

check('a reason replaces the recorded interest rather than saying "about" twice', () => {
  const opening = build(
    { mode: 'customer', reason: 'about your site visit' },
    { name: 'Rahul', productInterest: 'the 3 BHK' },
  );
  assert.equal(
    opening.text,
    'Hello Rahul, this is Sara calling from UrbanNest Realty, about your site visit.',
  );
  assert.equal((opening.text.match(/about/g) ?? []).length, 1);
});

check('a reason already ending in a full stop does not get two', () => {
  const opening = build({ mode: 'company', reason: 'about your enquiry.' });
  assert.doesNotMatch(opening.text, /\.\./);
});

check('"the sales team" typed into the team field does not become "the the sales team team"', () => {
  const opening = build({ mode: 'team', team: 'the sales team' });
  assert.match(opening.text, /from the sales team at/);
  assert.doesNotMatch(opening.text, /the the/);
  assert.doesNotMatch(opening.text, /team team/);
});

check('no reason means no trailing space or stray stop', () => {
  const opening = build({ mode: 'company' });
  assert.equal(opening.text.endsWith('Realty.'), true);
});

console.log('\nchecked when saved, not at dial time');

check('team mode without a team cannot be saved', () => {
  // Discovering this when four hundred calls are already going out is too late.
  const problems = openingProblems({ ...DEFAULT_OPENING, mode: 'team' });
  assert.equal(problems[0].field, 'team');
});

check('executive mode without a name cannot be saved', () => {
  assert.equal(openingProblems({ ...DEFAULT_OPENING, mode: 'executive' })[0].field, 'executive');
});

check('customer mode saves fine — the data is per contact, not per campaign', () => {
  assert.deepEqual(openingProblems({ ...DEFAULT_OPENING, mode: 'customer' }), []);
  assert.deepEqual(openingProblems({ ...DEFAULT_OPENING, mode: 'company' }), []);
});

console.log('\nparsing and preview');

check('an unknown mode falls back to the agent default', () => {
  assert.equal(parseOpening({ mode: 'telepathy' }).mode, 'agent_default');
  assert.equal(parseOpening(null).mode, 'agent_default');
  assert.equal(parseOpening('nope').mode, 'agent_default');
});

check('every mode is a known mode', () => {
  for (const mode of OPENING_MODES) assert.equal(isOpeningMode(mode), true);
  assert.equal(isOpeningMode('customer '), false);
});

check('text fields are bounded', () => {
  assert.equal(parseOpening({ mode: 'team', team: 'x'.repeat(500) }).team.length, 60);
});

check('the preview shows what a real contact would hear', () => {
  const preview = previewOpening({
    config: { ...DEFAULT_OPENING, mode: 'customer' },
    businessName: 'UrbanNest Realty',
    agentName: 'Sara',
  });
  assert.match(preview.text, /Hello Priya/);
  assert.equal(preview.degraded, false);
});

console.log(`\n${passed} assertions passed.`);
