import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';
import { recordAudit } from '@/lib/demo-seed';
import { decideApproval, recordRefundRequest } from '@/lib/handoff-service';
import type { ActorRole } from '@/lib/action-policy';

export const dynamic = 'force-dynamic';

/** Workspace role -> policy authority (§11 authority matrix). */
function toActorRole(workspaceRole: string): ActorRole {
  switch (workspaceRole) {
    case 'owner':
    case 'admin':
      return 'admin';
    case 'billing':
      return 'finance';
    case 'sales_manager':
      return 'manager';
    default:
      return 'support_agent';
  }
}

/** The workspace role lives on the membership row, not the auth session. */
async function resolveActorRole(
  organizationId: string,
  userId: string,
): Promise<ActorRole> {
  const row = await getRawDb()
    .prepare(
      `SELECT role FROM organization_members WHERE organization_id = ? AND user_id = ? LIMIT 1`,
    )
    .bind(organizationId, userId)
    .first<{ role: string }>();
  return toActorRole(row?.role ?? 'agent');
}

export async function GET(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  await ensureSchema();
  const db = getRawDb();
  const [approvals, handoffs, agents, callbacks, refunds] = await Promise.all([
    db
      .prepare(`SELECT id, action, amount, currency, reason, case_summary, evidence_json,
          risk_level, policy_decision, policy_version, policy_reasons_json, ai_recommendation,
          status, decided_by, decided_at, decision_reason, created_at
        FROM approval_requests WHERE organization_id = ?
        ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC LIMIT 50`)
      .bind(auth.session.organizationId)
      .all(),
    db
      .prepare(`SELECT h.id, h.reason, h.ai_summary, h.skill, h.language, h.queue_status,
          h.status, h.created_at, a.name AS agent_name, a.role AS agent_role
        FROM handoffs h LEFT JOIN support_agents a ON a.id = h.assigned_agent_id
        WHERE h.organization_id = ? ORDER BY h.created_at DESC LIMIT 30`)
      .bind(auth.session.organizationId)
      .all(),
    db
      .prepare(`SELECT id, name, role, skills_json, languages_json, availability, active_calls
        FROM support_agents WHERE organization_id = ? ORDER BY name`)
      .bind(auth.session.organizationId)
      .all(),
    db
      .prepare(`SELECT id, customer_name, customer_phone, reason, requested_window, status, created_at
        FROM callback_requests WHERE organization_id = ? ORDER BY created_at DESC LIMIT 20`)
      .bind(auth.session.organizationId)
      .all(),
    db
      .prepare(`SELECT id, order_reference, amount, status, reason, policy_version,
          authorised_by, created_at, confirmed_at
        FROM refunds WHERE organization_id = ? ORDER BY created_at DESC LIMIT 20`)
      .bind(auth.session.organizationId)
      .all(),
  ]);
  return NextResponse.json({
    approvals: approvals.results ?? [],
    handoffs: handoffs.results ?? [],
    agents: agents.results ?? [],
    callbacks: callbacks.results ?? [],
    refunds: refunds.results ?? [],
    myRole: await resolveActorRole(
      auth.session.organizationId!,
      auth.session.userId,
    ),
  });
}

export async function PATCH(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  await ensureSchema();
  const body = (await request.json()) as {
    action?: 'decide' | 'set_presence';
    approvalId?: string;
    outcome?: 'approved' | 'rejected' | 'info_requested';
    reason?: string;
    agentId?: string;
    availability?: string;
  };
  const db = getRawDb();

  if (body.action === 'set_presence') {
    if (
      !body.agentId ||
      !['online', 'busy', 'offline', 'break'].includes(body.availability ?? '')
    )
      return NextResponse.json(
        { error: 'agentId and a valid availability are required.' },
        { status: 400 },
      );
    const result = await db
      .prepare(`UPDATE support_agents SET availability = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND organization_id = ?`)
      .bind(body.availability, body.agentId, auth.session.organizationId)
      .run();
    if (!result.meta.changes)
      return NextResponse.json({ error: 'Agent not found.' }, { status: 404 });
    return NextResponse.json({ updated: true });
  }

  if (body.action === 'decide') {
    if (
      !body.approvalId ||
      !['approved', 'rejected', 'info_requested'].includes(body.outcome ?? '')
    )
      return NextResponse.json(
        { error: 'approvalId and outcome are required.' },
        { status: 400 },
      );
    const role = await resolveActorRole(
      auth.session.organizationId!,
      auth.session.userId,
    );
    const decision = await decideApproval({
      organizationId: auth.session.organizationId!,
      approvalId: body.approvalId,
      outcome: body.outcome as 'approved' | 'rejected' | 'info_requested',
      actorRole: role,
      actorId: auth.session.userId,
      reason: body.reason ?? null,
    });
    if (!decision.ok)
      return NextResponse.json(
        { error: decision.reason, required: decision.required },
        { status: decision.reason === 'insufficient_authority' ? 403 : 409 },
      );

    // An approved refund becomes a recorded, idempotent refund request. It is
    // still not "done" — only the provider may confirm that.
    let refund: unknown = null;
    if (body.outcome === 'approved') {
      const card = await db
        .prepare(`SELECT action, amount, reason, session_id, evidence_json, policy_version
          FROM approval_requests WHERE id = ? AND organization_id = ? LIMIT 1`)
        .bind(body.approvalId, auth.session.organizationId)
        .first<{
          action: string;
          amount: number | null;
          reason: string | null;
          session_id: string | null;
          evidence_json: string;
          policy_version: number;
        }>();
      if (card?.action === 'refund' && card.amount) {
        let evidence: Record<string, unknown> = {};
        try {
          evidence = JSON.parse(card.evidence_json || '{}') as Record<
            string,
            unknown
          >;
        } catch {
          evidence = {};
        }
        refund = await recordRefundRequest({
          organizationId: auth.session.organizationId!,
          approvalId: body.approvalId,
          sessionId: card.session_id,
          orderReference:
            typeof evidence.order_reference === 'string'
              ? evidence.order_reference
              : null,
          customerPhone:
            typeof evidence.customer_phone === 'string'
              ? evidence.customer_phone
              : null,
          amount: card.amount,
          reason: card.reason,
          policyVersion: card.policy_version,
          authorisedBy: `${role}:${auth.session.userId}`,
          idempotencyKey: `refund:approval:${body.approvalId}`,
        });
      }
    }

    await recordAudit(
      auth.session,
      `approval.${body.outcome}`,
      'approval_request',
      body.approvalId,
      { role, reason: body.reason ?? null },
    );
    return NextResponse.json({ decided: body.outcome, refund });
  }

  return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
}
