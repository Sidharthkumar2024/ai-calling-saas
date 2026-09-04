/**
 * Tax and invoice numbering (§27).
 *
 * What was here before: `tax = Math.round(amount * 0.18)` and an invoice number
 * of `VAI-${year}-${Date.now().slice(-8)}`. The tax was a flat 18% with no
 * split, no GSTIN on either party, no HSN/SAC and no place of supply — not an
 * invoice anyone's accountant would accept. The number was derived from a
 * timestamp, so it was neither sequential nor per-tenant, and two purchases in
 * the same millisecond would collide on a UNIQUE index.
 *
 * The rule that shapes this file: **whether GST splits into CGST+SGST or lands
 * as IGST depends on where the supply happens, not on the amount.** Same state
 * as the supplier means two half-rate components; a different state means one
 * full-rate component; outside India is a zero-rated export of services. A flat
 * 18% is right in exactly one of those three cases and silently wrong in the
 * other two.
 *
 * Pure: no database, no clock beyond what is passed in.
 */

/** Place of supply. India needs the state; elsewhere the country is enough. */
export const INDIAN_STATE_CODES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
};

/**
 * A GSTIN is `<2-digit state><10-char PAN><entity digit>Z<checksum>`.
 * Validated for shape only — the checksum needs the official algorithm, and a
 * wrong-but-well-formed number is the registrar's problem, not ours.
 */
const GSTIN_PATTERN = /^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function isGstin(value: unknown): value is string {
  return (
    typeof value === 'string' && GSTIN_PATTERN.test(value.trim().toUpperCase())
  );
}

/** The state a GSTIN belongs to, which is its first two digits. */
export function gstinState(gstin: string): string | null {
  if (!isGstin(gstin)) return null;
  const code = gstin.trim().slice(0, 2);
  return code in INDIAN_STATE_CODES ? code : null;
}

export type TaxKind = 'cgst_sgst' | 'igst' | 'zero_rated' | 'none';

export type TaxInput = {
  /** Taxable value in minor units. */
  amountMinor: number;
  /** Total GST rate, e.g. 18 for 18%. */
  ratePercent: number;
  /** Two-digit state code of the supplier's registration. */
  supplierState?: string | null;
  /** Two-digit state code where the supply is made. */
  placeOfSupplyState?: string | null;
  /** ISO country of supply. Anything but IN is an export of services. */
  placeOfSupplyCountry?: string | null;
};

export type TaxResult = {
  kind: TaxKind;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  totalTaxMinor: number;
  ratePercent: number;
  /** Why this split was chosen, for the invoice footer and for auditing. */
  reason: string;
};

/**
 * Splits GST according to where the supply happens.
 *
 * The halves are computed so they always add back to the total: CGST is
 * rounded and SGST is the remainder, rather than both being rounded
 * independently and drifting a paisa apart on odd amounts.
 */
export function computeGst(input: TaxInput): TaxResult {
  const amount = Math.round(Number(input.amountMinor));
  const rate = Number(input.ratePercent);
  const zero: TaxResult = {
    kind: 'none',
    cgstMinor: 0,
    sgstMinor: 0,
    igstMinor: 0,
    totalTaxMinor: 0,
    ratePercent: 0,
    reason: 'No tax applied.',
  };
  if (!Number.isFinite(amount) || amount <= 0) return zero;
  if (!Number.isFinite(rate) || rate <= 0) return zero;

  const country = String(input.placeOfSupplyCountry ?? 'IN').toUpperCase();
  if (country !== 'IN')
    return {
      ...zero,
      kind: 'zero_rated',
      ratePercent: 0,
      reason: `Export of services to ${country}; zero-rated under GST.`,
    };

  const supplier = normaliseState(input.supplierState);
  const place = normaliseState(input.placeOfSupplyState);
  const total = Math.round((amount * rate) / 100);

  // Without a place of supply the conservative answer is IGST: it is the full
  // rate, so it never under-collects, and it is the correct treatment whenever
  // the customer turns out to be in another state.
  if (!supplier || !place || supplier !== place)
    return {
      kind: 'igst',
      cgstMinor: 0,
      sgstMinor: 0,
      igstMinor: total,
      totalTaxMinor: total,
      ratePercent: rate,
      reason:
        supplier && place
          ? `Inter-state supply (${INDIAN_STATE_CODES[supplier]} → ${INDIAN_STATE_CODES[place]}); IGST at ${rate}%.`
          : `Place of supply not established; IGST at ${rate}%.`,
    };

  const cgst = Math.round(total / 2);
  // The remainder, not a second rounding: two independent halves of an odd
  // total do not add back to it.
  const sgst = total - cgst;
  return {
    kind: 'cgst_sgst',
    cgstMinor: cgst,
    sgstMinor: sgst,
    igstMinor: 0,
    totalTaxMinor: total,
    ratePercent: rate,
    reason: `Intra-state supply within ${INDIAN_STATE_CODES[supplier]}; CGST + SGST at ${rate / 2}% each.`,
  };
}

function normaliseState(value: unknown): string | null {
  // A state code is a two-digit string or a number; anything else is not a
  // place of supply and must not be stringified into one.
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const code = String(value).trim().padStart(2, '0');
  return code in INDIAN_STATE_CODES ? code : null;
}

/**
 * The Indian financial year for a date, as `2026-27`. It runs April to March,
 * so an invoice raised in February 2027 belongs to 2026-27, not 2027-28.
 */
export function financialYear(at: Date = new Date()): string {
  const year = at.getUTCFullYear();
  const startYear = at.getUTCMonth() >= 3 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/**
 * A sequential, per-series invoice number.
 *
 * Sequence numbers are required to be unbroken within a series, which is why
 * this takes the next number rather than deriving one from a clock. The old
 * `VAI-2026-${Date.now().slice(-8)}` was neither sequential nor collision-free.
 */
export function invoiceNumber(input: {
  prefix?: string;
  financialYear: string;
  sequence: number;
  /** Distinguishes tenants sharing one platform series, when needed. */
  seriesCode?: string | null;
}) {
  const prefix =
    (input.prefix || 'VAI')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 6) || 'VAI';
  const series = input.seriesCode
    ? `/${String(input.seriesCode)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 8)}`
    : '';
  const sequence = Math.max(1, Math.trunc(Number(input.sequence) || 1));
  return `${prefix}${series}/${input.financialYear}/${String(sequence).padStart(5, '0')}`;
}

export type InvoiceLineInput = {
  description: string;
  quantity: number;
  unitPriceMinor: number;
  /** HSN for goods, SAC for services. Telecom/SaaS services are 9984/9983. */
  hsnSac?: string | null;
  taxRatePercent?: number | null;
};

export type InvoiceTotals = {
  lines: Array<InvoiceLineInput & { lineTotalMinor: number; tax: TaxResult }>;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  /** Grouped for the tax summary an invoice has to print. */
  byRate: Array<{
    ratePercent: number;
    taxableMinor: number;
    taxMinor: number;
  }>;
  kind: TaxKind;
};

/**
 * Totals an invoice, taxing each line at its own rate.
 *
 * Per line rather than on the total, because a single invoice can mix rates —
 * an 18% service beside a zero-rated one — and taxing the sum would apply one
 * of them to both.
 */
export function totalInvoice(
  lines: InvoiceLineInput[],
  context: Omit<TaxInput, 'amountMinor' | 'ratePercent'> & {
    defaultRatePercent?: number;
  },
): InvoiceTotals {
  const priced = (lines ?? []).map((line) => {
    const quantity = Math.max(0, Math.trunc(Number(line.quantity) || 0));
    const unit = Math.max(0, Math.round(Number(line.unitPriceMinor) || 0));
    const lineTotalMinor = quantity * unit;
    const ratePercent = Number(
      line.taxRatePercent ?? context.defaultRatePercent ?? 18,
    );
    return {
      ...line,
      quantity,
      unitPriceMinor: unit,
      lineTotalMinor,
      tax: computeGst({ ...context, amountMinor: lineTotalMinor, ratePercent }),
    };
  });

  const subtotalMinor = priced.reduce(
    (sum, line) => sum + line.lineTotalMinor,
    0,
  );
  const taxMinor = priced.reduce(
    (sum, line) => sum + line.tax.totalTaxMinor,
    0,
  );
  const grouped = new Map<number, { taxableMinor: number; taxMinor: number }>();
  for (const line of priced) {
    const key = line.tax.ratePercent;
    const entry = grouped.get(key) ?? { taxableMinor: 0, taxMinor: 0 };
    entry.taxableMinor += line.lineTotalMinor;
    entry.taxMinor += line.tax.totalTaxMinor;
    grouped.set(key, entry);
  }
  const kinds = new Set(priced.map((line) => line.tax.kind));
  return {
    lines: priced,
    subtotalMinor,
    taxMinor,
    totalMinor: subtotalMinor + taxMinor,
    byRate: [...grouped.entries()]
      .map(([ratePercent, value]) => ({ ratePercent, ...value }))
      .sort((a, b) => a.ratePercent - b.ratePercent),
    kind: kinds.size === 1 ? [...kinds][0] : 'none',
  };
}
