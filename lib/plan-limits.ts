import { getRawDb } from '@/db/index';

/**
 * Plan limit enforcement.
 *
 * `plans.max_agents`, `plans.max_numbers` and `plans.concurrency` were stored
 * and displayed on the overview, but nothing ever checked them — a workspace
 * on a 1-number plan could rent twenty.
 */

export type LimitKind = 'numbers' | 'agents' | 'concurrency';

export type LimitVerdict = {
  allowed: boolean;
  kind: LimitKind;
  limit: number | null;
  used: number;
  requested: number;
  planName: string | null;
  message?: string;
};

const COUNTS: Record<Exclude<LimitKind, 'concurrency'>, string> = {
  numbers: `SELECT count(*) AS used FROM phone_numbers
    WHERE organization_id = ? AND status != 'released'`,
  agents: `SELECT count(*) AS used FROM voice_agents
    WHERE organization_id = ? AND status != 'archived'`,
};

/**
 * Limits for a workspace that has not bought a plan yet.
 *
 * Under §3 that is now the *normal* state of a new signup rather than a
 * provisioning gap, so "no plan" can no longer mean "no limits" — which would
 * have made an unpaid workspace less restricted than a paying one. These are
 * enough to build and hear an agent in the playground, which is exactly what
 * the trial is for.
 */
const TRIAL_LIMITS = { name: 'Trial', agents: 1, numbers: 0, concurrency: 1 };

/**
 * Checks one limit. A workspace with no plan is held to the trial limits above
 * rather than waved through.
 */
export async function checkPlanLimit(
  organizationId: string,
  kind: LimitKind,
  requested = 1,
): Promise<LimitVerdict> {
  const db = getRawDb();
  const plan = await db
    .prepare(`SELECT p.name, p.max_agents, p.max_numbers, p.concurrency
      FROM subscriptions s
      INNER JOIN plans p ON p.id = s.plan_id
      WHERE s.organization_id = ? AND s.status IN ('active','trialing')
      ORDER BY s.created_at DESC LIMIT 1`)
    .bind(organizationId)
    .first<{
      name: string;
      max_agents: number | null;
      max_numbers: number | null;
      concurrency: number | null;
    }>();
  const effective = plan ?? {
    name: TRIAL_LIMITS.name,
    max_agents: TRIAL_LIMITS.agents,
    max_numbers: TRIAL_LIMITS.numbers,
    concurrency: TRIAL_LIMITS.concurrency,
  };

  // A trial allows no numbers at all, and 0 here means "none" rather than
  // "unlimited" — the opposite of what it means on a plan, so it is handled
  // before the shared unlimited check below.
  if (!plan && kind === 'numbers')
    return {
      allowed: false,
      kind,
      limit: 0,
      used: 0,
      requested,
      planName: TRIAL_LIMITS.name,
      message:
        'Connecting a number needs a plan. Choose one to finish setting up your workspace.',
    };

  const limitRaw =
    kind === 'numbers'
      ? effective.max_numbers
      : kind === 'agents'
        ? effective.max_agents
        : effective.concurrency;
  const limit = Number(limitRaw ?? 0);
  // 0 or null means "not limited by this plan".
  if (!Number.isFinite(limit) || limit <= 0)
    return {
      allowed: true,
      kind,
      limit: null,
      used: 0,
      requested,
      planName: effective.name,
    };

  if (kind === 'concurrency')
    return {
      allowed: requested <= limit,
      kind,
      limit,
      used: 0,
      requested,
      planName: effective.name,
      message:
        requested <= limit
          ? undefined
          : `The ${effective.name} plan allows ${limit} concurrent calls. Reduce concurrency or upgrade the plan.`,
    };

  const row = await db
    .prepare(COUNTS[kind])
    .bind(organizationId)
    .first<{ used: number }>();
  const used = Number(row?.used ?? 0);
  const allowed = used + requested <= limit;
  return {
    allowed,
    kind,
    limit,
    used,
    requested,
    planName: effective.name,
    message: allowed
      ? undefined
      : `The ${effective.name} plan includes ${limit} ${kind}. You are using ${used}. Upgrade the plan to add more.`,
  };
}
