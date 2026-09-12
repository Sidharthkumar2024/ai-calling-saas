/**
 * Whether an answer is the kind of thing the Ask asked for.
 *
 * `expect` has been authored on every Ask since the node existed and read by
 * nothing, so "What day suits you?" accepted "yes" and carried it into a
 * booking. The rule is forgiving about form and strict about kind: people say
 * "14 March", "14/03", "tomorrow at 4" and "haan", and none of those should be
 * refused over punctuation — while an answer of the wrong sort altogether
 * should be.
 */
import assert from 'node:assert/strict';

import { answerMatches, EXPECTATION_HINT } from '../lib/workflow-nodes.ts';

let checks = 0;
const accepts = (expect, answer) => {
  assert.equal(answerMatches(expect, answer).ok, true, `${expect} should accept ${JSON.stringify(answer)}`);
  checks += 1;
};
const refuses = (expect, answer) => {
  assert.equal(answerMatches(expect, answer).ok, false, `${expect} should refuse ${JSON.stringify(answer)}`);
  checks += 1;
};

// Nothing is never an answer, whatever was asked.
for (const expect of ['any', 'number', 'yes_no', 'date', 'phone', 'email']) {
  refuses(expect, '');
  refuses(expect, '   ');
  refuses(expect, null);
}

// An Ask that did not say what it wanted cannot argue.
accepts('any', 'whatever they said');
accepts(undefined, 'no expectation authored at all');
accepts('nonsense-expectation', 'unknown kinds fall back to any');

// Numbers, as people say them.
accepts('number', '4');
accepts('number', 'about 4 people');
accepts('number', '2 bhk');
refuses('number', 'a few');

// Yes and no, in both languages this product speaks.
accepts('yes_no', 'yes');
accepts('yes_no', 'Yeah ok');
accepts('yes_no', 'nope');
accepts('yes_no', 'haan');
accepts('yes_no', 'nahi');
accepts('yes_no', 'theek hai');
refuses('yes_no', 'maybe next week');
// THE ONE THAT MATTERED: a day where a yes/no was asked, and the other way.
refuses('yes_no', '14 March');

// Dates, as people say them.
accepts('date', '14 March');
accepts('date', '14/03');
accepts('date', '14-03-2026');
accepts('date', 'tomorrow');
accepts('date', 'tomorrow at 4');
accepts('date', 'next monday');
refuses('date', 'yes');
// A bare number is not a date: "4" answers too many other questions.
refuses('date', '4');

// Phone numbers.
accepts('phone', '9812345678');
accepts('phone', '+91 98123 45678');
refuses('phone', '98123');
refuses('phone', 'call me on my mobile');

// Email.
accepts('email', 'asha@example.com');
refuses('email', 'asha at example dot com');
refuses('email', 'asha@example');

// Every kind has something to say when it refuses, because the customer is
// waiting and "invalid" is not a sentence.
for (const expect of ['any', 'number', 'yes_no', 'date', 'phone', 'email']) {
  assert.ok(EXPECTATION_HINT[expect]?.length > 10, `${expect} needs a hint`);
  checks += 1;
}

console.log(`answer expectations: ${checks} assertions passed.`);
