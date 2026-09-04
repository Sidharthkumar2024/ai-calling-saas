import {
  entitlementAccess,
  isOrderStatus,
  orderSayToCustomer,
  priceOrder,
} from '../lib/order-engine.ts';

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) pass++;
  else fail++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
};

const line = (extra = {}) => ({
  recordId: 'record_1',
  title: 'Course',
  kind: 'physical',
  unitPrice: 100000,
  quantity: 1,
  ...extra,
});

console.log('pricing:');
const priced = priceOrder([line({ quantity: 2 }), line({ recordId: 'r2', title: 'Mat', unitPrice: 50000 })]);
ok('lines are priced and totalled', priced.ok && priced.subtotal === 250000);
ok('each line carries its own total', priced.ok && priced.lines[0].lineTotal === 200000);
ok('an empty order is refused', priceOrder([]).ok === false);
ok('quantity below one is refused', priceOrder([line({ quantity: 0 })]).ok === false);
ok('a fractional quantity truncates, it does not round up', priceOrder([line({ quantity: 2.9 })]).lines[0].quantity === 2);
ok('an absurd quantity is refused', priceOrder([line({ quantity: 100000 })]).ok === false);
ok('a negative price is refused', priceOrder([line({ unitPrice: -1 })]).ok === false);
ok('a free item is allowed', priceOrder([line({ unitPrice: 0 })]).ok === true);

console.log('stock:');
const short = priceOrder([line({ quantity: 5, available: 2 })]);
ok('ordering more than is left is refused', short.ok === false);
ok('the error says how many are left', short.errors[0].includes('only 2 left'));
ok('exactly the last unit is allowed', priceOrder([line({ quantity: 2, available: 2 })]).ok === true);
ok('an item that does not track stock is unrestricted', priceOrder([line({ quantity: 900, available: null })]).ok === true);

console.log('digital goods:');
const noAsset = priceOrder([line({ kind: 'digital', deliveryAsset: null })]);
ok(
  'THE ONE THAT MATTERS: a digital item with nothing to deliver cannot be sold',
  noAsset.ok === false && noAsset.errors[0].includes('no delivery file'),
);
const withAsset = priceOrder([line({ kind: 'digital', deliveryAsset: 'https://cdn.example.com/a.pdf' })]);
ok('with a file attached it prices normally', withAsset.ok === true);
ok('the order knows it contains something digital', withAsset.hasDigital === true);
ok('a physical-only order does not', priced.hasDigital === false);

console.log('delivery access:');
const base = { status: 'released', expires_at: null, download_count: 0, max_downloads: 3 };
ok('a released entitlement opens', entitlementAccess(base).allowed === true);
ok('an unknown token is a 404', entitlementAccess(null).status === 404);
const pending = entitlementAccess({ ...base, status: 'pending' });
ok(
  'THE §9 GATE: pending stays shut, whoever has the link',
  pending.allowed === false && pending.reason === 'awaiting_payment' && pending.status === 402,
);
ok(
  'and it says why, without implying the payment failed',
  pending.message.includes('once the payment is confirmed'),
);
ok('a revoked entitlement is gone for good', entitlementAccess({ ...base, status: 'revoked' }).reason === 'revoked');
ok(
  'an expired link is refused',
  entitlementAccess({ ...base, expires_at: '2020-01-01T00:00:00.000Z' }).reason === 'expired',
);
ok(
  'a link expiring in the future still opens',
  entitlementAccess({ ...base, expires_at: '2999-01-01T00:00:00.000Z' }).allowed === true,
);
ok(
  'the download cap is enforced at the cap, not past it',
  entitlementAccess({ ...base, download_count: 3 }).reason === 'exhausted' &&
    entitlementAccess({ ...base, download_count: 2 }).allowed === true,
);
ok(
  'no cap means no cap',
  entitlementAccess({ ...base, download_count: 9999, max_downloads: null }).allowed === true,
);
ok(
  'an unparseable expiry does not lock out a paid customer',
  entitlementAccess({ ...base, expires_at: 'whenever' }).allowed === true,
);

console.log('what the agent may say:');
ok('an unpaid order is never described as confirmed', !orderSayToCustomer('awaiting_payment', true).includes('confirmed and'));
ok('an unpaid digital order promises the unlock, not the file', orderSayToCustomer('awaiting_payment', true).includes('unlocks'));
ok('a paid digital order says the link is active', orderSayToCustomer('paid', true).includes('now active'));
ok('statuses are validated', isOrderStatus('paid') && !isOrderStatus('probably_paid'));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
