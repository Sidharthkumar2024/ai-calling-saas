import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import {
  financialYear,
  gstinState,
  invoiceNumber as buildInvoiceNumber,
  totalInvoice,
} from '@/lib/tax';

/** Where Vaani itself is registered, for deciding the GST split. */
const SUPPLIER_STATE = process.env.PLATFORM_GST_STATE || '27';
const SUPPLIER_GSTIN = process.env.PLATFORM_GSTIN || null;
/** SAC for "other telecommunication services", which is what this is. */
const DEFAULT_SAC = '9984';

/**
 * The next number in a series, claimed atomically.
 *
 * Sequence numbers have to be unbroken within a series, so this cannot be a
 * read-then-write: two purchases landing together would both read the same
 * value. The UPSERT increments and returns in one statement.
 */
async function nextInvoiceSequence(series: string, year: string) {
  const db = getRawDb();
  const row = await db
    .prepare(
      `INSERT INTO invoice_sequences (series, financial_year, next_value)
       VALUES (?, ?, 2)
       ON CONFLICT(series, financial_year)
         DO UPDATE SET next_value = next_value + 1
       RETURNING next_value`,
    )
    .bind(series, year)
    .first<{ next_value: number }>();
  // The row now holds the *next* value; the one claimed is one below it.
  return Math.max(1, Number(row?.next_value ?? 2) - 1);
}

/** The workspace's billing identity, which decides the tax treatment. */
async function billingProfile(organizationId: string) {
  const row = await getRawDb()
    .prepare(
      `SELECT s.gstin, s.legal_name, s.billing_state, s.billing_country,
         coalesce(o.currency, 'INR') AS currency
       FROM organizations o
       LEFT JOIN organization_settings s ON s.organization_id = o.id
       WHERE o.id = ? LIMIT 1`,
    )
    .bind(organizationId)
    .first<{
      gstin: string | null;
      legal_name: string | null;
      billing_state: string | null;
      billing_country: string | null;
      currency: string;
    }>();
  const gstin = row?.gstin ?? null;
  return {
    gstin,
    legalName: row?.legal_name ?? null,
    // A GSTIN carries its own state, and that beats a separately-typed field
    // which can disagree with it.
    state: gstinState(gstin ?? '') ?? row?.billing_state ?? null,
    country: (row?.billing_country ?? 'IN').toUpperCase(),
    currency: row?.currency ?? 'INR',
  };
}

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
  const profile = await billingProfile(input.organizationId);
  const year = financialYear();
  const sequence = await nextInvoiceSequence('VAI', year);
  const invoiceNumber = buildInvoiceNumber({ financialYear: year, sequence });
  // Was a flat 18% with no split and no place of supply. The treatment depends
  // on where the supply happens, and a flat rate is right in exactly one of
  // the three cases.
  const totals = totalInvoice(
    [
      {
        description: input.description,
        quantity: 1,
        unitPriceMinor: input.amount,
        hsnSac: DEFAULT_SAC,
      },
    ],
    {
      supplierState: SUPPLIER_STATE,
      placeOfSupplyState: profile.state,
      placeOfSupplyCountry: profile.country,
      defaultRatePercent: 18,
    },
  );
  const line = totals.lines[0];
  const tax = totals.taxMinor;
  const total = totals.totalMinor;

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
         (id, organization_id, invoice_number, sequence_number, financial_year,
          status, line_items_json, subtotal, tax, total, currency,
          tax_kind, cgst, sgst, igst, tax_note, supplier_gstin, customer_gstin,
          place_of_supply, external_invoice_id, paid_at)
         VALUES (?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .bind(
        invoiceId,
        input.organizationId,
        invoiceNumber,
        sequence,
        year,
        JSON.stringify([
          {
            description: input.description,
            quantity: 1,
            amount: input.amount,
            hsnSac: DEFAULT_SAC,
            taxRatePercent: line.tax.ratePercent,
            credits: input.credits,
            sandbox: Boolean(input.sandbox),
          },
        ]),
        input.amount,
        tax,
        total,
        profile.currency,
        line.tax.kind,
        line.tax.cgstMinor,
        line.tax.sgstMinor,
        line.tax.igstMinor,
        line.tax.reason,
        SUPPLIER_GSTIN,
        profile.gstin,
        profile.country === 'IN' ? (profile.state ?? null) : profile.country,
        input.externalId ?? null,
      ),
  ]);
  const wallet = await db
    .prepare(
      'SELECT balance FROM organization_wallets WHERE organization_id = ?',
    )
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
