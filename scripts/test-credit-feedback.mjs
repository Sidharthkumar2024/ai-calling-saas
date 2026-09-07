import assert from 'node:assert/strict';
import { confirmedCreditReceipt } from '../lib/credit-feedback.ts';

for (const value of [null, {}, { checkoutUrl: 'https://example.com' }, { event: 'payment_success' }, { completed: false, invoiceId: 'invoice_a', creditsAdded: 100, balance: 200 }, { completed: true, invoiceId: '', creditsAdded: 100, balance: 200 }, { completed: true, invoiceId: 'a', creditsAdded: -1, balance: 200 }, { completed: true, invoiceId: 'a', creditsAdded: NaN, balance: 200 }, { completed: true, invoiceId: 'a', creditsAdded: 100, balance: Infinity }]) assert.equal(confirmedCreditReceipt(value), null);
const receipt = confirmedCreditReceipt({ completed: true, invoiceId: 'invoice_a', creditsAdded: 100, balance: 140, mode: 'local_sandbox' });
assert.equal(receipt.creditsAdded, 100);
assert.equal(receipt.balance, 140);
assert.equal(receipt.sandbox, true);
assert.equal(confirmedCreditReceipt({ completed: true, invoiceId: 'invoice_b', creditsAdded: 500, balance: 580 }).sandbox, false);
assert.equal(confirmedCreditReceipt({ completed: true, invoiceId: 'plan_without_credits', creditsAdded: 0, balance: 10 }).creditsAdded, 0);
console.log('Credit feedback: 14 assertions passed.');
