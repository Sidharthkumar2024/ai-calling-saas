import {
  computeGst,
  financialYear,
  gstinState,
  invoiceNumber,
  isGstin,
  totalInvoice,
} from '../lib/tax.ts';

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) pass++;
  else fail++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
};

console.log('GSTIN:');
ok('a well-formed GSTIN is accepted', isGstin('27AAPFU0939F1ZV'));
ok('a wrong-length one is not', !isGstin('27AAPFU0939F1Z'));
ok('a PAN is not a GSTIN', !isGstin('AAPFU0939F'));
ok(
  'the state comes from the first two digits',
  gstinState('27AAPFU0939F1ZV') === '27',
);
ok('an invalid state code yields null', gstinState('99AAPFU0939F1ZV') === null);

console.log('GST split:');
const intra = computeGst({
  amountMinor: 100000,
  ratePercent: 18,
  supplierState: '27',
  placeOfSupplyState: '27',
});
ok('same state splits into CGST and SGST', intra.kind === 'cgst_sgst');
ok(
  'the halves add back to the total',
  intra.cgstMinor + intra.sgstMinor === intra.totalTaxMinor,
);
ok('18% of ₹1,000 is ₹180', intra.totalTaxMinor === 18000);
ok('no IGST on an intra-state supply', intra.igstMinor === 0);

const odd = computeGst({
  amountMinor: 33333,
  ratePercent: 18,
  supplierState: '27',
  placeOfSupplyState: '27',
});
ok(
  'THE ROUNDING TRAP: an odd total still adds back exactly',
  odd.cgstMinor + odd.sgstMinor === odd.totalTaxMinor,
);
ok(
  'and the halves differ by at most one paisa',
  Math.abs(odd.cgstMinor - odd.sgstMinor) <= 1,
);

const inter = computeGst({
  amountMinor: 100000,
  ratePercent: 18,
  supplierState: '27',
  placeOfSupplyState: '29',
});
ok(
  'a different state is IGST at the full rate',
  inter.kind === 'igst' && inter.igstMinor === 18000,
);
ok(
  'no CGST or SGST on an inter-state supply',
  inter.cgstMinor === 0 && inter.sgstMinor === 0,
);
ok(
  'the reason names both states',
  inter.reason.includes('Maharashtra') && inter.reason.includes('Karnataka'),
);

const unknown = computeGst({
  amountMinor: 100000,
  ratePercent: 18,
  supplierState: '27',
});
ok(
  'HONEST DEFAULT: an unestablished place of supply uses IGST, which never under-collects',
  unknown.kind === 'igst' && unknown.igstMinor === 18000,
);
ok(
  'and says the place was not established',
  unknown.reason.includes('not established'),
);

const export_ = computeGst({
  amountMinor: 100000,
  ratePercent: 18,
  supplierState: '27',
  placeOfSupplyCountry: 'AE',
});
ok(
  'supply outside India is zero-rated',
  export_.kind === 'zero_rated' && export_.totalTaxMinor === 0,
);
ok('and it says so', export_.reason.includes('Export of services'));

ok(
  'a zero amount is untaxed',
  computeGst({ amountMinor: 0, ratePercent: 18 }).kind === 'none',
);
ok(
  'a zero rate is untaxed',
  computeGst({ amountMinor: 100000, ratePercent: 0 }).kind === 'none',
);
ok(
  'a negative amount is untaxed, not negatively taxed',
  computeGst({ amountMinor: -5000, ratePercent: 18 }).totalTaxMinor === 0,
);

console.log('financial year:');
ok(
  'April starts a new year',
  financialYear(new Date('2026-04-01T00:00:00Z')) === '2026-27',
);
ok(
  'March ends the previous one',
  financialYear(new Date('2027-03-31T00:00:00Z')) === '2026-27',
);
ok(
  'January belongs to the year that started last April',
  financialYear(new Date('2027-01-15T00:00:00Z')) === '2026-27',
);
ok(
  'a century roll formats two digits',
  financialYear(new Date('2099-05-01T00:00:00Z')) === '2099-00',
);

console.log('invoice numbers:');
ok(
  'sequential, padded and per financial year',
  invoiceNumber({ financialYear: '2026-27', sequence: 42 }) ===
    'VAI/2026-27/00042',
);
ok(
  'a series code separates tenants',
  invoiceNumber({
    financialYear: '2026-27',
    sequence: 1,
    seriesCode: 'urbn',
  }) === 'VAI/URBN/2026-27/00001',
);
ok(
  'a hostile prefix is stripped to safe characters',
  invoiceNumber({
    prefix: 'a/b..c',
    financialYear: '2026-27',
    sequence: 1,
  }).startsWith('ABC/'),
);
ok(
  'sequence zero becomes one, never a blank series',
  invoiceNumber({ financialYear: '2026-27', sequence: 0 }).endsWith('00001'),
);
ok(
  'THE COLLISION FIX: two numbers in the same instant differ',
  invoiceNumber({ financialYear: '2026-27', sequence: 7 }) !==
    invoiceNumber({ financialYear: '2026-27', sequence: 8 }),
);

console.log('invoice totals:');
const invoice = totalInvoice(
  [
    {
      description: 'Growth plan',
      quantity: 1,
      unitPriceMinor: 799900,
      hsnSac: '9983',
    },
    {
      description: 'Credits',
      quantity: 2,
      unitPriceMinor: 99900,
      hsnSac: '9983',
    },
  ],
  { supplierState: '27', placeOfSupplyState: '27', defaultRatePercent: 18 },
);
ok('lines total correctly', invoice.subtotalMinor === 999700);
ok(
  'tax is 18% of the subtotal',
  invoice.taxMinor === Math.round(999700 * 0.18),
);
ok(
  'the grand total is subtotal plus tax',
  invoice.totalMinor === invoice.subtotalMinor + invoice.taxMinor,
);
ok(
  'the tax summary groups by rate',
  invoice.byRate.length === 1 && invoice.byRate[0].ratePercent === 18,
);

const mixed = totalInvoice(
  [
    {
      description: 'Service',
      quantity: 1,
      unitPriceMinor: 100000,
      taxRatePercent: 18,
    },
    {
      description: 'Exempt item',
      quantity: 1,
      unitPriceMinor: 100000,
      taxRatePercent: 0,
    },
  ],
  { supplierState: '27', placeOfSupplyState: '27' },
);
ok(
  'MIXED RATES: each line is taxed at its own rate, not the invoice at one',
  mixed.taxMinor === 18000,
);
ok('and the summary shows both rates', mixed.byRate.length === 2);
ok(
  'a fractional quantity truncates',
  totalInvoice([{ description: 'x', quantity: 2.8, unitPriceMinor: 100 }], {})
    .subtotalMinor === 200,
);
ok('an empty invoice totals zero', totalInvoice([], {}).totalMinor === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
