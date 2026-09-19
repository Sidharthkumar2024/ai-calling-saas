import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';
import { customerUsageRates } from '@/lib/customer-usage-pricing';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const organizationId = auth.session.organizationId!;
  const db = getRawDb();
  const [
    wallet,
    subscription,
    plans,
    creditPackages,
    invoices,
    ledger,
    usageRates,
  ] =
    await Promise.all([
      db
        .prepare(
          'SELECT balance, low_balance_threshold, updated_at FROM organization_wallets WHERE organization_id = ?',
        )
        .bind(organizationId)
        .first(),
      db
        .prepare(
          `SELECT p.id, p.code, p.name, p.monthly_price, p.included_credits,
           p.max_agents, p.max_numbers, p.concurrency, p.features_json,
           p.status AS catalog_status, s.status, s.current_period_end
         FROM subscriptions s INNER JOIN plans p ON p.id = s.plan_id
         WHERE s.organization_id = ? LIMIT 1`,
        )
        .bind(organizationId)
        .first(),
      db
        .prepare(
          `SELECT * FROM plans WHERE status = 'active' ORDER BY monthly_price`,
        )
        .all(),
      db
        .prepare(
          `SELECT id, name, credits, amount FROM credit_packages WHERE status = 'active' ORDER BY amount`,
        )
        .all(),
      db
        .prepare(
          `SELECT id, invoice_number, status, subtotal, tax, total, currency,
           issued_at, paid_at, hosted_url, line_items_json
         FROM invoices WHERE organization_id = ? ORDER BY issued_at DESC LIMIT 30`,
        )
        .bind(organizationId)
        .all(),
      db
        .prepare(
          `SELECT type, amount, balance_after, description, created_at
         FROM credit_ledger WHERE organization_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 40`,
        )
        .bind(organizationId)
        .all(),
      customerUsageRates(),
    ]);

  return NextResponse.json({
    wallet,
    subscription,
    plans: plans.results,
    creditPackages: creditPackages.results,
    usageRateCard: {
      currency: 'credits',
      rates: usageRates.filter((rate) => rate.status !== 'retired'),
    },
    invoices: invoices.results,
    ledger: ledger.results,
    paymentMode: process.env.STRIPE_SECRET_KEY ? 'stripe' : 'local_sandbox',
  });
}
