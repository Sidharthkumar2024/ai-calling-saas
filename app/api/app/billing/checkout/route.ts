import { NextResponse } from 'next/server';
import Stripe from 'stripe';

import { getRawDb } from '@/db/index';
import { applyCreditPurchase, applyPlanPurchase } from '@/lib/billing';
import { recordAudit } from '@/lib/demo-seed';
import { requireCustomerPermission } from '@/lib/customer-rbac';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'billing.manage');
  if (auth.response) return auth.response;
  const body = (await request.json()) as {
    purchaseType?: 'credits' | 'plan';
    packageId?: string;
    planId?: string;
  };
  const organizationId = auth.session.organizationId!;
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  if (body.purchaseType === 'credits') {
    const selectedPackage = await getRawDb()
      .prepare(
        `SELECT id, name, credits, amount FROM credit_packages WHERE id = ? AND status = 'active' LIMIT 1`,
      )
      .bind(body.packageId)
      .first<{ id: string; name: string; credits: number; amount: number }>();
    if (!selectedPackage) {
      return NextResponse.json(
        { error: 'Credit package not found.' },
        { status: 404 },
      );
    }
    if (!stripeKey) {
      const result = await applyCreditPurchase({
        organizationId,
        credits: selectedPackage.credits,
        amount: selectedPackage.amount,
        description: `${selectedPackage.name} local sandbox top-up`,
        sandbox: true,
      });
      await recordAudit(
        auth.session,
        'billing.sandbox_topup',
        'invoice',
        result.invoiceId,
        {
          credits: selectedPackage.credits,
        },
      );
      return NextResponse.json({
        mode: 'local_sandbox',
        completed: true,
        ...result,
      });
    }

    const session = await createStripeSession({
      request,
      stripeKey,
      email: auth.session.email,
      organizationId,
      mode: 'payment',
      name: selectedPackage.name,
      amount: selectedPackage.amount,
      metadata: {
        purchaseType: 'credits',
        credits: String(selectedPackage.credits),
        packageId: selectedPackage.id,
      },
    });
    return NextResponse.json({ mode: 'stripe', checkoutUrl: session.url });
  }

  if (body.purchaseType === 'plan' && body.planId) {
    const plan = await getRawDb()
      .prepare(
        `SELECT id, name, monthly_price, included_credits FROM plans
         WHERE id = ? AND status = 'active'`,
      )
      .bind(body.planId)
      .first<{
        id: string;
        name: string;
        monthly_price: number;
        included_credits: number;
      }>();
    if (!plan)
      return NextResponse.json({ error: 'Plan not found.' }, { status: 404 });
    if (!stripeKey || plan.monthly_price === 0) {
      const result = await applyPlanPurchase({
        organizationId,
        planId: plan.id,
        amount: plan.monthly_price,
        sandbox: true,
      });
      await recordAudit(
        auth.session,
        'billing.sandbox_plan_changed',
        'plan',
        plan.id,
      );
      return NextResponse.json({
        mode: 'local_sandbox',
        completed: true,
        ...result,
      });
    }

    const session = await createStripeSession({
      request,
      stripeKey,
      email: auth.session.email,
      organizationId,
      mode: 'subscription',
      name: `${plan.name} plan`,
      amount: plan.monthly_price,
      metadata: {
        purchaseType: 'plan',
        planId: plan.id,
        includedCredits: String(plan.included_credits),
      },
    });
    return NextResponse.json({ mode: 'stripe', checkoutUrl: session.url });
  }

  return NextResponse.json(
    { error: 'Valid purchase type is required.' },
    { status: 400 },
  );
}

async function createStripeSession(input: {
  request: Request;
  stripeKey: string;
  email: string;
  organizationId: string;
  mode: 'payment' | 'subscription';
  name: string;
  amount: number;
  metadata: Record<string, string>;
}) {
  const stripe = new Stripe(input.stripeKey);
  const origin =
    process.env.NEXT_PUBLIC_BASE_URL || new URL(input.request.url).origin;
  const recurring =
    input.mode === 'subscription' ? { interval: 'month' as const } : undefined;
  return stripe.checkout.sessions.create({
    mode: input.mode,
    customer_email: input.email,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'inr',
          unit_amount: input.amount,
          product_data: { name: input.name },
          recurring,
        },
      },
    ],
    metadata: { organizationId: input.organizationId, ...input.metadata },
    success_url: `${origin}/app?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/app?billing=cancelled`,
  });
}
