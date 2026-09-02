/**
 * Queue routing (§7-9).
 *
 * Pure selection logic, kept separate from the database so every strategy is
 * directly testable. `findAvailableAgent` in lib/handoff-service.ts previously
 * hardcoded one order (skill, then language, then least busy) and had no
 * concept of a queue, a capacity limit, priority or overflow.
 */

export type RoutingStrategy =
  | 'skill_first'
  | 'least_busy'
  | 'longest_idle'
  | 'round_robin';

export const ROUTING_STRATEGIES: RoutingStrategy[] = [
  'skill_first',
  'least_busy',
  'longest_idle',
  'round_robin',
];

export type OverflowAction =
  | 'callback'
  | 'ticket'
  | 'ai_continue'
  | 'overflow_queue';

export type RoutableAgent = {
  id: string;
  name: string;
  role: string;
  skills: string[];
  languages: string[];
  activeCalls: number;
  maxConcurrentCalls: number;
  /** ISO timestamp of the agent's last assignment, or null if never assigned. */
  lastAssignedAt: string | null;
  /** Membership priority inside the queue; lower is preferred. */
  queuePriority: number;
  availability: string;
  /**
   * False when the agent's configured shift does not cover now. Absent means
   * no shifts are configured, which counts as available.
   */
  onShift?: boolean;
  offShiftReason?: string | null;
};

export type RoutingRequest = {
  strategy: RoutingStrategy;
  requiredSkill?: string | null;
  language?: string | null;
  minRoleRank?: number;
  roleRank: (role: string) => number;
};

export type RoutingOutcome = {
  agent: RoutableAgent | null;
  reason:
    | 'matched'
    | 'no_members'
    | 'all_offline'
    | 'at_capacity'
    | 'role_too_low'
    | 'skill_unavailable'
    | 'off_shift';
  considered: number;
  /** Present when a match was made: which fallback tier it came from. */
  matchTier?: 'skill_and_language' | 'skill_only' | 'language_only' | 'any';
};

const lower = (value: string) => value.trim().toLowerCase();

function hasCapacity(agent: RoutableAgent) {
  const limit = Math.max(1, Number(agent.maxConcurrentCalls || 1));
  return Number(agent.activeCalls || 0) < limit;
}

/**
 * Picks one agent for a conversation, or explains why none could be picked.
 * The reason matters: an "at capacity" queue and an empty queue need different
 * customer-facing answers, and the caller must never claim a transfer that
 * did not happen.
 */
export function selectAgent(
  candidates: RoutableAgent[],
  request: RoutingRequest,
): RoutingOutcome {
  const considered = candidates.length;
  if (!considered) return { agent: null, reason: 'no_members', considered };

  const online = candidates.filter((agent) => agent.availability === 'online');
  if (!online.length) return { agent: null, reason: 'all_offline', considered };

  // Shift filter before anything else: an agent who forgot to go offline must
  // not take a call at 3am, and someone on a break must not be interrupted.
  const onShift = online.filter((agent) => agent.onShift !== false);
  if (!onShift.length) return { agent: null, reason: 'off_shift', considered };

  const minRank = request.minRoleRank ?? 1;
  const senior = onShift.filter(
    (agent) => request.roleRank(agent.role) >= minRank,
  );
  if (!senior.length)
    return { agent: null, reason: 'role_too_low', considered };

  const free = senior.filter(hasCapacity);
  if (!free.length) return { agent: null, reason: 'at_capacity', considered };

  const skill = request.requiredSkill ? lower(request.requiredSkill) : '';
  const language = request.language ? lower(request.language) : '';
  const skillOk = (agent: RoutableAgent) =>
    !skill || agent.skills.some((item) => lower(item) === skill);
  const languageOk = (agent: RoutableAgent) =>
    !language || agent.languages.some((item) => lower(item) === language);

  // Strategy decides the order inside a tier; the tiers themselves always
  // prefer a better skill/language fit.
  const ordered = [...free].sort((a, b) => {
    if (a.queuePriority !== b.queuePriority)
      return a.queuePriority - b.queuePriority;
    if (request.strategy === 'least_busy' && a.activeCalls !== b.activeCalls)
      return a.activeCalls - b.activeCalls;
    if (request.strategy === 'longest_idle' || request.strategy === 'round_robin') {
      // Never assigned sorts first, then the least recently assigned.
      const aTime = a.lastAssignedAt ? Date.parse(a.lastAssignedAt) : 0;
      const bTime = b.lastAssignedAt ? Date.parse(b.lastAssignedAt) : 0;
      if (aTime !== bTime) return aTime - bTime;
    }
    if (a.activeCalls !== b.activeCalls) return a.activeCalls - b.activeCalls;
    return a.name.localeCompare(b.name);
  });

  // Each tier is only added when it is actually a constraint. An unconditional
  // language tier would pass everyone through when no language was requested,
  // which let skill_first quietly route a billing case to an unskilled agent.
  const tiers: Array<{
    tier: NonNullable<RoutingOutcome['matchTier']>;
    test: (agent: RoutableAgent) => boolean;
  }> = [];
  if (skill && language)
    tiers.push({
      tier: 'skill_and_language',
      test: (agent) => skillOk(agent) && languageOk(agent),
    });
  if (skill) tiers.push({ tier: 'skill_only', test: skillOk });
  if (language) tiers.push({ tier: 'language_only', test: languageOk });
  // skill_first insists on the skill: it will not silently hand a billing
  // dispute to someone with no billing skill.
  const allowAnyone = request.strategy !== 'skill_first' || !skill;
  if (allowAnyone) tiers.push({ tier: 'any', test: () => true });

  for (const { tier, test } of tiers) {
    const match = ordered.find(test);
    if (match)
      return { agent: match, reason: 'matched', considered, matchTier: tier };
  }
  return { agent: null, reason: 'skill_unavailable', considered };
}

export type QueueLike = {
  id: string;
  slug: string;
  priority: number;
  matchType?: string | null;
  matchValue?: string | null;
};

/**
 * Chooses the queue for a conversation from the workspace's routing rules.
 * Rules are matched in priority order; the first match wins.
 */
export function selectQueue(
  rules: Array<{
    queueId: string;
    matchType: string;
    matchValue: string;
    priority: number;
  }>,
  context: {
    skill?: string | null;
    language?: string | null;
    numberId?: string | null;
    useCase?: string | null;
    reason?: string | null;
  },
) {
  const value = (matchType: string) => {
    if (matchType === 'skill') return context.skill;
    if (matchType === 'language') return context.language;
    if (matchType === 'number') return context.numberId;
    if (matchType === 'use_case') return context.useCase;
    if (matchType === 'reason') return context.reason;
    return null;
  };
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  for (const rule of ordered) {
    const actual = value(rule.matchType);
    if (!actual) continue;
    if (rule.matchValue === '*' || lower(actual) === lower(rule.matchValue))
      return rule.queueId;
  }
  return null;
}
