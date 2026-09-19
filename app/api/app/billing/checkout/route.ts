import { NextResponse } from 'next/server';
import Stripe from 'stripe';

import { getRawDb } from '@/db/index';
import { applyCreditPurchase, applyPlanPurchase } from '@/lib/billing';
import { recordAudit } from '@/lib/demo-seed';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import { priceForWorkspace } from '@/lib/workspace-pricing';
import { paymentMethod, paymentTotal } from '@/lib/payment-methods';
import { readPlatformSecret } from '@/lib/platform-secrets';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'billing.manage');
  if (auth.response) return auth.response;
  const body = (await request.json()) as {
    purchaseType?: 'credits' | 'plan';
    packageId?: string;
    planId?: string;
    paymentMethod?: string;
  };
  const organizationId = auth.session.organizationId!;
  const selectedMethod = paymentMethod(body.paymentMethod ?? 'upi');
  if (!selectedMethod)
    return NextResponse.json(
      { error: 'Choose a supported payment method.' },
      { status: 400 },
    );
  const stripeConfig = await readPlatformSecret('stripe');
  const razorpayConfig = await readPlatformSecret('razorpay');
  const stripeKey = process.env.STRIPE_SECRET_KEY || stripeConfig.apiKey;
  const razorpayKeyId =
    process.env.RAZORPAY_KEY_ID ||
    (typeof razorpayConfig.config.accountId === 'string'
      ? razorpayConfig.config.accountId
      : '');
  const razorpayKeySecret =
    process.env.RAZORPAY_KEY_SECRET || razorpayConfig.apiKey;
  // The sandbox path below credits a wallet and issues a *paid* invoice with no
  // money moving. That is right for local development and catastrophic in
  // production: a deploy that forgot STRIPE_SECRET_KEY would hand out plans and
  // credit packs for free. It is keyed on the environment, never on whether a
  // key happens to be configured.
  const sandboxAllowed = process.env.NODE_ENV !== 'production';
  // §26: what this workspace pays, in its own currency. The Stripe session used
  // to request `inr` for every customer in the world, whatever they had been
  // quoted.
  const priced = async (
    productType: 'plan' | 'credit_package',
    productId: string,
    baseAmountMinor: number,
  ) =>
    priceForWorkspace({
      organizationId,
      productType,
      productId,
      baseAmountMinor,
    });
  const paymentsUnconfigured = () =>
    NextResponse.json(
      {
        error:
          `The ${selectedMethod.gateway === 'stripe' ? 'Stripe' : 'Razorpay'} gateway is not configured on this deployment.`,
      },
      { status: 503 },
    );
  const selectedGatewayReady =
    selectedMethod.gateway === 'stripe'
      ? Boolean(stripeKey)
      : Boolean(razorpayKeyId && razorpayKeySecret);
  if (!selectedGatewayReady && !sandboxAllowed) return paymentsUnconfigured();

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
    // Resolved before the branch, not inside it. Doing this only on the Stripe
    // path meant the sandbox charged the base-currency figure whatever the
    // workspace's currency was — a ₹999 package billed as $999.
    const price = await priced(
      'credit_package',
      selectedPackage.id,
      selectedPackage.amount,
    );
    if (!price.ok)
      return NextResponse.json(
        {
          error:
            'This package has no price in your billing currency, and no exchange rate is configured to derive one.',
          reason: price.reason,
        },
        { status: 409 },
      );

    if (!selectedGatewayReady && sandboxAllowed) {
      const result = await applyCreditPurchase({
        organizationId,
        credits: selectedPackage.credits,
        amount: price.amountMinor,
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

    if (!selectedGatewayReady) return paymentsUnconfigured();
    const charge = paymentTotal(price.amountMinor, selectedMethod.feeBps);
    if (selectedMethod.gateway === 'razorpay') {
      const link = await createRazorpayBillingLink({
        request,
        keyId: razorpayKeyId!,
        keySecret: razorpayKeySecret!,
        organizationId,
        email: auth.session.email,
        name: selectedPackage.name,
        amount: charge.totalAmountMinor,
        currency: price.currency,
        metadata: {
          purchaseType: 'credits',
          credits: String(selectedPackage.credits),
          packageId: selectedPackage.id,
          paymentMethod: selectedMethod.id,
          baseAmountMinor: String(charge.baseAmountMinor),
          feeAmountMinor: String(charge.feeAmountMinor),
        },
      });
      return NextResponse.json({
        mode: 'razorpay',
        checkoutUrl: link.shortUrl,
        pricing: charge,
      });
    }
    const session = await createStripeSession({
      request,
      stripeKey,
      email: auth.session.email,
      organizationId,
      mode: 'payment',
      name: selectedPackage.name,
      amount: charge.totalAmountMinor,
      currency: price.currency,
      metadata: {
        purchaseType: 'credits',
        credits: String(selectedPackage.credits),
        packageId: selectedPackage.id,
        paymentMethod: selectedMethod.id,
        baseAmountMinor: String(charge.baseAmountMinor),
        feeAmountMinor: String(charge.feeAmountMinor),
      },
    });
    return NextResponse.json({
      mode: 'stripe',
      checkoutUrl: session.url,
      pricing: charge,
    });
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
    // Resolved before the branch, for the same reason as the credits path.
    const price = await priced('plan', plan.id, plan.monthly_price);
    if (!price.ok)
      return NextResponse.json(
        {
          error:
            'This plan has no price in your billing currency, and no exchange rate is configured to derive one.',
          reason: price.reason,
        },
        { status: 409 },
      );

    // A genuinely free plan needs no gateway, so it settles locally in any
    // environment; a priced plan without a gateway is refused above.
    if (plan.monthly_price === 0 || (!selectedGatewayReady && sandboxAllowed)) {
      const result = await applyPlanPurchase({
        organizationId,
        planId: plan.id,
        amount: price.amountMinor,
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

    if (!selectedGatewayReady) return paymentsUnconfigured();
    const charge = paymentTotal(price.amountMinor, selectedMethod.feeBps);
    if (selectedMethod.gateway === 'razorpay') {
      const link = await createRazorpayBillingLink({
        request,
        keyId: razorpayKeyId!,
        keySecret: razorpayKeySecret!,
        organizationId,
        email: auth.session.email,
        name: `${plan.name} plan`,
        amount: charge.totalAmountMinor,
        currency: price.currency,
        metadata: {
          purchaseType: 'plan',
          planId: plan.id,
          includedCredits: String(plan.included_credits),
          paymentMethod: selectedMethod.id,
          baseAmountMinor: String(charge.baseAmountMinor),
          feeAmountMinor: String(charge.feeAmountMinor),
        },
      });
      return NextResponse.json({
        mode: 'razorpay',
        checkoutUrl: link.shortUrl,
        pricing: charge,
        renewal: 'manual_monthly',
      });
    }
    const session = await createStripeSession({
      request,
      stripeKey,
      email: auth.session.email,
      organizationId,
      mode: 'subscription',
      name: `${plan.name} plan`,
      amount: charge.totalAmountMinor,
      currency: price.currency,
      metadata: {
        purchaseType: 'plan',
        planId: plan.id,
        includedCredits: String(plan.included_credits),
        paymentMethod: selectedMethod.id,
        baseAmountMinor: String(charge.baseAmountMinor),
        feeAmountMinor: String(charge.feeAmountMinor),
      },
    });
    return NextResponse.json({
      mode: 'stripe',
      checkoutUrl: session.url,
      pricing: charge,
    });
  }

  return NextResponse.json(
    { error: 'Valid purchase type is required.' },
    { status: 400 },
  );
}

async function createRazorpayBillingLink(input: {
  request: Request;
  keyId: string;
  keySecret: string;
  organizationId: string;
  email: string;
  name: string;
  amount: number;
  currency: string;
  metadata: Record<string, string>;
}) {
  const referenceId = `cv_${crypto.randomUUID()}`;
  const response = await fetch('https://api.razorpay.com/v1/payment_links', {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${input.keyId}:${input.keySecret}`)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      amount: input.amount,
      currency: input.currency.toUpperCase(),
      accept_partial: false,
      reference_id: referenceId,
      description: input.name,
      customer: { email: input.email },
      notify: { sms: false, email: false },
      reminder_enable: false,
      callback_url: `${process.env.NEXT_PUBLIC_BASE_URL || new URL(input.request.url).origin}/app?billing=success`,
      callback_method: 'get',
      notes: { organizationId: input.organizationId, ...input.metadata },
    }),
  });
  const payload = (await response.json()) as {
    id?: string;
    short_url?: string;
    error?: { description?: string };
  };
  if (!response.ok || !payload.id || !payload.short_url)
    throw new Error(
      payload.error?.description || 'Razorpay could not create checkout.',
    );
  const paymentLinkId = `payment_${crypto.randomUUID()}`;
  await getRawDb()
    .prepare(`INSERT INTO payment_links
      (id, organization_id, reference_id, customer_name, customer_phone,
       customer_email, amount, currency, description, provider,
       external_payment_link_id, short_url, status, provider_payload_json)
      VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, 'razorpay_platform_billing', ?, ?, 'created', ?)`)
    .bind(
      paymentLinkId,
      input.organizationId,
      referenceId,
      input.email,
      input.email,
      input.amount,
      input.currency.toUpperCase(),
      input.name,
      payload.id,
      payload.short_url,
      JSON.stringify({ billing: input.metadata }),
    )
    .run();
  return { id: paymentLinkId, shortUrl: payload.short_url };
}

async function createStripeSession(input: {
  request: Request;
  stripeKey: string;
  currency?: string;
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
          currency: (input.currency ?? 'INR').toLowerCase(),
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
