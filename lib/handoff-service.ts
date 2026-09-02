import { getRawDb } from '@/db/index';
import {
  ROUTING_STRATEGIES,
  selectAgent,
  selectQueue,
  type RoutableAgent,
  type RoutingOutcome,
  type RoutingStrategy,
} from '@/lib/routing';
import {
  evaluateAction,
  roleCanAuthorise,
  type ActionDecision,
  type ActionPolicy,
  type ActorRole,
} from '@/lib/action-policy';

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function jsonArray(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

const ROLE_RANK: Record<string, number> = {
  support_agent: 1,
  manager: 2,
  finance: 3,
  admin: 4,
};

export type AvailableAgent = {
  id: string;
  name: string;
  role: string;
  skills: string[];
  languages: string[];
  activeCalls: number;
};

/**
 * Queue-aware routing (§7-9). Loads the queue's configuration and members,
 * then applies the queue's strategy through the pure engine in lib/routing.ts.
 * With no queue it considers every support agent in the workspace, which keeps
 * the older callers working unchanged.
 */
export async function routeToAgent(input: {
  organizationId: string;
  queueId?: string | null;
  skill?: string | null;
  language?: string | null;
  minRole?: ActorRole | null;
}): Promise<RoutingOutcome & { queue: QueueConfig | null }> {
  const db = getRawDb();
  let queue: QueueConfig | null = null;
  if (input.queueId) {
    const row = await db
      .prepare(`SELECT id, slug, name, strategy, required_skill, language, min_role,
        sla_seconds, overflow_action, overflow_queue_id
        FROM queues WHERE id = ? AND organization_id = ? AND status = 'active' LIMIT 1`)
      .bind(input.queueId, input.organizationId)
      .first<QueueConfig>();
    queue = row ?? null;
  }

  const strategy: RoutingStrategy = ROUTING_STRATEGIES.includes(
    (queue?.strategy ?? '') as RoutingStrategy,
  )
    ? (queue!.strategy as RoutingStrategy)
    : 'skill_first';

  const rows = queue
    ? await db
        .prepare(`SELECT a.id, a.name, a.role, a.skills_json, a.languages_json,
          a.active_calls, a.availability, a.last_assigned_at,
          coalesce(a.max_concurrent_calls, 1) AS max_concurrent_calls,
          m.priority AS queue_priority
        FROM queue_members m
        INNER JOIN support_agents a ON a.id = m.support_agent_id
        WHERE m.queue_id = ? AND m.organization_id = ?`)
        .bind(queue.id, input.organizationId)
        .all<AgentRow>()
    : await db
        .prepare(`SELECT a.id, a.name, a.role, a.skills_json, a.languages_json,
          a.active_calls, a.availability, a.last_assigned_at,
          coalesce(a.max_concurrent_calls, 1) AS max_concurrent_calls,
          100 AS queue_priority
        FROM support_agents a WHERE a.organization_id = ?`)
        .bind(input.organizationId)
        .all<AgentRow>();

  const candidates: RoutableAgent[] = (rows.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    skills: jsonArray(row.skills_json),
    languages: jsonArray(row.languages_json),
    activeCalls: Number(row.active_calls ?? 0),
    maxConcurrentCalls: Number(row.max_concurrent_calls ?? 1),
    lastAssignedAt: row.last_assigned_at ?? null,
    queuePriority: Number(row.queue_priority ?? 100),
    availability: row.availability,
  }));

  const minRole = input.minRole ?? (queue?.min_role as ActorRole | null) ?? null;
  const outcome = selectAgent(candidates, {
    strategy,
    requiredSkill: input.skill ?? queue?.required_skill ?? null,
    language: input.language ?? queue?.language ?? null,
    minRoleRank: minRole ? (ROLE_RANK[minRole] ?? 1) : 1,
    roleRank: (role) => ROLE_RANK[role] ?? 1,
  });
  return { ...outcome, queue };
}

export type QueueConfig = {
  id: string;
  slug: string;
  name: string;
  strategy: string;
  required_skill: string | null;
  language: string | null;
  min_role: string | null;
  sla_seconds: number;
  overflow_action: string;
  overflow_queue_id: string | null;
};

type AgentRow = {
  id: string;
  name: string;
  role: string;
  skills_json: string;
  languages_json: string;
  active_calls: number;
  availability: string;
  last_assigned_at: string | null;
  max_concurrent_calls: number;
  queue_priority: number;
};

/**
 * Kept for callers that do not name a queue. Only online agents with spare
 * capacity are eligible; null means nobody is available and the caller must
 * offer a truthful fallback instead of pretending the transfer worked.
 */
export async function findAvailableAgent(input: {
  organizationId: string;
  skill?: string | null;
  language?: string | null;
  minRole?: ActorRole | null;
}): Promise<AvailableAgent | null> {
  const outcome = await routeToAgent(input);
  if (!outcome.agent) return null;
  const { id: agentId, name, role, skills, languages, activeCalls } =
    outcome.agent;
  return { id: agentId, name, role, skills, languages, activeCalls };
}

export type TransferResult = {
  ok: boolean;
  handoffId: string;
  /** True only when a named human actually took the assignment. */
  transferred: boolean;
  agent?: { id: string; name: string; role: string };
  queueStatus: 'assigned' | 'queued';
  fallback?: 'callback' | 'ticket' | 'ai_continue';
  /** Slug of the queue the handoff landed in, when one applied. */
  queue?: string | null;
  /** Which skill/language tier produced the match. */
  matchTier?: string | null;
  /** Why nobody could be assigned — drives the customer-facing answer. */
  routingReason?: string;
  /** Set when the first queue could not serve the caller and overflow ran. */
  overflowedFrom?: string | null;
  message: string;
};

/**
 * Resolves a conversation to a queue and an agent, applying the workspace's
 * routing rules and one overflow hop. Shared by the real transfer and the
 * dry-run route test so a supervisor's test cannot disagree with what a live
 * transfer would actually do.
 */
export async function resolveRouting(input: {
  organizationId: string;
  queueId?: string | null;
  skill?: string | null;
  language?: string | null;
  minRole?: ActorRole | null;
  useCase?: string | null;
  numberId?: string | null;
  reason?: string | null;
}) {
  const db = getRawDb();
  let queueId = input.queueId ?? null;
  if (!queueId) {
    const rules = await db
      .prepare(`SELECT queue_id, match_type, match_value, priority
        FROM routing_rules WHERE organization_id = ? AND status = 'active'`)
      .bind(input.organizationId)
      .all<{
        queue_id: string;
        match_type: string;
        match_value: string;
        priority: number;
      }>();
    queueId = selectQueue(
      (rules.results ?? []).map((rule) => ({
        queueId: rule.queue_id,
        matchType: rule.match_type,
        matchValue: rule.match_value,
        priority: Number(rule.priority ?? 100),
      })),
      {
        skill: input.skill ?? null,
        language: input.language ?? null,
        numberId: input.numberId ?? null,
        useCase: input.useCase ?? null,
        reason: input.reason ?? null,
      },
    );
  }

  let outcome = await routeToAgent({
    organizationId: input.organizationId,
    queueId,
    skill: input.skill,
    language: input.language,
    minRole: input.minRole,
  });
  let overflowedFrom: string | null = null;
  if (
    !outcome.agent &&
    outcome.queue?.overflow_action === 'overflow_queue' &&
    outcome.queue.overflow_queue_id
  ) {
    overflowedFrom = outcome.queue.slug;
    outcome = await routeToAgent({
      organizationId: input.organizationId,
      queueId: outcome.queue.overflow_queue_id,
      skill: input.skill,
      language: input.language,
      minRole: input.minRole,
    });
  }
  return { outcome, overflowedFrom };
}

/**
 * Warm transfer (§2): always record the handoff with the AI summary attached so
 * the human has context before pickup. If nobody is online the handoff is
 * queued and the caller must be told the truth.
 */
export async function initiateWarmTransfer(input: {
  organizationId: string;
  agentId?: string | null;
  sessionId?: string | null;
  reason: string;
  summary?: string | null;
  skill?: string | null;
  language?: string | null;
  minRole?: ActorRole | null;
  /** Explicit queue; omitted, the workspace's routing rules choose one. */
  queueId?: string | null;
  useCase?: string | null;
  numberId?: string | null;
}): Promise<TransferResult> {
  const db = getRawDb();
  const { outcome, overflowedFrom } = await resolveRouting({
    organizationId: input.organizationId,
    queueId: input.queueId ?? null,
    skill: input.skill,
    language: input.language,
    minRole: input.minRole,
    useCase: input.useCase ?? null,
    numberId: input.numberId ?? null,
    reason: input.reason,
  });

  const human = outcome.agent;
  const handoffId = id('handoff');
  await db
    .prepare(`INSERT INTO handoffs
      (id, organization_id, agent_id, session_id, reason, summary, status,
       assigned_agent_id, skill, language, queue_status, ai_summary,
       queue_id, enqueued_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
    .bind(
      handoffId,
      input.organizationId,
      input.agentId ?? null,
      input.sessionId ?? null,
      input.reason,
      input.summary ?? null,
      human ? 'assigned' : 'queued',
      human?.id ?? null,
      input.skill ?? null,
      input.language ?? null,
      human ? 'assigned' : 'queued',
      input.summary ?? null,
      outcome.queue?.id ?? null,
    )
    .run();

  if (human) {
    await db
      .prepare(
        `UPDATE support_agents SET active_calls = active_calls + 1,
         availability = CASE
           WHEN active_calls + 1 >= coalesce(max_concurrent_calls, 1) THEN 'busy'
           ELSE availability END,
         last_assigned_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(human.id)
      .run();
    return {
      ok: true,
      handoffId,
      transferred: true,
      agent: { id: human.id, name: human.name, role: human.role },
      queueStatus: 'assigned',
      queue: outcome.queue?.slug ?? null,
      matchTier: outcome.matchTier ?? null,
      overflowedFrom,
      message: `Connecting the caller to ${human.name}. Summary delivered before pickup.`,
    };
  }

  // Nobody available: the fallback comes from the queue's own configuration,
  // and the message must never imply a connection is happening.
  const overflow = outcome.queue?.overflow_action ?? 'callback';
  const fallback =
    overflow === 'ticket'
      ? 'ticket'
      : overflow === 'ai_continue'
        ? 'ai_continue'
        : 'callback';
  const because =
    outcome.reason === 'at_capacity'
      ? 'Every agent is already on a call'
      : outcome.reason === 'skill_unavailable'
        ? 'No online agent has the required skill'
        : outcome.reason === 'role_too_low'
          ? 'No online agent is senior enough for this case'
          : outcome.reason === 'no_members'
            ? 'This queue has no members'
            : 'No human agent is online right now';
  const guidance =
    fallback === 'ticket'
      ? 'Raise a ticket and tell the caller a specialist will follow up.'
      : fallback === 'ai_continue'
        ? 'Continue helping the caller yourself within policy; do not promise a human.'
        : 'Offer a callback instead.';
  return {
    ok: true,
    handoffId,
    transferred: false,
    queueStatus: 'queued',
    queue: outcome.queue?.slug ?? null,
    fallback,
    routingReason: outcome.reason,
    overflowedFrom,
    message: `${because}. Do not tell the caller they are being connected — ${guidance}`,
  };
}

export async function createCallbackRequest(input: {
  organizationId: string;
  sessionId?: string | null;
  customerName?: string | null;
  customerPhone: string;
  reason?: string | null;
  requestedWindow?: string | null;
}) {
  const callbackId = id('callback');
  await getRawDb()
    .prepare(`INSERT INTO callback_requests
      (id, organization_id, session_id, customer_name, customer_phone, reason, requested_window)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      callbackId,
      input.organizationId,
      input.sessionId ?? null,
      input.customerName ?? null,
      input.customerPhone,
      input.reason ?? null,
      input.requestedWindow ?? null,
    )
    .run();
  return { ok: true, callbackId, status: 'pending' };
}

export type ApprovalCard = {
  ok: boolean;
  approvalId: string;
  status: string;
  decision: ActionDecision;
  riskLevel: string;
  reasons: string[];
  policyVersion: number;
  alreadyExisted?: boolean;
};

/**
 * Approval card (§8). The policy engine decides; this only records the request
 * so an authorised human can approve or reject it.
 */
export async function createApprovalRequest(input: {
  organizationId: string;
  sessionId?: string | null;
  handoffId?: string | null;
  action: string;
  amount?: number | null;
  reason?: string | null;
  caseSummary?: string | null;
  evidence?: Record<string, unknown>;
  policy?: ActionPolicy;
  eligibility?: { passed: boolean; failed?: string[] };
  riskFlags?: string[];
  conditions?: string[];
  customerRequestedHuman?: boolean;
  aiRecommendation?: string | null;
  idempotencyKey: string;
}): Promise<ApprovalCard> {
  const verdict = evaluateAction({
    action: input.action,
    amount: input.amount ?? null,
    policy: input.policy,
    eligibility: input.eligibility,
    riskFlags: input.riskFlags,
    conditions: input.conditions,
    customerRequestedHuman: input.customerRequestedHuman,
  });
  const db = getRawDb();
  const existing = await db
    .prepare(
      `SELECT id, status, policy_decision FROM approval_requests WHERE idempotency_key = ? LIMIT 1`,
    )
    .bind(input.idempotencyKey)
    .first<{ id: string; status: string; policy_decision: string }>();
  if (existing) {
    // One card per case, but the case can change (a second attempt may now be a
    // duplicate refund). Refresh a still-pending card so the approver never
    // sees a stale decision.
    if (
      existing.status === 'pending' &&
      existing.policy_decision !== verdict.decision
    ) {
      await db
        .prepare(`UPDATE approval_requests SET policy_decision = ?, risk_level = ?,
          policy_reasons_json = ?, policy_version = ? WHERE id = ?`)
        .bind(
          verdict.decision,
          verdict.riskLevel,
          JSON.stringify(verdict.reasons),
          verdict.policyVersion,
          existing.id,
        )
        .run();
    }
    return {
      ok: true,
      approvalId: existing.id,
      status: existing.status,
      decision: verdict.decision,
      riskLevel: verdict.riskLevel,
      reasons: verdict.reasons,
      policyVersion: verdict.policyVersion,
      alreadyExisted: true,
    };
  }
  const approvalId = id('approval');
  await db
    .prepare(`INSERT INTO approval_requests
      (id, organization_id, session_id, handoff_id, action, amount, reason, case_summary,
       evidence_json, risk_level, policy_decision, policy_version, policy_reasons_json,
       ai_recommendation, status, idempotency_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
    .bind(
      approvalId,
      input.organizationId,
      input.sessionId ?? null,
      input.handoffId ?? null,
      input.action,
      typeof input.amount === 'number' ? Math.round(input.amount) : null,
      input.reason ?? null,
      input.caseSummary ?? null,
      JSON.stringify(input.evidence ?? {}),
      verdict.riskLevel,
      verdict.decision,
      verdict.policyVersion,
      JSON.stringify(verdict.reasons),
      input.aiRecommendation ?? null,
      input.idempotencyKey,
    )
    .run();
  return {
    ok: true,
    approvalId,
    status: 'pending',
    decision: verdict.decision,
    riskLevel: verdict.riskLevel,
    reasons: verdict.reasons,
    policyVersion: verdict.policyVersion,
  };
}

/** Approve / reject / ask for more info, with a role-authority check. */
export async function decideApproval(input: {
  organizationId: string;
  approvalId: string;
  outcome: 'approved' | 'rejected' | 'info_requested';
  actorRole: ActorRole;
  actorId: string;
  reason?: string | null;
}) {
  const db = getRawDb();
  const row = await db
    .prepare(
      `SELECT id, status, policy_decision FROM approval_requests WHERE id = ? AND organization_id = ? LIMIT 1`,
    )
    .bind(input.approvalId, input.organizationId)
    .first<{ id: string; status: string; policy_decision: ActionDecision }>();
  if (!row) return { ok: false, reason: 'not_found' as const };
  if (row.status !== 'pending')
    return {
      ok: false,
      reason: 'already_decided' as const,
      status: row.status,
    };
  if (
    input.outcome === 'approved' &&
    !roleCanAuthorise(input.actorRole, row.policy_decision)
  )
    return {
      ok: false,
      reason: 'insufficient_authority' as const,
      required: row.policy_decision,
    };
  await db
    .prepare(`UPDATE approval_requests SET status = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP,
      decision_reason = ? WHERE id = ? AND organization_id = ?`)
    .bind(
      input.outcome,
      input.actorId,
      input.reason ?? null,
      input.approvalId,
      input.organizationId,
    )
    .run();
  return { ok: true, status: input.outcome };
}

/**
 * Record a refund request (§5, §14). This never reports success: the row starts
 * as 'requested' and only the payment provider's confirmation may move it to
 * 'succeeded'. Idempotency keys make retries safe.
 */
export async function recordRefundRequest(input: {
  organizationId: string;
  approvalId?: string | null;
  sessionId?: string | null;
  orderReference?: string | null;
  customerPhone?: string | null;
  amount: number;
  reason?: string | null;
  policyVersion: number;
  authorisedBy: string;
  idempotencyKey: string;
}) {
  const db = getRawDb();
  const existing = await db
    .prepare(`SELECT id, status FROM refunds WHERE idempotency_key = ? LIMIT 1`)
    .bind(input.idempotencyKey)
    .first<{ id: string; status: string }>();
  if (existing)
    return {
      ok: true,
      refundId: existing.id,
      status: existing.status,
      confirmed: existing.status === 'succeeded',
      alreadyExisted: true,
    };
  const refundId = id('refund');
  await db
    .prepare(`INSERT INTO refunds
      (id, organization_id, approval_id, session_id, order_reference, customer_phone,
       amount, reason, status, policy_version, authorised_by, idempotency_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?)`)
    .bind(
      refundId,
      input.organizationId,
      input.approvalId ?? null,
      input.sessionId ?? null,
      input.orderReference ?? null,
      input.customerPhone ?? null,
      Math.round(input.amount),
      input.reason ?? null,
      input.policyVersion,
      input.authorisedBy,
      input.idempotencyKey,
    )
    .run();
  return {
    ok: true,
    refundId,
    status: 'requested',
    confirmed: false,
    note: 'Refund recorded. Tell the caller it is submitted — never that it is done — until the payment provider confirms.',
  };
}
