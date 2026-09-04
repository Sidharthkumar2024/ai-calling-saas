import {
  applyRounding,
  convert,
  isCurrency,
  type Rounding,
} from './currency.ts';

/**
 * Country price books (§26).
 *
 * Plans and credit packages are stored once, in the platform's base currency.
 * A workspace in another country needs a price in *its* currency, and there are
 * only two honest ways to get one:
 *
 *  1. Somebody decided it. A price book entry is an explicit decision — "Growth
 *     is $119 in the US" — and it wins over any arithmetic, because a rounded
 *     conversion is not a pricing strategy.
 *  2. Nobody decided it, so convert, apply the FX markup, and round to
 *     something that looks like a price rather than a conversion.
 *
 * The result always says which of the two happened. A converted price that
 * moves when the rupee moves is a very different thing from a price somebody
 * set, and a billing screen that cannot tell them apart will eventually show a
 * customer a number nobody intended.
 *
 * Pure: the caller supplies the entries and the rate.
 */

export type PriceBookEntry = {
  /** 'plan' or 'credit_package'. */
  productType: string;
  productId: string;
  country: string;
  currency: string;
  /** Price in minor units of `currency`. */
  amountMinor: number;
  active?: boolean;
};

export type PriceResolution =
  | {
      ok: true;
      amountMinor: number;
      currency: string;
      /** 'price_book' when someone set it; 'converted' when we derived it. */
      source: 'base' | 'price_book' | 'converted';
      /** Present only for a converted price, so the number can be explained. */
      rate?: number;
      markupPercent?: number;
      /** True when the price is a conversion that will move with the rate. */
      derived: boolean;
    }
  | { ok: false; reason: string };

export type ResolvePriceInput = {
  productType: string;
  productId: string;
  /** The stored price, in the platform's base currency. */
  baseAmountMinor: number;
  baseCurrency: string;
  targetCurrency: string;
  /** ISO country of the workspace, for selecting a price book entry. */
  country?: string | null;
  entries?: PriceBookEntry[];
  rate?: number | null;
  markupPercent?: number | null;
  rounding?: Rounding;
};

/**
 * The price to charge a workspace, and where it came from.
 */
export function resolvePrice(input: ResolvePriceInput): PriceResolution {
  const target = String(input.targetCurrency ?? '').toUpperCase();
  const base = String(input.baseCurrency ?? '').toUpperCase();
  if (!isCurrency(target) || !isCurrency(base))
    return { ok: false, reason: 'unsupported_currency' };
  if (!Number.isFinite(input.baseAmountMinor) || input.baseAmountMinor < 0)
    return { ok: false, reason: 'invalid_base_amount' };

  const country = String(input.country ?? '').toUpperCase();
  const entry = (input.entries ?? []).find(
    (candidate) =>
      candidate.active !== false &&
      candidate.productType === input.productType &&
      candidate.productId === input.productId &&
      candidate.currency.toUpperCase() === target &&
      // A country-specific entry is preferred; an entry with no country is a
      // currency-wide default, which is still an explicit decision.
      (!candidate.country || candidate.country.toUpperCase() === country),
  );
  if (entry)
    return {
      ok: true,
      amountMinor: Math.round(entry.amountMinor),
      currency: target,
      source: 'price_book',
      derived: false,
    };

  if (target === base)
    return {
      ok: true,
      amountMinor: Math.round(input.baseAmountMinor),
      currency: base,
      source: 'base',
      derived: false,
    };

  const converted = convert({
    amountMinor: input.baseAmountMinor,
    from: base,
    to: target,
    rate: input.rate,
    markupPercent: input.markupPercent,
    rounding: input.rounding ?? 'psychological',
  });
  if (!converted.ok) return { ok: false, reason: converted.reason };
  return {
    ok: true,
    amountMinor: converted.amountMinor,
    currency: target,
    source: 'converted',
    rate: converted.rate,
    markupPercent: converted.markupPercent,
    derived: true,
  };
}

/**
 * A short line explaining a resolved price, for the billing screen.
 *
 * Shown because a converted price is provisional in a way a set one is not: it
 * will move with the exchange rate, and a customer who is told the number is
 * fixed will be surprised next month.
 */
export function explainPrice(resolution: PriceResolution): string {
  if (!resolution.ok) return 'This price could not be determined.';
  if (resolution.source === 'price_book')
    return 'Set for your country in the price book.';
  if (resolution.source === 'base') return 'Charged in the platform currency.';
  const markup = resolution.markupPercent
    ? ` including a ${resolution.markupPercent}% currency margin`
    : '';
  return `Converted at ${resolution.rate}${markup}; it moves with the exchange rate.`;
}

/**
 * Rounds a set of prices with one policy, for previewing a price book before
 * anyone commits to it.
 */
export function previewRounding(
  amountsMinor: number[],
  currency: string,
  rounding: Rounding,
) {
  return (amountsMinor ?? []).map((amount) =>
    applyRounding(amount, currency, rounding),
  );
}
