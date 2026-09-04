import assert from 'node:assert/strict';

import {
  CHAT_SYSTEM_PROMPT,
  buildChatContext,
  composeGoalPrompt,
  recentTurns,
  workspaceChips,
} from '../lib/growth-chat.ts';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

const answers = {
  business: 'Google Business Profile management software',
  website: 'adgrowly.ca',
  lead_definition: 'Purchase',
  ideal_customer: 'dhandha ai',
  goals: 'More traffic and search visibility',
  competitors: 'dhandhaai.com',
};

console.log('composeGoalPrompt');

check('the opening request is built from what we already know', () => {
  // A person should not retype their own business into an empty box.
  const prompt = composeGoalPrompt({ answers });
  assert.match(prompt, /adgrowly\.ca/);
  assert.match(prompt, /purchase/i);
  assert.match(prompt, /dhandhaai\.com/);
  assert.match(prompt, /traffic and search visibility/i);
});

check('a typed goal always wins over the composed one', () => {
  assert.equal(
    composeGoalPrompt({ answers, goal: 'Why did last week convert badly?' }),
    'Why did last week convert badly?',
  );
});

check('an empty workspace still produces something askable', () => {
  const prompt = composeGoalPrompt({ answers: {} });
  assert.ok(prompt.length > 10);
  assert.match(prompt, /my business/);
});

check('missing optional answers are simply left out', () => {
  const prompt = composeGoalPrompt({
    answers: { business: 'A bakery', lead_definition: 'Orders' },
  });
  assert.match(prompt, /A bakery/);
  assert.ok(!prompt.includes('undefined'));
  assert.ok(!prompt.includes('weighed against'));
});

console.log('workspaceChips');

check('only answered questions become chips', () => {
  const chips = workspaceChips({ business: 'x', website: '   ' });
  assert.equal(chips.length, 1);
  assert.equal(chips[0].id, 'business');
  assert.ok(chips[0].label);
});

check('a long answer is trimmed for the chip', () => {
  const [chip] = workspaceChips({ business: 'y'.repeat(300) });
  assert.ok(chip.value.length <= 60);
});

console.log('buildChatContext');

const observation = (over = {}) => ({
  id: 'conversion_rate',
  statement: '1.9% of calls reached a booking or a payment link.',
  source: 'calls',
  metric: { label: 'Conversion', value: 1.9, unit: '%' },
  sampleSize: 54,
  confidence: 'medium',
  ...over,
});

check('measured figures carry their source, sample and confidence', () => {
  // The point of this block is that every figure in the answer traces to a row.
  const context = buildChatContext({
    answers,
    observations: [observation()],
    scan: null,
    objections: [],
    missingSources: [],
  });
  assert.match(context, /source="calls"/);
  assert.match(context, /sample="54"/);
  assert.match(context, /confidence="medium"/);
  assert.match(context, /1\.9%/);
});

check('the call figures come with the frame needed to read them', () => {
  // Correct numbers with no frame produced a confidently wrong conclusion: the
  // first version read "9.3% handed to a person" as "90% never reached
  // anybody" and told the business its routing was broken. Nothing was broken
  // — the AI had handled the other 90%, which is the product working.
  const context = buildChatContext({
    answers: {},
    observations: [observation()],
    scan: null,
    objections: [],
    missingSources: [],
  });
  assert.match(context, /handled end to end by an AI voice agent/);
  assert.match(context, /transfer to a person is an escalation, not the goal/i);
  assert.match(context, /never connected/);
});

check('the frame is omitted when there are no call figures to misread', () => {
  const context = buildChatContext({
    answers: { business: 'x' },
    observations: [],
    scan: null,
    objections: [],
    missingSources: [],
  });
  assert.ok(!context.includes('how_to_read_these'));
});

check('the website scan is included with its run id', () => {
  const context = buildChatContext({
    answers: {},
    observations: [],
    scan: {
      host: 'adgrowly.ca',
      runId: 'run_abc',
      pages: [{ path: '/contact', title: 'Contact', wordCount: 6 }],
      findings: [
        {
          page: '/contact',
          title: 'built in the browser',
          doThis: 'Server-render it',
          evidence: 'about 6 words',
          severity: 'high',
        },
      ],
    },
    objections: [],
    missingSources: [],
  });
  assert.match(context, /run="run_abc"/);
  assert.match(context, /path="\/contact"/);
  assert.match(context, /measured: about 6 words/);
});

check('what is NOT connected is stated, not left to silence', () => {
  // Without this the model fills the gap with a plausible traffic figure, which
  // is the single most damaging thing it could do here.
  const context = buildChatContext({
    answers: {},
    observations: [],
    scan: null,
    objections: [],
    missingSources: ['Google Analytics', 'Search Console'],
  });
  assert.match(context, /not_connected/);
  assert.match(context, /Google Analytics/);
  assert.match(context, /no data at all/);
});

check(
  'an empty workspace produces an empty context, not invented filler',
  () => {
    const context = buildChatContext({
      answers: {},
      observations: [],
      scan: null,
      objections: [],
      missingSources: [],
    });
    assert.equal(context, '');
  },
);

console.log('the system prompt');

check('it forbids the specific ways this goes wrong', () => {
  assert.match(
    CHAT_SYSTEM_PROMPT,
    /Never state a number that is not in the context/,
  );
  // A made-up benchmark is worse than no benchmark.
  assert.match(CHAT_SYSTEM_PROMPT, /benchmark/i);
  assert.match(CHAT_SYSTEM_PROMPT, /not enough data/i);
});

check('it treats "I cannot answer that" as a valid answer', () => {
  assert.match(CHAT_SYSTEM_PROMPT, /useful reply, not a failure/);
});

console.log('recentTurns');

check('a long thread is trimmed from the front, keeping the newest', () => {
  const messages = Array.from({ length: 20 }, (_, i) => ({
    role: 'user',
    content: `m${i}`,
  }));
  const kept = recentTurns(messages, 4);
  assert.equal(kept.length, 4);
  assert.equal(kept[3].content, 'm19');
});

check('a short thread is untouched, and nothing is a throw', () => {
  assert.equal(recentTurns([{ role: 'user', content: 'a' }]).length, 1);
  assert.deepEqual(recentTurns([]), []);
  assert.deepEqual(recentTurns(undefined), []);
});

console.log(`\n${passed} assertions passed.`);
