export type CreditReceipt = {
  invoiceId: string;
  invoiceNumber?: string;
  creditsAdded: number;
  balance: number;
  sandbox?: boolean;
};

/** A redirect, notification or changing balance is not a payment receipt. */
export function confirmedCreditReceipt(value: unknown): CreditReceipt | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (
    row.completed !== true ||
    typeof row.invoiceId !== 'string' ||
    !row.invoiceId ||
    typeof row.creditsAdded !== 'number' ||
    !Number.isFinite(row.creditsAdded) ||
    row.creditsAdded < 0 ||
    typeof row.balance !== 'number' ||
    !Number.isFinite(row.balance)
  )
    return null;
  return {
    invoiceId: row.invoiceId,
    invoiceNumber:
      typeof row.invoiceNumber === 'string' ? row.invoiceNumber : undefined,
    creditsAdded: row.creditsAdded,
    balance: row.balance,
    sandbox: row.mode === 'local_sandbox',
  };
}
