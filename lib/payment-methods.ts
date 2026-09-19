export const PAYMENT_METHODS = [
  { id: 'upi', label: 'UPI', feeBps: 0, gateway: 'razorpay' },
  { id: 'netbanking', label: 'Net banking', feeBps: 120, gateway: 'razorpay' },
  { id: 'debit_card', label: 'Debit card', feeBps: 120, gateway: 'razorpay' },
  { id: 'credit_card', label: 'Credit card', feeBps: 150, gateway: 'stripe' },
] as const;

export type PaymentMethodId = (typeof PAYMENT_METHODS)[number]['id'];

export function paymentMethod(id: unknown) {
  return PAYMENT_METHODS.find((method) => method.id === id) ?? null;
}

export function paymentTotal(baseAmountMinor: number, feeBps: number) {
  const fee = Math.ceil((Math.max(0, baseAmountMinor) * feeBps) / 10_000);
  return {
    baseAmountMinor,
    feeAmountMinor: fee,
    totalAmountMinor: baseAmountMinor + fee,
  };
}
