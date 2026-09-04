import { getRawDb } from '@/db/index';
import { getRazorpayCredentials } from '@/lib/commerce';

/**
 * Refund execution (§22, §23).
 *
 * The approval pipeline was complete up to the point where money moves and then
 * stopped: `recordRefundRequest` inserted a row with `status = 'requested'` and
 * nothing in the repository ever updated the `refunds` table again. A manager
 * could approve a refund and the customer would never receive it — the worst
 * possible shape, because every screen said the refund had been authorised.
 *
 * This is the missing half. It is the only place that calls a payment
 * provider's refund API, so the policy engine cannot be walked around by a
 * second code path.
 *
 * Two rules from §22 are load-bearing here:
 *
 *  - **Never announce success before authoritative confirmation.** A submitted
 *    refund becomes `processing`, not `succeeded`. Only the provider saying
 *    `processed` — in its own response to our call, or later in a signed
 *    webhook — moves it to `succeeded` and stamps `confirmed_at`.
 *  - **Idempotency.** A refund that already carries a provider reference is
 *    never submitted twice, however many times a retry arrives.
 */

export type RefundExecution = {
  ok: boolean;
  status: string;
  refundId: string;
  providerReference?: string | null;
  reason?: string;
  /** True only when the provider itself confirmed the money moved. */
  confirmed: boolean;
};

type RefundRow = {
  id: string;
  organization_id: string;
  order_reference: string | null;
  amount: number;
  currency: string;
  reason: string | null;
  status: string;
  provider_reference: string | null;
};

/** Terminal states never re-submit. */
const SETTLED = new Set(['succeeded', 'processing', 'failed', 'cancelled']);

/**
 * Submits an authorised refund to the tenant's payment provider and records
 * what came back. Safe to call more than once for the same refund.
 */
export async function executeRefund(input: {
  organizationId: string;
  refundId: string;
}): Promise<RefundExecution> {
  const db = getRawDb();
  const refund = await db
    .prepare(
      `SELECT id, organization_id, order_reference, amount, currency, reason,
         status, provider_reference
       FROM refunds WHERE id = ? AND organization_id = ? LIMIT 1`,
    )
    .bind(input.refundId, input.organizationId)
    .first<RefundRow>();
  if (!refund)
    return {
      ok: false,
      status: 'not_found',
      refundId: input.refundId,
      confirmed: false,
      reason: 'That refund does not exist in this workspace.',
    };
  if (refund.provider_reference || SETTLED.has(refund.status))
    return {
      ok: true,
      status: refund.status,
      refundId: refund.id,
      providerReference: refund.provider_reference,
      confirmed: refund.status === 'succeeded',
      reason: 'Already submitted; not sent again.',
    };

  // The refund has to point at a payment this workspace actually received.
  // Without that there is nothing to refund against, and guessing a payment id
  // would be a way to move someone else's money.
  const payment = refund.order_reference
    ? await db
        .prepare(
          `SELECT external_id, amount FROM payment_reconciliations
           WHERE organization_id = ? AND provider = 'razorpay' AND status = 'matched'
             AND entity_type = 'payment_link' AND external_id = ?
           LIMIT 1`,
        )
        .bind(input.organizationId, refund.order_reference)
        .first<{ external_id: string; amount: number }>()
    : null;
  if (!payment)
    return fail(
      refund,
      'No matched provider payment was found for this refund, so nothing was submitted.',
    );
  if (refund.amount > payment.amount)
    return fail(
      refund,
      'The refund is larger than the payment it refers to; nothing was submitted.',
    );

  const credentials = await getRazorpayCredentials(input.organizationId);
  if (!credentials.keyId || !credentials.keySecret)
    return {
      ok: false,
      status: refund.status,
      refundId: refund.id,
      confirmed: false,
      reason:
        'Razorpay is not connected for this workspace, so the refund stays authorised but unsent.',
    };

  let payload: {
    id?: string;
    status?: string;
    error?: { description?: string };
  };
  try {
    const response = await fetch(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(payment.external_id)}/refund`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${btoa(`${credentials.keyId}:${credentials.keySecret}`)}`,
          'content-type': 'application/json',
          // Razorpay de-duplicates on this, so a retry after a timeout cannot
          // refund twice even if our own row was not yet updated.
          'x-payment-idempotency-key': refund.id,
        },
        body: JSON.stringify({
          amount: refund.amount,
          notes: {
            reason: refund.reason?.slice(0, 200) || 'Approved refund',
            refund_id: refund.id,
            organization_id: input.organizationId,
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    payload = (await response.json()) as typeof payload;
    if (!response.ok || !payload.id)
      return fail(
        refund,
        payload.error?.description || 'The provider rejected the refund.',
      );
  } catch (error) {
    // A network failure is not a failed refund — it may well have been created.
    // Leave the row requested so a retry can settle it, and say so.
    return {
      ok: false,
      status: refund.status,
      refundId: refund.id,
      confirmed: false,
      reason: `The provider could not be reached (${error instanceof Error ? error.message : 'network error'}); the refund was not confirmed and can be retried.`,
    };
  }

  // 'processed' is Razorpay saying the money moved. Anything else is in flight.
  const confirmed = payload.status === 'processed';
  const status = confirmed ? 'succeeded' : 'processing';
  await db
    .prepare(
      `UPDATE refunds SET status = ?, provider = 'razorpay', provider_reference = ?,
         failure_reason = NULL,
         confirmed_at = CASE WHEN ? = 'succeeded' THEN CURRENT_TIMESTAMP ELSE NULL END
       WHERE id = ?`,
    )
    .bind(status, payload.id, status, refund.id)
    .run();
  await db
    .prepare(
      `INSERT INTO payment_reconciliations
         (id, organization_id, provider, external_id, entity_type, entity_id, amount, currency, status)
       VALUES (?, ?, 'razorpay', ?, 'refund', ?, ?, ?, ?)
       ON CONFLICT(provider, external_id) DO UPDATE SET status = excluded.status,
         amount = excluded.amount, reconciled_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      `reconciliation_${crypto.randomUUID()}`,
      input.organizationId,
      payload.id,
      refund.id,
      -refund.amount,
      refund.currency || 'INR',
      confirmed ? 'matched' : 'pending',
    )
    .run();

  return {
    ok: true,
    status,
    refundId: refund.id,
    providerReference: payload.id,
    confirmed,
  };
}

async function fail(
  refund: RefundRow,
  reason: string,
): Promise<RefundExecution> {
  await getRawDb()
    .prepare(
      `UPDATE refunds SET status = 'failed', failure_reason = ? WHERE id = ?`,
    )
    .bind(reason.slice(0, 300), refund.id)
    .run();
  return {
    ok: false,
    status: 'failed',
    refundId: refund.id,
    confirmed: false,
    reason,
  };
}

/**
 * Settles a refund from a provider webhook — the authoritative confirmation
 * §22 asks for when the refund was not instant. Returns whether a row moved,
 * so the caller can report an unknown reference rather than silently ignoring
 * it.
 */
export async function settleRefundFromProvider(input: {
  providerReference: string;
  outcome: 'succeeded' | 'failed';
  failureReason?: string | null;
}) {
  const result = await getRawDb()
    .prepare(
      `UPDATE refunds SET status = ?, failure_reason = ?,
         confirmed_at = CASE WHEN ? = 'succeeded' THEN CURRENT_TIMESTAMP ELSE confirmed_at END
       WHERE provider_reference = ? AND status != ?`,
    )
    .bind(
      input.outcome,
      input.outcome === 'failed'
        ? (input.failureReason ?? 'The provider reported the refund failed.')
        : null,
      input.outcome,
      input.providerReference,
      input.outcome,
    )
    .run();
  return { changed: result.meta.changes > 0 };
}
