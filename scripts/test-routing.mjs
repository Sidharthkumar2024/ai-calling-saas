import { selectAgent, selectQueue } from '../lib/routing.ts';

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) pass++;
  else fail++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
};

const roleRank = (role) =>
  ({ support_agent: 1, manager: 2, finance: 3, admin: 4 })[role] ?? 1;

const agent = (over = {}) => ({
  id: over.id ?? 'a1',
  name: over.name ?? 'Agent',
  role: over.role ?? 'support_agent',
  skills: over.skills ?? [],
  languages: over.languages ?? ['hi-IN'],
  activeCalls: over.activeCalls ?? 0,
  maxConcurrentCalls: over.maxConcurrentCalls ?? 1,
  lastAssignedAt: over.lastAssignedAt ?? null,
  queuePriority: over.queuePriority ?? 100,
  availability: over.availability ?? 'online',
  onShift: over.onShift,
});

console.log('empty and unavailable queues:');
ok(
  'no members → no_members',
  selectAgent([], { strategy: 'least_busy', roleRank }).reason === 'no_members',
);
ok(
  'everyone offline → all_offline, no agent',
  (() => {
    const r = selectAgent([agent({ availability: 'offline' })], {
      strategy: 'least_busy',
      roleRank,
    });
    return r.reason === 'all_offline' && r.agent === null;
  })(),
);
ok(
  'online but at capacity → at_capacity',
  selectAgent([agent({ activeCalls: 1, maxConcurrentCalls: 1 })], {
    strategy: 'least_busy',
    roleRank,
  }).reason === 'at_capacity',
);
ok(
  'capacity above 1 keeps the agent eligible',
  selectAgent([agent({ activeCalls: 1, maxConcurrentCalls: 3 })], {
    strategy: 'least_busy',
    roleRank,
  }).reason === 'matched',
);
ok(
  'role below the minimum → role_too_low',
  selectAgent([agent({ role: 'support_agent' })], {
    strategy: 'least_busy',
    roleRank,
    minRoleRank: 2,
  }).reason === 'role_too_low',
);

console.log('least_busy:');
ok(
  'picks the agent with fewer active calls',
  selectAgent(
    [
      agent({ id: 'busy', activeCalls: 2, maxConcurrentCalls: 5 }),
      agent({ id: 'free', activeCalls: 0, maxConcurrentCalls: 5 }),
    ],
    { strategy: 'least_busy', roleRank },
  ).agent.id === 'free',
);

console.log('longest_idle:');
ok(
  'never-assigned agent wins over a recently assigned one',
  selectAgent(
    [
      agent({ id: 'recent', lastAssignedAt: '2026-09-02T10:00:00Z' }),
      agent({ id: 'fresh', lastAssignedAt: null }),
    ],
    { strategy: 'longest_idle', roleRank },
  ).agent.id === 'fresh',
);
ok(
  'oldest assignment wins between two assigned agents',
  selectAgent(
    [
      agent({ id: 'newer', lastAssignedAt: '2026-09-02T12:00:00Z' }),
      agent({ id: 'older', lastAssignedAt: '2026-09-01T09:00:00Z' }),
    ],
    { strategy: 'longest_idle', roleRank },
  ).agent.id === 'older',
);

console.log('skill_first:');
ok(
  'prefers skill and language together',
  (() => {
    const r = selectAgent(
      [
        agent({ id: 'skill-only', skills: ['billing'], languages: ['en-IN'] }),
        agent({ id: 'both', skills: ['billing'], languages: ['pa-IN'] }),
      ],
      {
        strategy: 'skill_first',
        requiredSkill: 'billing',
        language: 'pa-IN',
        roleRank,
      },
    );
    return r.agent.id === 'both' && r.matchTier === 'skill_and_language';
  })(),
);
ok(
  'falls back to skill only when no language match exists',
  (() => {
    const r = selectAgent(
      [agent({ id: 'skill-only', skills: ['billing'], languages: ['en-IN'] })],
      {
        strategy: 'skill_first',
        requiredSkill: 'billing',
        language: 'ta-IN',
        roleRank,
      },
    );
    return r.agent.id === 'skill-only' && r.matchTier === 'skill_only';
  })(),
);
ok(
  'skill_first refuses an unskilled agent rather than mis-routing',
  (() => {
    const r = selectAgent([agent({ id: 'general', skills: ['sales'] })], {
      strategy: 'skill_first',
      requiredSkill: 'billing',
      roleRank,
    });
    return r.agent === null && r.reason === 'skill_unavailable';
  })(),
);
ok(
  'least_busy does accept an unskilled agent as a last resort',
  selectAgent([agent({ id: 'general', skills: ['sales'] })], {
    strategy: 'least_busy',
    requiredSkill: 'billing',
    roleRank,
  }).matchTier === 'any',
);
ok(
  'case-insensitive skill match',
  selectAgent([agent({ id: 'x', skills: ['Billing'] })], {
    strategy: 'skill_first',
    requiredSkill: 'billing',
    roleRank,
  }).agent.id === 'x',
);

console.log('shift awareness:');
ok(
  'an online agent who is off shift is not routable',
  (() => {
    const r = selectAgent([agent({ onShift: false })], {
      strategy: 'least_busy',
      roleRank,
    });
    return r.agent === null && r.reason === 'off_shift';
  })(),
);
ok(
  'the on-shift agent is chosen over the off-shift one',
  selectAgent(
    [
      agent({ id: 'off', onShift: false, activeCalls: 0 }),
      agent({ id: 'on', onShift: true, activeCalls: 3, maxConcurrentCalls: 5 }),
    ],
    { strategy: 'least_busy', roleRank },
  ).agent.id === 'on',
);
ok(
  'an agent with no shift data stays routable',
  selectAgent([agent({})], { strategy: 'least_busy', roleRank }).reason ===
    'matched',
);

console.log('membership priority:');
ok(
  'queue priority beats idle time',
  selectAgent(
    [
      agent({ id: 'primary', queuePriority: 10, lastAssignedAt: '2026-09-02T12:00:00Z' }),
      agent({ id: 'backup', queuePriority: 200, lastAssignedAt: null }),
    ],
    { strategy: 'longest_idle', roleRank },
  ).agent.id === 'primary',
);

console.log('queue selection:');
const rules = [
  { queueId: 'q_billing', matchType: 'skill', matchValue: 'billing', priority: 10 },
  { queueId: 'q_punjabi', matchType: 'language', matchValue: 'pa-IN', priority: 20 },
  { queueId: 'q_default', matchType: 'skill', matchValue: '*', priority: 900 },
];
ok(
  'first matching rule by priority wins',
  selectQueue(rules, { skill: 'billing', language: 'pa-IN' }) === 'q_billing',
);
ok(
  'lower-priority rule matches when the first does not',
  selectQueue(rules, { skill: 'sales', language: 'pa-IN' }) === 'q_punjabi',
);
ok(
  'wildcard rule is the catch-all',
  selectQueue(rules, { skill: 'sales', language: 'ta-IN' }) === 'q_default',
);
ok(
  'no context value means no match, not a crash',
  selectQueue(
    [{ queueId: 'q', matchType: 'number', matchValue: 'num_1', priority: 1 }],
    {},
  ) === null,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
