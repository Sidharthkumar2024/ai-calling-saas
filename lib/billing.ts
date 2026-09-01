import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';

export const creditPackages = [
  { id: 'credits_1000', name: '1,000 credits', credits: 1_000, amount: 99900 },
  { id: 'credits_5000', name: '5,000 credits', credits: 5_000, amount: 449900 },
  { id: 'credits_20000', name: '20,000 credits', credits: 20_000, amount: 1599900 },
] as const;

export async function applyCreditPurchase(input: {
  organizationId: string;
  credits: number;
  amount: number;
  description: string;
  externalId?: string;
  sandbox?: boolean;
}) {
  await ensureSchema();
  const db = getRawDb();
  const invoiceId = `invoice_${crypto.randomUUID()}`;
  const invoiceNumber = `VAI-${new Date().getUTCFullYear()}-${String(Date.now()).slice(-8)}`;
  const tax = Math.round(input.amount * 0.18);
  const total = input.amount + tax;

  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO organization_wallets
         (organization_id, balance, low_balance_threshold)
         VALUES (?, 0, 500)`,
      )
      .bind(input.organizationId),
    db
      .prepare(
        `UPDATE organization_wallets
         SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = ?`,
      )
      .bind(input.credits, input.organizationId),
    db
      .prepare(
        `INSERT INTO invoices
         (id, organization_id, invoice_number, status, line_items_json,
          subtotal, tax, total, currency, external_invoice_id, paid_at)
         VALUES (?, ?, ?, 'paid', ?, ?, ?, ?, 'INR', ?, CURRENT_TIMESTAMP)`,
      )
      .bind(
        invoiceId,
        input.organizationId,
        invoiceNumber,
        JSON.stringify([
          {
            description: input.description,
            quantity: 1,
            amount: input.amount,
            credits: input.credits,
            sandbox: Boolean(input.sandbox),
          },
        ]),
        input.amount,
        tax,
        total,
        input.externalId ?? null,
      ),
  ]);
  const wallet = await db
    .prepare('SELECT balance FROM organization_wallets WHERE organization_id = ?')
    .bind(input.organizationId)
    .first<{ balance: number }>();
  await db
    .prepare(
      `INSERT INTO credit_ledger
       (id, organization_id, type, amount, balance_after, reference_type,
        reference_id, description)
       VALUES (?, ?, 'purchase', ?, ?, 'invoice', ?, ?)`,
    )
    .bind(
      `credit_${crypto.randomUUID()}`,
      input.organizationId,
      input.credits,
      Number(wallet?.balance ?? input.credits),
      invoiceId,
      input.description,
    )
    .run();
  return { invoiceId, invoiceNumber, balance: Number(wallet?.balance ?? 0) };
}

export async function applyPlanPurchase(input: {
  organizationId: string;
  planId: string;
  amount: number;
  externalCustomerId?: string;
  externalSubscriptionId?: string;
  sandbox?: boolean;
}) {
  await ensureSchema();
  const db = getRawDb();
  const plan = await db
    .prepare(
      `SELECT id, name, included_credits FROM plans
       WHERE id = ? AND status = 'active' LIMIT 1`,
    )
    .bind(input.planId)
    .first<{ id: string; name: string; included_credits: number }>();
  if (!plan) throw new Error('Plan not found.');

  await db
    .prepare(
      `INSERT INTO subscriptions
       (id, organization_id, plan_id, status, external_customer_id,
        external_subscription_id, current_period_end)
       VALUES (?, ?, ?, 'active', ?, ?, ?)
       ON CONFLICT (organization_id) DO UPDATE SET
         plan_id = excluded.plan_id,
         status = 'active',
         external_customer_id = coalesce(excluded.external_customer_id, subscriptions.external_customer_id),
         external_subscription_id = coalesce(excluded.external_subscription_id, subscriptions.external_subscription_id),
         current_period_end = excluded.current_period_end`,
    )
    .bind(
      `subscription_${crypto.randomUUID()}`,
      input.organizationId,
      plan.id,
      input.externalCustomerId ?? null,
      input.externalSubscriptionId ?? null,
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    )
    .run();

  return applyCreditPurchase({
    organizationId: input.organizationId,
    credits: plan.included_credits,
    amount: input.amount,
    description: `${plan.name} plan subscription`,
    externalId: input.externalSubscriptionId,
    sandbox: input.sandbox,
  });
}
