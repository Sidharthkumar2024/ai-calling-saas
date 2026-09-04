import { liveCallGate, onboardingState } from '../lib/onboarding.ts';

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) pass++;
  else fail++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
};

const nothing = {
  planSelected: false,
  businessDetails: false,
  documents: false,
  paid: false,
  integrations: false,
  knowledge: false,
  agentReady: false,
  playgroundTested: false,
};
const required = {
  ...nothing,
  planSelected: true,
  businessDetails: true,
  paid: true,
  agentReady: true,
  playgroundTested: true,
};

console.log('progress:');
const fresh = onboardingState(nothing);
ok('a new workspace has done nothing', fresh.completed === 0 && fresh.percent === 0);
ok('the first prompt is choosing a plan', fresh.nextStep.id === 'plan');
ok('every step is listed, optional ones included', fresh.total === 8);
const half = onboardingState({ ...nothing, planSelected: true, businessDetails: true });
ok('progress counts what is done', half.completed === 2 && half.percent === 25);
ok('the next prompt moves on', half.nextStep.id === 'documents');
ok(
  'an optional step is still prompted, just not required',
  half.nextStep.required === false,
);

console.log('the §3 gate:');
ok('nothing done means not live', fresh.live === false);
ok('payment is a blocker', fresh.blockers.includes('Payment'));
ok(
  'THE POINT OF §3: everything else done but unpaid is still not live',
  onboardingState({ ...required, paid: false }).live === false,
);
ok(
  'and the blocker says which one',
  onboardingState({ ...required, paid: false }).blockers.join() === 'Payment',
);
ok('all required steps done means live', onboardingState(required).live === true);
ok(
  'optional steps do not block: no integrations, no knowledge, still live',
  onboardingState(required).live === true &&
    onboardingState(required).steps.filter((s) => !s.done).length === 3,
);
ok('nothing is left to prompt once everything is done', onboardingState({
  ...required,
  documents: true,
  integrations: true,
  knowledge: true,
}).nextStep === null);

console.log('call gate:');
const blocked = liveCallGate(onboardingState({ ...required, paid: false, agentReady: false }));
ok('an incomplete workspace cannot place a real call', blocked.allowed === false);
ok('the reason names every blocker, not just the first', blocked.blockers.length === 2);
ok('the message is readable, not a code', blocked.reason.includes('Finish setup before placing real calls'));
ok('a finished workspace may call', liveCallGate(onboardingState(required)).allowed === true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
