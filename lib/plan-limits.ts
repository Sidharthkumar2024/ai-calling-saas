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
 * Checks one limit. A workspace with no plan row is not blocked — that is a
 * provisioning gap, not a customer overage, and failing closed there would
 * lock people out of their own workspace.
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
  if (!plan)
    return {
      allowed: true,
      kind,
      limit: null,
      used: 0,
      requested,
      planName: null,
    };

  const limitRaw =
    kind === 'numbers'
      ? plan.max_numbers
      : kind === 'agents'
        ? plan.max_agents
        : plan.concurrency;
  const limit = Number(limitRaw ?? 0);
  // 0 or null means "not limited by this plan".
  if (!Number.isFinite(limit) || limit <= 0)
    return {
      allowed: true,
      kind,
      limit: null,
      used: 0,
      requested,
      planName: plan.name,
    };

  if (kind === 'concurrency')
    return {
      allowed: requested <= limit,
      kind,
      limit,
      used: 0,
      requested,
      planName: plan.name,
      message:
        requested <= limit
          ? undefined
          : `The ${plan.name} plan allows ${limit} concurrent calls. Reduce concurrency or upgrade the plan.`,
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
    planName: plan.name,
    message: allowed
      ? undefined
      : `The ${plan.name} plan includes ${limit} ${kind}. You are using ${used}. Upgrade the plan to add more.`,
  };
}
