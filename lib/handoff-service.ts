import { getRawDb } from '@/db/index';
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
 * Routing (§3): skill first, then language, then least busy. Only online agents
 * are eligible. Returns null when nobody is available — the caller must then
 * offer a truthful fallback instead of pretending the transfer worked.
 */
export async function findAvailableAgent(input: {
  organizationId: string;
  skill?: string | null;
  language?: string | null;
  minRole?: ActorRole | null;
}): Promise<AvailableAgent | null> {
  const rows = await getRawDb()
    .prepare(`SELECT id, name, role, skills_json, languages_json, active_calls
      FROM support_agents
      WHERE organization_id = ? AND availability = 'online'
      ORDER BY active_calls ASC, updated_at ASC`)
    .bind(input.organizationId)
    .all<{
      id: string;
      name: string;
      role: string;
      skills_json: string;
      languages_json: string;
      active_calls: number;
    }>();
  const minRank = input.minRole ? (ROLE_RANK[input.minRole] ?? 1) : 1;
  const candidates = (rows.results ?? [])
    .map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      skills: jsonArray(row.skills_json),
      languages: jsonArray(row.languages_json),
      activeCalls: Number(row.active_calls ?? 0),
    }))
    .filter((agent) => (ROLE_RANK[agent.role] ?? 1) >= minRank);
  if (!candidates.length) return null;

  const skill = input.skill?.trim().toLowerCase() || '';
  const language = input.language?.trim().toLowerCase() || '';
  const matches = (agent: AvailableAgent) => {
    const skillOk =
      !skill || agent.skills.some((item) => item.toLowerCase() === skill);
    const langOk =
      !language ||
      agent.languages.some((item) => item.toLowerCase() === language);
    return { skillOk, langOk };
  };
  // Skill + language, then skill only, then language only, then anyone.
  return (
    candidates.find((agent) => {
      const m = matches(agent);
      return m.skillOk && m.langOk;
    }) ??
    candidates.find((agent) => matches(agent).skillOk) ??
    candidates.find((agent) => matches(agent).langOk) ??
    candidates[0]
  );
}

export type TransferResult = {
  ok: boolean;
  handoffId: string;
  /** True only when a named human actually took the assignment. */
  transferred: boolean;
  agent?: { id: string; name: string; role: string };
  queueStatus: 'assigned' | 'queued';
  fallback?: 'callback' | 'ticket';
  message: string;
};

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
}): Promise<TransferResult> {
  const human = await findAvailableAgent({
    organizationId: input.organizationId,
    skill: input.skill,
    language: input.language,
    minRole: input.minRole,
  });
  const handoffId = id('handoff');
  await getRawDb()
    .prepare(`INSERT INTO handoffs
      (id, organization_id, agent_id, session_id, reason, summary, status,
       assigned_agent_id, skill, language, queue_status, ai_summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
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
    )
    .run();
  if (human) {
    await getRawDb()
      .prepare(
        `UPDATE support_agents SET active_calls = active_calls + 1, availability = 'busy',
         updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .bind(human.id)
      .run();
    return {
      ok: true,
      handoffId,
      transferred: true,
      agent: { id: human.id, name: human.name, role: human.role },
      queueStatus: 'assigned',
      message: `Connecting the caller to ${human.name}. Summary delivered before pickup.`,
    };
  }
  return {
    ok: true,
    handoffId,
    transferred: false,
    queueStatus: 'queued',
    fallback: 'callback',
    message:
      'No human agent is online right now. Do not tell the caller they are being connected — offer a callback or raise a ticket instead.',
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
    return { ok: false, reason: 'already_decided' as const, status: row.status };
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
    .prepare(
      `SELECT id, status FROM refunds WHERE idempotency_key = ? LIMIT 1`,
    )
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
