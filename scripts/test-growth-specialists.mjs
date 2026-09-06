import assert from 'node:assert/strict';

import {
  hasEvidence,
  parseFindings,
  rankFindings,
  skipReason,
  SPECIALISTS,
  specialistPrompt,
  summariseRun,
} from '../lib/growth-specialists.ts';

let checks = 0;
const check = (fn) => {
  fn();
  checks += 1;
};

const byId = (id) => SPECIALISTS.find((s) => s.id === id);
const emptySlice = {
  observations: [],
  siteFindings: [],
  objections: [],
  missingSources: [],
};

// --- the roster --------------------------------------------------------------

check(() => assert.equal(SPECIALISTS.length, 4));
check(() =>
  assert.deepEqual(
    SPECIALISTS.filter((s) => !s.brief.trim()),
    [],
  ),
);

// --- who has something to read ----------------------------------------------

// RULE 1: no evidence, no lane. Every one of these must be false, or a
// specialist gets asked to comment on nothing and obliges.
check(() =>
  assert.deepEqual(
    SPECIALISTS.filter((s) => hasEvidence(s, emptySlice)).map((s) => s.id),
    [],
  ),
);
check(() =>
  assert.equal(
    hasEvidence(byId('calls'), {
      ...emptySlice,
      observations: [{ source: 'calls', statement: '12% converted', sampleSize: 80 }],
    }),
    true,
  ),
);
// A lead figure is not the calls specialist's evidence.
check(() =>
  assert.equal(
    hasEvidence(byId('calls'), {
      ...emptySlice,
      observations: [{ source: 'leads', statement: '40 leads', sampleSize: 40 }],
    }),
    false,
  ),
);
check(() =>
  assert.equal(
    hasEvidence(byId('pipeline'), {
      ...emptySlice,
      observations: [{ source: 'leads', statement: '40 leads', sampleSize: 40 }],
    }),
    true,
  ),
);
// Objections alone are enough for the calls lane, with no measured figures.
check(() =>
  assert.equal(
    hasEvidence(byId('calls'), {
      ...emptySlice,
      objections: [{ label: 'too expensive', occurrences: 9 }],
    }),
    true,
  ),
);
check(() =>
  assert.equal(
    hasEvidence(byId('website'), {
      ...emptySlice,
      siteFindings: [{ page: '/pricing', title: 'No CTA', severity: 'high' }],
    }),
    true,
  ),
);
check(() =>
  assert.equal(
    hasEvidence(byId('readiness'), {
      ...emptySlice,
      missingSources: ['Google Analytics'],
    }),
    true,
  ),
);
check(() => assert.match(skipReason(byId('website')), /No website scan yet/));
check(() =>
  assert.match(skipReason(byId('readiness')), /Every source .* is connected/),
);

// --- reading what a model returned ------------------------------------------

check(() => {
  const findings = parseFindings(
    'calls',
    JSON.stringify([
      {
        severity: 'high',
        title: 'Price objection stops half the calls',
        evidence: '9 of 18 calls raised price',
        doThis: 'Answer price before the demo ask',
      },
    ]),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].specialist, 'calls');
  assert.equal(findings[0].severity, 'high');
});

// Fenced JSON is the common case, not the exception.
check(() => {
  const findings = parseFindings(
    'website',
    '```json\n[{"severity":"medium","title":"t","evidence":"/pricing has no CTA","doThis":"add one"}]\n```',
  );
  assert.equal(findings.length, 1);
});

// Prose around the array still parses.
check(() => {
  const findings = parseFindings(
    'website',
    'Here is what I found:\n[{"title":"t","evidence":"e"}]\nHope that helps.',
  );
  assert.equal(findings.length, 1);
  // An unstated severity is medium, never high.
  assert.equal(findings[0].severity, 'medium');
});

// RULE 2: a finding with no evidence is dropped, however well it reads.
check(() => {
  const findings = parseFindings(
    'calls',
    JSON.stringify([
      { severity: 'high', title: 'Consider optimising the funnel', doThis: 'do it' },
      { severity: 'low', title: 'kept', evidence: '3 calls' },
    ]),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].title, 'kept');
});

// An object where a string belongs used to stringify to "[object Object]",
// which then passed the evidence check and reached the reader.
check(() => {
  const findings = parseFindings(
    'calls',
    JSON.stringify([{ title: { a: 1 }, evidence: { b: 2 } }]),
  );
  assert.equal(findings.length, 0);
});

check(() => assert.deepEqual(parseFindings('calls', 'no json here'), []));
check(() => assert.deepEqual(parseFindings('calls', '[not valid'), []));
check(() => assert.deepEqual(parseFindings('calls', ''), []));
// An unbounded list is capped rather than trusted.
check(() => {
  const many = Array.from({ length: 20 }, (_, index) => ({
    title: `t${index}`,
    evidence: 'e',
  }));
  assert.equal(parseFindings('calls', JSON.stringify(many)).length, 6);
});

// --- ranking -----------------------------------------------------------------

const finding = (specialist, severity, title) => ({
  specialist,
  severity,
  title,
  evidence: 'e',
  doThis: 'd',
});

// One from each lane before a second from any: straight severity sorting let
// the loudest specialist fill the whole list.
check(() => {
  const ranked = rankFindings([
    finding('website', 'high', 'w1'),
    finding('website', 'high', 'w2'),
    finding('website', 'high', 'w3'),
    finding('calls', 'high', 'c1'),
  ]);
  assert.deepEqual(ranked.slice(0, 2).map((f) => f.specialist).sort(), [
    'calls',
    'website',
  ]);
  assert.equal(ranked.length, 4);
});
check(() => {
  const ranked = rankFindings([
    finding('calls', 'low', 'low one'),
    finding('calls', 'high', 'high one'),
  ]);
  assert.equal(ranked[0].title, 'high one');
});
check(() => assert.deepEqual(rankFindings([]), []));

// --- the line above the list -------------------------------------------------

check(() =>
  assert.match(
    summariseRun({ findings: [], ran: ['calls'], skipped: ['website'] }),
    /nothing worth acting on yet/,
  ),
);
check(() =>
  assert.match(
    summariseRun({
      findings: [finding('calls', 'high', 'x')],
      ran: ['calls', 'website'],
      skipped: [],
    }),
    /1 finding across 2 of 2 lanes, 1 high priority/,
  ),
);

// --- the brief ---------------------------------------------------------------

check(() => {
  const prompt = specialistPrompt(byId('website'), {
    ...emptySlice,
    siteFindings: [{ page: '/pricing', title: 'No CTA', severity: 'high' }],
  });
  assert.match(prompt, /\/pricing/);
  assert.match(prompt, /return \[\]/);
});
// A specialist is never shown another lane's evidence: that is what keeps four
// readings distinct instead of four copies of the loudest fact.
check(() => {
  const prompt = specialistPrompt(byId('calls'), {
    observations: [
      { source: 'calls', statement: 'call figure', sampleSize: 5 },
      { source: 'leads', statement: 'lead figure', sampleSize: 5 },
    ],
    siteFindings: [{ page: '/x', title: 'site thing', severity: 'high' }],
    objections: [],
    missingSources: ['HubSpot'],
  });
  assert.match(prompt, /call figure/);
  assert.doesNotMatch(prompt, /lead figure/);
  assert.doesNotMatch(prompt, /site thing/);
  assert.doesNotMatch(prompt, /HubSpot/);
});

console.log(`growth-specialists: ${checks} assertions passed`);

// --- found nothing, or could not be read -------------------------------------

const { readLane } = await import('../lib/growth-specialists.ts');

check(() => assert.equal(readLane('calls', '[]').status, 'empty'));
check(() => assert.equal(readLane('calls', '```json\n[]\n```').status, 'empty'));
check(() =>
  assert.equal(
    readLane('calls', JSON.stringify([{ title: 't', evidence: 'e' }])).status,
    'ok',
  ),
);
// THE ONE THAT LIED: a prose answer parsed to nothing and the screen said the
// lane was clear. It was not read at all.
check(() =>
  assert.equal(
    readLane('calls', 'I think you should improve your funnel.').status,
    'unusable',
  ),
);
check(() => assert.equal(readLane('calls', '[{"broken"').status, 'unusable'));
// A finding dropped for citing no evidence is not an empty lane either: the
// specialist did make a claim, and it is the claim that failed.
check(() =>
  assert.equal(
    readLane('calls', JSON.stringify([{ title: 'no evidence here' }])).status,
    'unusable',
  ),
);
check(() => assert.equal(readLane('calls', '').status, 'empty'));

console.log(`growth-specialists: ${checks} assertions passed (with lane status)`);
