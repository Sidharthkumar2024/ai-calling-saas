import { getRawDb } from '@/db/index';
import { BASE_CURRENCY } from '@/lib/metering';
import {
  explainPrice,
  resolvePrice,
  type PriceBookEntry,
  type PriceResolution,
} from '@/lib/price-books';
import type { Rounding } from '@/lib/currency';

/**
 * What a given workspace pays for a plan or credit package, in its own
 * currency (§26).
 *
 * Plans are stored once in the platform's base currency. Everything that
 * charges a workspace — the checkout, the billing screen, the invoice — has to
 * agree on the answer, so they all come here rather than each doing their own
 * arithmetic. The Stripe checkout used to skip this entirely and request `inr`
 * for every customer in the world.
 */

export type WorkspacePrice = PriceResolution & { explanation: string };

async function workspaceBilling(organizationId: string) {
  const row = await getRawDb()
    .prepare(
      `SELECT coalesce(o.currency, ?) AS currency,
         coalesce(s.billing_country, 'IN') AS country,
         coalesce(s.fx_markup_percent, 0) AS markup,
         coalesce(s.price_rounding, 'psychological') AS rounding
       FROM organizations o
       LEFT JOIN organization_settings s ON s.organization_id = o.id
       WHERE o.id = ? LIMIT 1`,
    )
    .bind(BASE_CURRENCY, organizationId)
    .first<{
      currency: string;
      country: string;
      markup: number;
      rounding: string;
    }>();
  return {
    currency: (row?.currency ?? BASE_CURRENCY).toUpperCase(),
    country: (row?.country ?? 'IN').toUpperCase(),
    markup: Number(row?.markup ?? 0),
    rounding: (row?.rounding ?? 'psychological') as Rounding,
  };
}

async function priceBookEntries(currency: string) {
  const rows = await getRawDb()
    .prepare(
      `SELECT product_type, product_id, country, currency, amount_minor, active
       FROM price_books WHERE currency = ? AND active = 1`,
    )
    .bind(currency)
    .all<{
      product_type: string;
      product_id: string;
      country: string;
      currency: string;
      amount_minor: number;
      active: number;
    }>();
  return (rows.results ?? []).map<PriceBookEntry>((row) => ({
    productType: row.product_type,
    productId: row.product_id,
    country: row.country,
    currency: row.currency,
    amountMinor: row.amount_minor,
    active: row.active === 1,
  }));
}

async function fxRate(from: string, to: string) {
  if (from === to) return 1;
  const row = await getRawDb()
    .prepare(
      `SELECT rate FROM fx_rates
       WHERE base_currency = ? AND quote_currency = ? AND effective_from <= ?
       ORDER BY effective_from DESC LIMIT 1`,
    )
    .bind(from, to, new Date().toISOString())
    .first<{ rate: number }>();
  if (row?.rate) return Number(row.rate);
  const inverse = await getRawDb()
    .prepare(
      `SELECT rate FROM fx_rates
       WHERE base_currency = ? AND quote_currency = ? AND effective_from <= ?
       ORDER BY effective_from DESC LIMIT 1`,
    )
    .bind(to, from, new Date().toISOString())
    .first<{ rate: number }>();
  // An inverse is a real rate, not a guess.
  return inverse?.rate ? 1 / Number(inverse.rate) : null;
}

/**
 * Resolves one product's price for a workspace.
 *
 * Returns a failure rather than a number when there is no price book entry and
 * no exchange rate: charging the base-currency figure in a different currency
 * would bill ₹7,999 as $7,999.
 */
export async function priceForWorkspace(input: {
  organizationId: string;
  productType: 'plan' | 'credit_package';
  productId: string;
  baseAmountMinor: number;
}): Promise<WorkspacePrice> {
  const billing = await workspaceBilling(input.organizationId);
  const [entries, rate] = await Promise.all([
    priceBookEntries(billing.currency),
    fxRate(BASE_CURRENCY, billing.currency),
  ]);
  const resolution = resolvePrice({
    productType: input.productType,
    productId: input.productId,
    baseAmountMinor: input.baseAmountMinor,
    baseCurrency: BASE_CURRENCY,
    targetCurrency: billing.currency,
    country: billing.country,
    entries,
    rate,
    markupPercent: billing.markup,
    rounding: billing.rounding,
  });
  return { ...resolution, explanation: explainPrice(resolution) };
}

export { workspaceBilling };
