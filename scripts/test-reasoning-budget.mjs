/**
 * The size of the envelope a reasoning answer is posted in.
 *
 * The old expression was `Math.max(40, Math.min(700, asked ?? 700))`: a
 * ceiling equal to the default, which is not a ceiling. The assertions that
 * matter are the two callers it silently overruled.
 */
import assert from 'node:assert/strict';

import {
  REASONING_DEFAULT_TOKENS,
  REASONING_MAX_TOKENS,
  ranOutOfRoom,
  reasoningBudget,
} from '../lib/reasoning-budget.ts';

let checks = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks += 1;
};

// Asking for nothing gets the spoken-reply default.
equal(reasoningBudget(), REASONING_DEFAULT_TOKENS);
equal(reasoningBudget(null), REASONING_DEFAULT_TOKENS);
equal(reasoningBudget(Number.NaN), REASONING_DEFAULT_TOKENS);

// THE TWO THAT WERE OVERRULED.
// The tool-calling turn raises its floor to 900 on purpose, because a
// truncated tool_use block came back with no text at all.
equal(
  reasoningBudget(Math.max(900, 700)),
  900,
  'a caller that raised its own floor to 900 keeps it',
);
// The schema builder asks for 2000 and is told it may propose four objects of
// twenty fields.
equal(reasoningBudget(2000), 2000);

// A ceiling is still a ceiling.
equal(reasoningBudget(50_000), REASONING_MAX_TOKENS);
// And a floor: an accidental zero is not honoured as "answer in no words".
equal(reasoningBudget(0), 40);
equal(reasoningBudget(-100), 40);
// Whole tokens only.
equal(reasoningBudget(701.6), 702);
// The default has to sit below the ceiling or the parameter means nothing.
assert.ok(REASONING_DEFAULT_TOKENS < REASONING_MAX_TOKENS);
checks += 1;

// Stopping because there was no room left is not the same as being wrong.
equal(ranOutOfRoom('max_tokens'), true);
equal(ranOutOfRoom('length'), true);
equal(ranOutOfRoom('end_turn'), false);
equal(ranOutOfRoom('tool_use'), false);
equal(ranOutOfRoom(undefined), false);

console.log(`reasoning budget: ${checks} assertions passed.`);
