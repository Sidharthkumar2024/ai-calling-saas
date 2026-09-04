/**
 * Multi-currency (§26).
 *
 * Everything in this product was INR: `DEFAULT 'INR'` on four tables, a
 * hardcoded `currency: 'inr'` in the Stripe checkout, and
 * `Intl.NumberFormat('en-IN')` in seven components. That is fine until the
 * second currency arrives, and then it is wrong everywhere at once.
 *
 * Three ideas keep it honest:
 *
 *  - **Money is stored in minor units** (paise, cents), as integers. Floating
 *    point money is a rounding bug waiting for a large enough invoice.
 *  - **Every converted amount records the rate it used.** An invoice that says
 *    "₹8,300" without saying "at 83.00 to the dollar, on this date" cannot be
 *    audited, and an FX rate that moves tomorrow would silently rewrite
 *    history.
 *  - **A missing rate is an error, not a 1:1 guess.** Treating an unknown rate
 *    as parity would quietly bill a dollar as a rupee.
 *
 * Pure: no database, no clock beyond what is passed in.
 */

export type CurrencyCode = string;

type CurrencySpec = {
  code: CurrencyCode;
  name: string;
  symbol: string;
  /** Power of ten between the major unit and the stored minor unit. */
  exponent: number;
  /** Locale used for grouping — Indian grouping differs from Western. */
  locale: string;
};

export const CURRENCIES: Record<string, CurrencySpec> = {
  INR: {
    code: 'INR',
    name: 'Indian rupee',
    symbol: '₹',
    exponent: 2,
    locale: 'en-IN',
  },
  USD: {
    code: 'USD',
    name: 'US dollar',
    symbol: '$',
    exponent: 2,
    locale: 'en-US',
  },
  EUR: { code: 'EUR', name: 'Euro', symbol: '€', exponent: 2, locale: 'de-DE' },
  GBP: {
    code: 'GBP',
    name: 'Pound sterling',
    symbol: '£',
    exponent: 2,
    locale: 'en-GB',
  },
  AED: {
    code: 'AED',
    name: 'UAE dirham',
    symbol: 'د.إ',
    exponent: 2,
    locale: 'ar-AE',
  },
  SGD: {
    code: 'SGD',
    name: 'Singapore dollar',
    symbol: 'S$',
    exponent: 2,
    locale: 'en-SG',
  },
  AUD: {
    code: 'AUD',
    name: 'Australian dollar',
    symbol: 'A$',
    exponent: 2,
    locale: 'en-AU',
  },
  // Zero-decimal: a yen is already the minor unit. Multiplying by 100 here
  // would bill a hundred times over.
  JPY: {
    code: 'JPY',
    name: 'Japanese yen',
    symbol: '¥',
    exponent: 0,
    locale: 'ja-JP',
  },
};

export const CURRENCY_CODES = Object.keys(CURRENCIES);

export function isCurrency(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && value.toUpperCase() in CURRENCIES;
}

export function currencySpec(code: string): CurrencySpec {
  return CURRENCIES[String(code ?? '').toUpperCase()] ?? CURRENCIES.INR;
}

/** Minor units per major unit — 100 for rupees, 1 for yen. */
export function minorUnits(code: string) {
  return 10 ** currencySpec(code).exponent;
}

export type Rounding = 'none' | 'nearest' | 'up' | 'psychological';

/**
 * Applies the workspace's rounding policy to a converted price.
 *
 * `psychological` rounds up to the next `…99` in the major unit, which is what
 * a price book usually wants — a converted 1,247 becoming 1,299 rather than
 * 1,247.
 */
export function applyRounding(
  minorAmount: number,
  code: string,
  rounding: Rounding = 'none',
): number {
  const scale = minorUnits(code);
  if (rounding === 'none') return Math.round(minorAmount);
  if (rounding === 'nearest') return Math.round(minorAmount / scale) * scale;
  if (rounding === 'up') return Math.ceil(minorAmount / scale) * scale;
  // psychological
  const major = Math.ceil(minorAmount / scale);
  const target = major % 100 <= 99 ? Math.ceil(major / 100) * 100 - 1 : major;
  return Math.max(target, major) * scale;
}

export type ConversionInput = {
  amountMinor: number;
  from: CurrencyCode;
  to: CurrencyCode;
  /** Units of `to` per one unit of `from`, in major units. */
  rate?: number | null;
  /** Percentage added on top, e.g. 3 for a 3% FX markup. */
  markupPercent?: number | null;
  rounding?: Rounding;
};

export type Conversion =
  | {
      ok: true;
      amountMinor: number;
      currency: CurrencyCode;
      /** Recorded so the number can be explained later. */
      rate: number;
      markupPercent: number;
      sourceAmountMinor: number;
      sourceCurrency: CurrencyCode;
    }
  | { ok: false; reason: string };

/**
 * Converts between currencies, carrying the rate used with the result.
 *
 * Handles differing exponents: 100 US cents at 83 to the dollar is 8300 paise,
 * but 100 cents to yen is 83 yen, not 8300.
 */
export function convert(input: ConversionInput): Conversion {
  const from = String(input.from ?? '').toUpperCase();
  const to = String(input.to ?? '').toUpperCase();
  if (!isCurrency(from) || !isCurrency(to))
    return { ok: false, reason: 'unsupported_currency' };
  if (!Number.isFinite(input.amountMinor))
    return { ok: false, reason: 'invalid_amount' };

  const markupPercent = Number(input.markupPercent ?? 0);
  if (!Number.isFinite(markupPercent) || markupPercent < -100)
    return { ok: false, reason: 'invalid_markup' };

  if (from === to) {
    const withMarkup = input.amountMinor * (1 + markupPercent / 100);
    return {
      ok: true,
      amountMinor: applyRounding(withMarkup, to, input.rounding),
      currency: to,
      rate: 1,
      markupPercent,
      sourceAmountMinor: Math.round(input.amountMinor),
      sourceCurrency: from,
    };
  }

  const rate = Number(input.rate);
  // No rate is not parity. Guessing 1:1 would bill a dollar as a rupee.
  if (!Number.isFinite(rate) || rate <= 0)
    return { ok: false, reason: 'no_rate_available' };

  const major = input.amountMinor / minorUnits(from);
  const converted = major * rate * (1 + markupPercent / 100) * minorUnits(to);
  return {
    ok: true,
    amountMinor: applyRounding(converted, to, input.rounding),
    currency: to,
    rate,
    markupPercent,
    sourceAmountMinor: Math.round(input.amountMinor),
    sourceCurrency: from,
  };
}

/** Formats a stored minor amount for display. */
export function formatMoney(minorAmount: number, code: string) {
  const spec = currencySpec(code);
  const value = minorAmount / minorUnits(spec.code);
  try {
    return new Intl.NumberFormat(spec.locale, {
      style: 'currency',
      currency: spec.code,
      maximumFractionDigits: spec.exponent,
    }).format(value);
  } catch {
    return `${spec.symbol}${value.toFixed(spec.exponent)}`;
  }
}

/**
 * Sell price from cost and a target margin (§28).
 *
 * `sell = cost / (1 - margin)`. A margin of 1 or more has no finite answer —
 * you cannot make 100% margin on a positive cost — so it is refused rather
 * than returned as Infinity.
 */
export function sellPriceFromMargin(
  costMinor: number,
  targetMargin: number,
): { ok: true; sellMinor: number } | { ok: false; reason: string } {
  if (!Number.isFinite(costMinor) || costMinor < 0)
    return { ok: false, reason: 'invalid_cost' };
  if (!Number.isFinite(targetMargin) || targetMargin < 0 || targetMargin >= 1)
    return { ok: false, reason: 'margin_must_be_between_0_and_1' };
  return { ok: true, sellMinor: Math.ceil(costMinor / (1 - targetMargin)) };
}

/** Gross margin as a fraction, or null when there is no revenue to divide by. */
export function grossMargin(revenueMinor: number, costMinor: number) {
  if (!Number.isFinite(revenueMinor) || revenueMinor <= 0) return null;
  if (!Number.isFinite(costMinor) || costMinor < 0) return null;
  return (revenueMinor - costMinor) / revenueMinor;
}
