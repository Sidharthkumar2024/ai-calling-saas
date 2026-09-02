import {
  evaluateAction,
  roleCanAuthorise,
  DEFAULT_REFUND_POLICY,
} from '../lib/action-policy.ts';
let pass = 0,
  fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++;
  } else {
    fail++;
  }
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (extra ? ' → ' + extra : ''));
};
const clean = { eligibility: { passed: true }, riskFlags: [], conditions: [] };

console.log('Path A — fully automatic (within AI authority):');
let r = evaluateAction({ action: 'refund', amount: 200, ...clean });
ok(
  '₹200 auto_execute',
  r.decision === 'auto_execute',
  r.riskLevel + ' / ' + r.reasons.join(','),
);
r = evaluateAction({ action: 'refund', amount: 499, ...clean });
ok(
  '₹499 auto_execute (medium risk near ceiling)',
  r.decision === 'auto_execute' && r.riskLevel === 'medium',
);

console.log('Path B — manager approval:');
r = evaluateAction({ action: 'refund', amount: 2500, ...clean });
ok(
  '₹2500 → manager_approval',
  r.decision === 'manager_approval',
  r.reasons.join(','),
);
r = evaluateAction({
  action: 'refund',
  amount: 200,
  eligibility: { passed: false, failed: ['delivered_ok'] },
  riskFlags: [],
  conditions: [],
});
ok(
  'eligibility FAIL → approval even for small amount',
  r.decision === 'manager_approval',
  r.reasons.join(','),
);
r = evaluateAction({
  action: 'refund',
  amount: 200,
  eligibility: { passed: true },
  riskFlags: ['refund_velocity'],
  conditions: [],
});
ok(
  'risk flag → approval even for small amount',
  r.decision === 'manager_approval',
  r.reasons.join(','),
);

console.log('Path C — human only / restricted:');
r = evaluateAction({
  action: 'refund',
  amount: 100,
  eligibility: { passed: true },
  riskFlags: [],
  conditions: ['duplicate_refund'],
});
ok(
  'duplicate_refund → human_only + restricted',
  r.decision === 'human_only' && r.riskLevel === 'restricted',
  r.reasons.join(','),
);
r = evaluateAction({
  action: 'refund',
  amount: 100,
  ...clean,
  conditions: ['payment_dispute'],
});
ok('payment_dispute → human_only', r.decision === 'human_only');
r = evaluateAction({ action: 'refund', amount: 50000, ...clean });
ok(
  '₹50000 above manager threshold → human_only',
  r.decision === 'human_only',
  r.reasons.join(','),
);
r = evaluateAction({
  action: 'refund',
  amount: 100,
  ...clean,
  customerRequestedHuman: true,
});
ok(
  'customer asked for a human → human_only',
  r.decision === 'human_only',
  r.reasons.join(','),
);

console.log('guards:');
r = evaluateAction({ action: 'refund', amount: null, ...clean });
ok(
  'missing amount never auto-executes',
  r.decision !== 'auto_execute',
  r.reasons.join(','),
);
r = evaluateAction({ action: 'refund', amount: -5, ...clean });
ok('negative amount never auto-executes', r.decision !== 'auto_execute');
r = evaluateAction({ action: 'refund', amount: 200, ...clean });
ok(
  'policy version recorded',
  r.policyVersion === DEFAULT_REFUND_POLICY.version,
);
ok(
  'auto path still requires spoken confirmation',
  r.requiresConfirmation === true,
);

console.log('role authority matrix (§11):');
ok(
  'AI agent cannot authorise approval-level',
  !roleCanAuthorise('ai_agent', 'manager_approval'),
);
ok(
  'AI agent can do auto_execute',
  roleCanAuthorise('ai_agent', 'auto_execute'),
);
ok(
  'manager can authorise approval-level',
  roleCanAuthorise('manager', 'manager_approval'),
);
ok(
  'manager cannot authorise human_only/restricted',
  !roleCanAuthorise('manager', 'human_only'),
);
ok(
  'finance can authorise restricted',
  roleCanAuthorise('finance', 'human_only'),
);

console.log(`\n${pass} passed, ${fail} failed`);
