import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { getRazorpayWebhookSecret } from '@/lib/commerce';
import { releaseOrder } from '@/lib/order-service';
import { settleRefundFromProvider } from '@/lib/refund-execution';
import { sha256 } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-razorpay-signature');
  let payload: RazorpayWebhook;
  try {
    payload = JSON.parse(rawBody) as RazorpayWebhook;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }
  const db = getRawDb();
  const externalId = payload.payload?.payment_link?.entity?.id;
  // A refund event carries no payment link, so the tenant is resolved from the
  // refund we submitted. Doing this before signature verification is required —
  // the secret is per tenant — and safe: an unknown reference is refused, and
  // nothing is written until the signature checks out.
  const refundEntity = payload.payload?.refund?.entity;
  const payment = externalId
    ? await db
        .prepare(
          'SELECT id, organization_id FROM payment_links WHERE external_payment_link_id = ? LIMIT 1',
        )
        .bind(externalId)
        .first<{ id: string; organization_id: string }>()
    : null;
  const refundOwner = refundEntity?.id
    ? await db
        .prepare(
          'SELECT id, organization_id FROM refunds WHERE provider_reference = ? LIMIT 1',
        )
        .bind(refundEntity.id)
        .first<{ id: string; organization_id: string }>()
    : null;
  const organizationId =
    payment?.organization_id ?? refundOwner?.organization_id;
  if (!organizationId)
    return NextResponse.json(
      { error: 'The event does not match a known payment link or refund.' },
      { status: 404 },
    );
  const secret = await getRazorpayWebhookSecret(organizationId);
  if (
    !secret ||
    !signature ||
    !(await verifyHmac(rawBody, secret, signature))
  ) {
    return NextResponse.json(
      { error: 'Webhook signature is invalid.' },
      { status: 401 },
    );
  }
  const eventId =
    request.headers.get('x-razorpay-event-id') || (await sha256(rawBody));
  const duplicate = await db
    .prepare(
      'SELECT id FROM billing_events WHERE external_event_id = ? LIMIT 1',
    )
    .bind(eventId)
    .first();
  if (duplicate) return NextResponse.json({ received: true, duplicate: true });

  // §22: a refund is only "succeeded" when the provider says so. This is that
  // confirmation for refunds that were not settled instantly at submission.
  if (refundOwner && payload.event?.startsWith('refund.')) {
    const outcome = payload.event === 'refund.failed' ? 'failed' : 'succeeded';
    if (
      payload.event === 'refund.processed' ||
      payload.event === 'refund.failed'
    ) {
      const settled = await settleRefundFromProvider({
        providerReference: refundEntity!.id!,
        outcome,
        failureReason: refundEntity?.error_description ?? null,
      });
      await db
        .prepare(`INSERT INTO billing_events
          (id, external_event_id, event_type, payload_json) VALUES (?, ?, ?, ?)`)
        .bind(`billing_${crypto.randomUUID()}`, eventId, payload.event, rawBody)
        .run();
      return NextResponse.json({
        received: true,
        refund: outcome,
        settled: settled.changed,
      });
    }
    // Other refund events (created, speed_changed) are recorded, not acted on.
    await db
      .prepare(`INSERT INTO billing_events
        (id, external_event_id, event_type, payload_json) VALUES (?, ?, ?, ?)`)
      .bind(`billing_${crypto.randomUUID()}`, eventId, payload.event, rawBody)
      .run();
    return NextResponse.json({ received: true, refund: 'noted' });
  }

  if (!payment)
    return NextResponse.json(
      { error: 'Payment link is unknown.' },
      { status: 404 },
    );
  const status = mapStatus(payload.event);
  const paymentEntity = payload.payload?.payment?.entity;
  const reconciliationId = paymentEntity?.id;
  await db.batch([
    db
      .prepare(`INSERT INTO billing_events
        (id, external_event_id, event_type, payload_json) VALUES (?, ?, ?, ?)`)
      .bind(
        `billing_${crypto.randomUUID()}`,
        eventId,
        payload.event || 'unknown',
        rawBody,
      ),
    db
      .prepare(`UPDATE payment_links SET status = ?, paid_at = CASE WHEN ? = 'paid'
        THEN CURRENT_TIMESTAMP ELSE paid_at END WHERE id = ?`)
      .bind(status, status, payment.id),
    ...(reconciliationId
      ? [
          db
            .prepare(`INSERT INTO payment_reconciliations
      (id, organization_id, provider, external_id, entity_type, entity_id, amount, currency, status, mismatch_reason)
      VALUES (?, ?, 'razorpay', ?, 'payment_link', ?, ?, ?, ?, ?)
      ON CONFLICT(provider, external_id) DO UPDATE SET status=excluded.status,
      amount=excluded.amount, currency=excluded.currency, mismatch_reason=excluded.mismatch_reason,
      reconciled_at=CURRENT_TIMESTAMP`)
            .bind(
              `reconciliation_${crypto.randomUUID()}`,
              payment.organization_id,
              reconciliationId,
              payment.id,
              Number(paymentEntity?.amount || 0),
              paymentEntity?.currency || 'INR',
              status === 'paid' ? 'matched' : 'pending',
              status === 'paid' ? null : `Awaiting final state: ${status}`,
            ),
        ]
      : []),
  ]);
  // §9: this is the only place an order becomes paid and a digital entitlement
  // opens. The signature has been verified and the event de-duplicated above;
  // nothing earlier in the flow — not creating the link, not the customer
  // saying they paid — may release anything.
  let fulfilment: Record<string, unknown> | null = null;
  if (status === 'paid') {
    const order = await db
      .prepare(
        `SELECT id FROM orders WHERE payment_link_id = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(payment.id, organizationId)
      .first<{ id: string }>();
    if (order) {
      const released = await releaseOrder({
        organizationId,
        orderId: order.id,
      });
      fulfilment = {
        orderId: order.id,
        downloadsReleased: released.released,
        alreadyPaid: released.alreadyPaid,
        // Stock was checked when the order was placed and again here. A
        // shortfall now is a fulfilment problem for a human, not something to
        // hide: the money has already arrived.
        ...(released.inventoryShortfalls.length
          ? { outOfStock: released.inventoryShortfalls }
          : {}),
      };
    }
  }

  return NextResponse.json({
    received: true,
    status,
    ...(fulfilment ? { fulfilment } : {}),
  });
}

type RazorpayWebhook = {
  event?: string;
  payload?: {
    payment_link?: { entity?: { id?: string } };
    payment?: { entity?: { id?: string; amount?: number; currency?: string } };
    refund?: {
      entity?: { id?: string; amount?: number; error_description?: string };
    };
  };
};

function mapStatus(event?: string) {
  if (event === 'payment_link.paid') return 'paid';
  if (event === 'payment_link.partially_paid') return 'partially_paid';
  if (event === 'payment_link.cancelled') return 'cancelled';
  if (event === 'payment_link.expired') return 'expired';
  return 'processing';
}

async function verifyHmac(rawBody: string, secret: string, expected: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const actual = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  if (actual.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < actual.length; index += 1)
    mismatch |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return mismatch === 0;
}
