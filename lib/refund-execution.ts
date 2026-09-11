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

  // Look before submitting.
  //
  // The row guard above stops a resubmission whenever we know the provider
  // reference. The case it cannot stop is the one the catch block below
  // describes in its own words: the provider accepted the refund and we never
  // learned of it, because the connection died first. The row stays
  // `requested` with no reference, and the next retry creates a *second*
  // refund — real money, twice.
  //
  // The header underneath used to carry a comment saying Razorpay
  // de-duplicates on it. The header it sent was not one of Razorpay's, so
  // nothing de-duplicated anything. The name is corrected below, but nothing
  // here relies on it: this asks the provider what it already has.
  //
  // Every refund this product creates carries `notes.refund_id`, so its own
  // work is recognisable among any others against the same payment.
  const known = await findSubmittedRefund(payment.external_id, refund.id, {
    keyId: credentials.keyId,
    keySecret: credentials.keySecret,
  });
  if (known) {
    await settleRefundRow(db, input.organizationId, refund, known);
    return {
      ok: true,
      status: known.status === 'processed' ? 'succeeded' : 'processing',
      refundId: refund.id,
      providerReference: known.id,
      confirmed: known.status === 'processed',
      reason:
        'This refund had already reached the provider; it was matched rather than sent again.',
    };
  }

  try {
    const response = await fetch(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(payment.external_id)}/refund`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${btoa(`${credentials.keyId}:${credentials.keySecret}`)}`,
          'content-type': 'application/json',
          // Razorpay's own idempotency header. Belt and braces behind the
          // lookup above, not the thing being relied on: the previous name,
          // `x-payment-idempotency-key`, is not a header Razorpay reads, so
          // the comment that used to sit here — that a retry could not refund
          // twice — described something that was not happening.
          'x-razorpay-idempotency-key': refund.id,
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
  await settleRefundRow(db, input.organizationId, refund, {
    id: String(payload.id),
    status: payload.status,
  });

  return {
    ok: true,
    status,
    refundId: refund.id,
    providerReference: payload.id,
    confirmed,
  };
}

/**
 * A refund this product already created against that payment, if there is one.
 *
 * Matched on `notes.refund_id`, which every refund submitted from here
 * carries, so somebody else's refund against the same payment — one raised in
 * the Razorpay dashboard, say — is not adopted as ours.
 *
 * A provider that cannot be reached returns null rather than throwing: the
 * caller then submits, which is the behaviour that was there before this
 * lookup existed. That is the honest trade — this narrows the double-refund
 * window, and a lookup that itself fails leaves the old window open rather
 * than blocking a refund somebody approved.
 */
async function findSubmittedRefund(
  paymentExternalId: string,
  refundId: string,
  credentials: { keyId: string; keySecret: string },
): Promise<{ id: string; status?: string } | null> {
  try {
    const response = await fetch(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentExternalId)}/refunds?count=100`,
      {
        headers: {
          authorization: `Basic ${btoa(`${credentials.keyId}:${credentials.keySecret}`)}`,
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as {
      items?: Array<{
        id?: string;
        status?: string;
        notes?: Record<string, unknown>;
      }>;
    };
    const mine = (body.items ?? []).find((item) => {
      const tag = item?.notes?.refund_id;
      return typeof tag === 'string' && tag === refundId && Boolean(item?.id);
    });
    return mine ? { id: String(mine.id), status: mine.status } : null;
  } catch {
    return null;
  }
}

/** One place that writes what the provider said, however we came to know it. */
async function settleRefundRow(
  db: ReturnType<typeof getRawDb>,
  organizationId: string,
  refund: RefundRow,
  provider: { id: string; status?: string },
) {
  const confirmed = provider.status === 'processed';
  const status = confirmed ? 'succeeded' : 'processing';
  await db
    .prepare(
      `UPDATE refunds SET status = ?, provider = 'razorpay', provider_reference = ?,
         failure_reason = NULL,
         confirmed_at = CASE WHEN ? = 'succeeded' THEN CURRENT_TIMESTAMP ELSE NULL END
       WHERE id = ?`,
    )
    .bind(status, provider.id, status, refund.id)
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
      organizationId,
      provider.id,
      refund.id,
      -refund.amount,
      refund.currency || 'INR',
      confirmed ? 'matched' : 'pending',
    )
    .run();
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
  organizationId: string;
  providerReference: string;
  outcome: 'succeeded' | 'failed';
  failureReason?: string | null;
}) {
  const result = await getRawDb()
    .prepare(
      // Scoped to a workspace as well as to the provider's reference. A
      // provider reference is a string that arrives in a webhook body, and
      // this moves somebody's refund to succeeded or failed; matching on it
      // alone meant an event signed by one workspace could settle another
      // workspace's refund.
      `UPDATE refunds SET status = ?, failure_reason = ?,
         confirmed_at = CASE WHEN ? = 'succeeded' THEN CURRENT_TIMESTAMP ELSE confirmed_at END
       WHERE provider_reference = ? AND organization_id = ? AND status != ?`,
    )
    .bind(
      input.outcome,
      input.outcome === 'failed'
        ? (input.failureReason ?? 'The provider reported the refund failed.')
        : null,
      input.outcome,
      input.providerReference,
      input.organizationId,
      input.outcome,
    )
    .run();
  return { changed: result.meta.changes > 0 };
}
