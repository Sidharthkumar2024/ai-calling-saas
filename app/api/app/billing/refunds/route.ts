import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import { recordAudit } from '@/lib/demo-seed';
import {
  DEFAULT_REFUND_POLICY,
  evaluateAction,
  roleCanAuthorise,
} from '@/lib/action-policy';
import {
  createApprovalRequest,
  recordRefundRequest,
  resolveActorRole,
} from '@/lib/handoff-service';
import { executeRefund } from '@/lib/refund-execution';

export const dynamic = 'force-dynamic';

/**
 * Manual refund against a tenant payment (§23).
 *
 * This route used to take a bare `requireCustomer` and post straight to the
 * provider's refund API. Every control the product has around moving a
 * customer's money — the risk matrix in `lib/action-policy.ts`, the authority
 * matrix, the approval queue, the audit trail — was reachable only through the
 * AI's tool path, and this one endpoint went around all of it. Any workspace
 * member, including a read-only analyst, could refund up to the full value of
 * any matched payment.
 *
 * Now it goes through the same engine as everything else: the policy decides,
 * the actor's role decides whether they may finalise that decision, and
 * anything above their authority becomes an approval card instead of a refund.
 */
export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'billing.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const organizationId = auth.session.organizationId!;
  const body = (await request.json()) as {
    paymentId?: string;
    amount?: number;
    reason?: string;
  };
  const amount = Math.round(Number(body.amount || 0));
  if (!body.paymentId || amount < 100)
    return NextResponse.json(
      { error: 'Payment ID and refund amount are required.' },
      { status: 400 },
    );

  const payment = await getRawDb()
    .prepare(
      `SELECT id, amount FROM payment_reconciliations
       WHERE organization_id = ? AND external_id = ? AND provider = 'razorpay'
         AND status = 'matched'`,
    )
    .bind(organizationId, body.paymentId)
    .first<{ id: string; amount: number }>();
  if (!payment || amount > payment.amount)
    return NextResponse.json(
      { error: 'A matched tenant payment with sufficient amount is required.' },
      { status: 409 },
    );

  // Deterministic eligibility, computed from rows rather than asserted by the
  // caller: a second refund against the same payment is a restricted condition.
  const priorRefund = await getRawDb()
    .prepare(
      `SELECT id FROM refunds WHERE organization_id = ? AND order_reference = ?
         AND status NOT IN ('failed', 'cancelled') LIMIT 1`,
    )
    .bind(organizationId, body.paymentId)
    .first<{ id: string }>();

  const role = await resolveActorRole(organizationId, auth.session.userId);
  const decision = evaluateAction({
    action: 'refund',
    amount,
    policy: DEFAULT_REFUND_POLICY,
    conditions: priorRefund ? ['duplicate_refund'] : [],
    eligibility: {
      passed: !priorRefund,
      failed: priorRefund ? ['duplicate_refund'] : [],
    },
  });

  if (decision.decision === 'blocked')
    return NextResponse.json(
      { error: decision.reasons.join(' '), decision: decision.decision },
      { status: 409 },
    );

  // Above this person's authority: raise the card the approvals queue already
  // knows how to decide, rather than refusing with nothing to act on.
  if (!roleCanAuthorise(role, decision.decision)) {
    const approval = await createApprovalRequest({
      organizationId,
      action: 'refund',
      amount,
      reason: body.reason?.slice(0, 200) || 'Manual refund',
      evidence: { order_reference: body.paymentId },
      conditions: priorRefund ? ['duplicate_refund'] : [],
      eligibility: {
        passed: !priorRefund,
        failed: priorRefund ? ['duplicate_refund'] : [],
      },
      idempotencyKey: `approval:refund:${organizationId}:${body.paymentId}:${amount}`,
    });
    await recordAudit(
      auth.session,
      'refund.approval_requested',
      'approval_request',
      approval.approvalId,
      { amount, decision: decision.decision },
    );
    return NextResponse.json(
      {
        queued: true,
        decision: decision.decision,
        riskLevel: decision.riskLevel,
        approval,
        message:
          'This refund needs approval at your authority level; it is waiting in Approvals.',
      },
      { status: 202 },
    );
  }

  const recorded = await recordRefundRequest({
    organizationId,
    orderReference: body.paymentId,
    amount,
    reason: body.reason?.slice(0, 200) || 'Manual refund',
    policyVersion: decision.policyVersion,
    authorisedBy: `${role}:${auth.session.userId}`,
    idempotencyKey: `refund:manual:${organizationId}:${body.paymentId}:${amount}`,
  });
  const execution = await executeRefund({
    organizationId,
    refundId: recorded.refundId,
  });
  await recordAudit(
    auth.session,
    execution.confirmed
      ? 'refund.confirmed'
      : execution.ok
        ? 'refund.submitted'
        : 'refund.submission_failed',
    'refund',
    execution.refundId,
    { amount, status: execution.status, decision: decision.decision },
  );
  return NextResponse.json(
    {
      refundId: execution.refundId,
      providerReference: execution.providerReference ?? null,
      status: execution.status,
      // Never "done" until the provider says so (§22).
      confirmed: execution.confirmed,
      decision: decision.decision,
      riskLevel: decision.riskLevel,
      ...(execution.reason ? { note: execution.reason } : {}),
    },
    { status: execution.ok ? 201 : 502 },
  );
}
