import {
  CALL_OUTCOMES,
  CONVERSION_OUTCOMES,
  CONVERSION_SQL_LIST,
  UNKNOWN_OUTCOME,
  isCallOutcome,
  normaliseOutcome,
} from '../lib/call-outcomes.ts';

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) pass++;
  else fail++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
};

console.log('vocabulary:');
ok('the eight outcomes are the vocabulary', CALL_OUTCOMES.length === 8);
ok('a real outcome is recognised', isCallOutcome('appointment_booked'));
ok('a lifecycle value is not an outcome', !isCallOutcome('completed'));
ok('unknown is not one of the eight', !isCallOutcome(UNKNOWN_OUTCOME));
ok('non-strings are rejected', !isCallOutcome(null) && !isCallOutcome(7));

console.log('normalising what was already stored:');
ok(
  'lifecycle words become unknown, not an achievement',
  normaliseOutcome('completed') === UNKNOWN_OUTCOME &&
    normaliseOutcome('in_progress') === UNKNOWN_OUTCOME &&
    normaliseOutcome('dialing') === UNKNOWN_OUTCOME,
);
ok('an abandoned call is incomplete', normaliseOutcome('abandoned') === 'incomplete');
ok(
  'older names map onto the current ones',
  normaliseOutcome('callback') === 'callback_scheduled' &&
    normaliseOutcome('transferred') === 'transferred_to_human' &&
    normaliseOutcome('converted') === 'resolved',
);
ok(
  'THE INFLATION GUARD: a requested payment link is not a sent one',
  normaliseOutcome('payment_link_requested') === UNKNOWN_OUTCOME,
);
ok(
  'free prose from the model becomes incomplete',
  normaliseOutcome('Incomplete - appointment not confirmed, property type not specified') ===
    'incomplete',
);
ok('empty and null become unknown', normaliseOutcome('') === UNKNOWN_OUTCOME && normaliseOutcome(null) === UNKNOWN_OUTCOME);
ok('case and padding are tolerated', normaliseOutcome('  Resolved  ') === 'resolved');
ok('a valid outcome passes through untouched', normaliseOutcome('not_interested') === 'not_interested');

console.log('conversions:');
ok(
  'every conversion outcome is a real outcome',
  CONVERSION_OUTCOMES.every((outcome) => isCallOutcome(outcome)),
);
ok(
  'THE BUG: neither screen may count a value that is never written',
  !CONVERSION_OUTCOMES.includes('payment_link_requested') &&
    !CONVERSION_OUTCOMES.includes('converted'),
);
ok(
  'the SQL list quotes every outcome exactly once',
  CONVERSION_SQL_LIST.split(',').length === CONVERSION_OUTCOMES.length &&
    CONVERSION_OUTCOMES.every((outcome) =>
      CONVERSION_SQL_LIST.includes(`'${outcome}'`),
    ),
);
ok(
  'the SQL list cannot smuggle a quote into a query',
  !CONVERSION_SQL_LIST.replaceAll("'", '').includes("'") &&
    /^'[a-z_]+'(,'[a-z_]+')*$/.test(CONVERSION_SQL_LIST),
);
ok(
  'an unanalysed call never counts as a conversion',
  !CONVERSION_OUTCOMES.includes(UNKNOWN_OUTCOME),
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
