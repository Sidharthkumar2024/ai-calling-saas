/**
 * Orders and entitlements (§9, §22).
 *
 * Two rules from the document shape everything here:
 *
 *  - **A digital product is delivered only after verified payment.** Not after
 *    a payment link is created, not after the customer says they have paid, and
 *    not after our own optimistic guess — only after the provider's signed
 *    webhook says the money arrived.
 *  - **Never announce success before authoritative confirmation.** An order is
 *    `awaiting_payment` until that webhook; the agent may say a link was sent,
 *    never that an order is confirmed.
 *
 * Pure functions, so the pricing arithmetic and the access rules are testable
 * without a database. The access rules matter most: `entitlementAccess` is the
 * single decision about whether a download link opens, and it is easier to
 * reason about — and to test — as one function than as a chain of `if`s inside
 * a route.
 */

export type OrderLineInput = {
  recordId: string;
  title: string;
  /** 'digital' items are the ones gated behind verified payment. */
  kind: 'physical' | 'digital' | 'service';
  unitPrice: number;
  quantity: number;
  /** Stock available right now, when the item tracks inventory. */
  available?: number | null;
  deliveryAsset?: string | null;
};

export type PricedLine = OrderLineInput & { lineTotal: number };

export type OrderPricing =
  | {
      ok: true;
      lines: PricedLine[];
      subtotal: number;
      total: number;
      hasDigital: boolean;
    }
  | { ok: false; errors: string[] };

/**
 * Prices a set of lines and refuses the ones that cannot be honoured.
 *
 * Stock is checked here rather than at payment time so the customer is told
 * during the conversation, not after paying. It is checked *again* on the
 * verified webhook, because the two moments are minutes apart and someone else
 * may have bought the last one in between.
 */
export function priceOrder(items: OrderLineInput[]): OrderPricing {
  const errors: string[] = [];
  const lines: PricedLine[] = [];
  if (!items?.length)
    return { ok: false, errors: ['An order needs at least one item.'] };
  if (items.length > 50)
    return { ok: false, errors: ['An order may have at most 50 items.'] };

  for (const item of items) {
    const quantity = Math.trunc(Number(item.quantity));
    if (!Number.isFinite(quantity) || quantity < 1) {
      errors.push(`${item.title}: quantity must be at least 1.`);
      continue;
    }
    if (quantity > 999) {
      errors.push(`${item.title}: quantity is unrealistically large.`);
      continue;
    }
    const unitPrice = Number(item.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      errors.push(`${item.title}: no usable price.`);
      continue;
    }
    if (
      item.available !== null &&
      item.available !== undefined &&
      Number.isFinite(item.available) &&
      quantity > Number(item.available)
    ) {
      errors.push(
        `${item.title}: only ${Number(item.available)} left, ${quantity} requested.`,
      );
      continue;
    }
    if (item.kind === 'digital' && !item.deliveryAsset) {
      // A digital product with nothing to deliver would take the money and hand
      // over nothing. Refuse at the till.
      errors.push(
        `${item.title}: no delivery file is attached, so it cannot be sold yet.`,
      );
      continue;
    }
    lines.push({
      ...item,
      quantity,
      unitPrice,
      lineTotal: unitPrice * quantity,
    });
  }

  if (errors.length) return { ok: false, errors };
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  return {
    ok: true,
    lines,
    subtotal,
    total: subtotal,
    hasDigital: lines.some((line) => line.kind === 'digital'),
  };
}

export type EntitlementRow = {
  status: string;
  expires_at: string | null;
  download_count: number;
  max_downloads: number | null;
};

export type EntitlementAccess =
  | { allowed: true }
  | { allowed: false; reason: string; message: string; status: number };

/**
 * Whether a delivery link may open right now.
 *
 * `pending` is the important one and the whole point of §9: the entitlement
 * exists from the moment the order is placed, and stays shut until the payment
 * provider confirms. Someone who guesses a token before paying gets the same
 * answer as someone who never paid.
 */
export function entitlementAccess(
  row: EntitlementRow | null,
  now = new Date(),
): EntitlementAccess {
  if (!row)
    return {
      allowed: false,
      reason: 'unknown',
      message: 'This download link is not valid.',
      status: 404,
    };
  if (row.status === 'revoked')
    return {
      allowed: false,
      reason: 'revoked',
      message: 'This download has been withdrawn. Contact the seller.',
      status: 410,
    };
  if (row.status !== 'released')
    return {
      allowed: false,
      reason: 'awaiting_payment',
      message:
        'This download unlocks once the payment is confirmed by the payment provider.',
      status: 402,
    };
  if (row.expires_at) {
    const expiry = Date.parse(row.expires_at);
    if (Number.isFinite(expiry) && expiry <= now.getTime())
      return {
        allowed: false,
        reason: 'expired',
        message:
          'This download link has expired. Contact the seller for a new one.',
        status: 410,
      };
  }
  if (
    row.max_downloads !== null &&
    row.max_downloads !== undefined &&
    row.download_count >= row.max_downloads
  )
    return {
      allowed: false,
      reason: 'exhausted',
      message:
        'This download has already been used the maximum number of times.',
      status: 429,
    };
  return { allowed: true };
}

export const ORDER_STATUSES = [
  'awaiting_payment',
  'paid',
  'fulfilled',
  'cancelled',
  'refunded',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return (
    typeof value === 'string' &&
    (ORDER_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * What the agent may say about an order, given its status.
 *
 * Kept here rather than in a prompt so it cannot drift: the model is handed
 * this sentence and told to use it, which is the same discipline the refund
 * tool already follows.
 */
export function orderSayToCustomer(status: OrderStatus, hasDigital: boolean) {
  switch (status) {
    case 'awaiting_payment':
      return hasDigital
        ? 'The payment link is on its way. The download unlocks as soon as the payment is confirmed.'
        : 'The payment link is on its way. I will confirm the order once the payment goes through.';
    case 'paid':
      return hasDigital
        ? 'Payment is confirmed and the download link is now active.'
        : 'Payment is confirmed and the order is being processed.';
    case 'fulfilled':
      return 'This order has been completed.';
    case 'cancelled':
      return 'This order was cancelled.';
    case 'refunded':
      return 'This order was refunded.';
  }
}
