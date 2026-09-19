import { NextResponse } from 'next/server';
import Stripe from 'stripe';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { applyCreditPurchase, applyPlanPurchase } from '@/lib/billing';
import { readPlatformSecret } from '@/lib/platform-secrets';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const stored = await readPlatformSecret('stripe');
  const stripeKey = process.env.STRIPE_SECRET_KEY || stored.apiKey;
  const webhookSecret =
    process.env.STRIPE_WEBHOOK_SECRET || stored.secrets.webhookSecret;
  if (!stripeKey || !webhookSecret) {
    return NextResponse.json(
      { error: 'Stripe webhook is not configured.' },
      { status: 503 },
    );
  }
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json(
      { error: 'Stripe signature is required.' },
      { status: 400 },
    );
  }

  const stripe = new Stripe(stripeKey);
  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      webhookSecret,
    );
  } catch {
    return NextResponse.json(
      { error: 'Invalid Stripe signature.' },
      { status: 400 },
    );
  }

  await ensureSchema();
  const db = getRawDb();
  const processed = await db
    .prepare('SELECT id FROM billing_events WHERE external_event_id = ?')
    .bind(event.id)
    .first();
  if (processed) return NextResponse.json({ received: true, duplicate: true });

  if (
    event.type === 'checkout.session.completed' ||
    event.type === 'checkout.session.async_payment_succeeded'
  ) {
    const checkout = event.data.object;
    if (
      checkout.payment_status !== 'paid' &&
      checkout.payment_status !== 'no_payment_required'
    )
      return NextResponse.json({ received: true, pending: true });
    const organizationId = checkout.metadata?.organizationId;
    const purchaseType = checkout.metadata?.purchaseType;
    if (!organizationId || !purchaseType) {
      return NextResponse.json(
        { error: 'Checkout metadata is incomplete.' },
        { status: 400 },
      );
    }
    if (purchaseType === 'credits') {
      await applyCreditPurchase({
        organizationId,
        credits: Number(checkout.metadata?.credits ?? 0),
        amount: checkout.amount_total ?? 0,
        description: 'Stripe credit top-up',
        externalId: checkout.id,
      });
    } else if (purchaseType === 'plan' && checkout.metadata?.planId) {
      await applyPlanPurchase({
        organizationId,
        planId: checkout.metadata.planId,
        externalCheckoutId: checkout.id,
        amount: checkout.amount_total ?? 0,
        externalCustomerId:
          typeof checkout.customer === 'string'
            ? checkout.customer
            : checkout.customer?.id,
        externalSubscriptionId:
          typeof checkout.subscription === 'string'
            ? checkout.subscription
            : checkout.subscription?.id,
      });
    }
  }

  if (
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    const subscription = event.data.object as Stripe.Subscription;
    const periodEnd = subscription.items.data.reduce(
      (latest, item) => Math.max(latest, item.current_period_end ?? 0),
      0,
    );
    await db
      .prepare(
        `UPDATE subscriptions SET status = ?, current_period_end = coalesce(?, current_period_end)
         WHERE external_subscription_id = ?`,
      )
      .bind(
        event.type === 'customer.subscription.deleted'
          ? 'discontinued'
          : subscriptionState(subscription.status),
        periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        subscription.id,
      )
      .run();
  }

  if (event.type === 'invoice.payment_failed' || event.type === 'invoice.paid') {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = invoiceSubscriptionId(invoice);
    if (subscriptionId) {
      await db
        .prepare(
          `UPDATE subscriptions SET status = ? WHERE external_subscription_id = ?`,
        )
        .bind(event.type === 'invoice.paid' ? 'active' : 'inactive', subscriptionId)
        .run();
    }
  }

  await db
    .prepare(
      `INSERT OR IGNORE INTO billing_events (id, external_event_id, event_type, payload_json)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(
      `billing_event_${crypto.randomUUID()}`,
      event.id,
      event.type,
      JSON.stringify({ livemode: event.livemode, created: event.created }),
    )
    .run();
  return NextResponse.json({ received: true });
}

function subscriptionState(status: Stripe.Subscription.Status) {
  if (status === 'active' || status === 'trialing') return 'active';
  if (status === 'paused') return 'suspended';
  if (status === 'canceled') return 'discontinued';
  return 'inactive';
}

function invoiceSubscriptionId(invoice: Stripe.Invoice) {
  const raw = invoice as unknown as {
    subscription?: string | { id?: string } | null;
    parent?: {
      subscription_details?: { subscription?: string | { id?: string } | null };
    } | null;
  };
  const subscription =
    raw.subscription ?? raw.parent?.subscription_details?.subscription;
  return typeof subscription === 'string' ? subscription : subscription?.id;
}
