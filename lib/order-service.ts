import { getRawDb } from '@/db/index';
import { adjustInventory, getObject, getRecord } from '@/lib/object-store';
import {
  orderSayToCustomer,
  priceOrder,
  type OrderLineInput,
} from '@/lib/order-engine';
import { sha256 } from '@/lib/security';

/**
 * Orders and digital delivery (§9, §22).
 *
 * The rule this file exists to enforce: **`releaseOrder` is called from exactly
 * one place — the payment provider's verified webhook.** Nothing else may mark
 * an order paid, release an entitlement or decrement stock. Before this, the
 * Razorpay webhook verified a signature, updated a payment link's status, and
 * did nothing else at all: no entitlement, no asset, no message. A digital
 * product could be paid for and never delivered.
 */

export type CreateOrderInput = {
  organizationId: string;
  objectKey?: string | null;
  items: Array<{ recordId: string; quantity?: number }>;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  leadId?: string | null;
  sessionId?: string | null;
  notes?: string | null;
  idempotencyKey?: string | null;
};

export type CreateOrderResult =
  | {
      ok: true;
      orderId: string;
      status: 'awaiting_payment';
      total: number;
      currency: string;
      hasDigital: boolean;
      lines: Array<{ title: string; quantity: number; lineTotal: number }>;
      /**
       * Raw delivery tokens for the digital lines, returned once and never
       * stored — the row keeps only their hash. The caller builds the URL from
       * these; there is no way to recover one afterwards.
       */
      deliveryTokens: Array<{ title: string; token: string }>;
      sayToCustomer: string;
      alreadyExisted?: boolean;
    }
  | { ok: false; errors: string[] };

/**
 * Places an order against catalogue records. Prices and stock come from the
 * records, never from the caller — an agent that could name its own price
 * would be a discount the workspace never approved.
 */
export async function createOrder(
  input: CreateOrderInput,
): Promise<CreateOrderResult> {
  const db = getRawDb();

  if (input.idempotencyKey) {
    const existing = await db
      .prepare(
        `SELECT id, status, total, currency, has_digital FROM orders
         WHERE idempotency_key = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(input.idempotencyKey, input.organizationId)
      .first<{
        id: string;
        status: string;
        total: number;
        currency: string;
        has_digital: number;
      }>();
    if (existing) {
      const lines = await db
        .prepare(
          `SELECT title, quantity, line_total FROM order_items WHERE order_id = ?`,
        )
        .bind(existing.id)
        .all<{ title: string; quantity: number; line_total: number }>();
      return {
        ok: true,
        orderId: existing.id,
        status: 'awaiting_payment',
        total: existing.total,
        currency: existing.currency,
        hasDigital: existing.has_digital === 1,
        lines: (lines.results ?? []).map((row) => ({
          title: row.title,
          quantity: row.quantity,
          lineTotal: row.line_total,
        })),
        // A repeat of the same order cannot re-issue tokens: the raw values
        // were never kept.
        deliveryTokens: [],
        sayToCustomer: orderSayToCustomer(
          'awaiting_payment',
          existing.has_digital === 1,
        ),
        alreadyExisted: true,
      };
    }
  }

  const object = input.objectKey
    ? await getObject(input.organizationId, input.objectKey)
    : null;
  const lines: OrderLineInput[] = [];
  const errors: string[] = [];
  const inventoryFields = new Map<string, string | null>();
  const objectKeys = new Map<string, string>();

  for (const item of input.items ?? []) {
    const resolved = object
      ? {
          object,
          record: await getRecord(input.organizationId, object, item.recordId),
        }
      : await findRecordAnywhere(input.organizationId, item.recordId);
    if (!resolved?.record) {
      errors.push(`No catalogue item matches ${item.recordId}.`);
      continue;
    }
    if (resolved.record.status !== 'published') {
      // Same rule as search: an unpublished record is one nobody has stood
      // behind, so it cannot be sold either.
      errors.push(
        `${resolved.record.title} is not published, so it cannot be sold.`,
      );
      continue;
    }
    const fields = resolved.object.fields;
    const priceField = fields.find((field) => field.type === 'currency');
    const inventoryField = fields.find((field) => field.type === 'inventory');
    const kindField = fields.find(
      (field) => field.key === 'kind' && field.type === 'select',
    );
    const assetField = fields.find(
      (field) =>
        field.type === 'file' && /deliver|asset|download/i.test(field.key),
    );
    const values = resolved.record.values;
    // Record values are typed by the engine, but only a string means anything
    // to these two checks; anything else is treated as absent.
    const str = (key: string | undefined) =>
      key && typeof values[key] === 'string' ? (values[key] as string) : '';
    const kindValue = kindField ? str(kindField.key) : '';
    const kind: OrderLineInput['kind'] =
      kindValue === 'digital' || kindValue === 'service'
        ? kindValue
        : 'physical';

    inventoryFields.set(resolved.record.id, inventoryField?.key ?? null);
    objectKeys.set(resolved.record.id, resolved.object.key);
    lines.push({
      recordId: resolved.record.id,
      title: resolved.record.title,
      kind,
      unitPrice: Number(priceField ? (values[priceField.key] ?? 0) : 0),
      quantity: Number(item.quantity ?? 1),
      available: inventoryField
        ? Number(values[inventoryField.key] ?? 0)
        : null,
      deliveryAsset: assetField ? str(assetField.key) || null : null,
    });
  }

  if (errors.length) return { ok: false, errors };
  const priced = priceOrder(lines);
  if (!priced.ok) return { ok: false, errors: priced.errors };

  const orderId = `order_${crypto.randomUUID()}`;
  const statements = [
    db
      .prepare(
        `INSERT INTO orders (id, organization_id, lead_id, session_id, customer_name,
           customer_phone, customer_email, status, currency, subtotal, total,
           has_digital, idempotency_key, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'awaiting_payment', 'INR', ?, ?, ?, ?, ?)`,
      )
      .bind(
        orderId,
        input.organizationId,
        input.leadId ?? null,
        input.sessionId ?? null,
        input.customerName ?? null,
        input.customerPhone ?? null,
        input.customerEmail ?? null,
        priced.subtotal,
        priced.total,
        priced.hasDigital ? 1 : 0,
        input.idempotencyKey ?? null,
        input.notes ?? null,
      ),
  ];
  const pendingEntitlements: Array<{
    line: (typeof priced.lines)[number];
    itemId: string;
  }> = [];
  for (const line of priced.lines) {
    const itemId = `orderitem_${crypto.randomUUID()}`;
    statements.push(
      db
        .prepare(
          `INSERT INTO order_items (id, order_id, record_id, object_key, title, kind,
             quantity, unit_price, line_total, inventory_field, delivery_asset)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          itemId,
          orderId,
          line.recordId,
          objectKeys.get(line.recordId) ?? null,
          line.title,
          line.kind,
          line.quantity,
          line.unitPrice,
          line.lineTotal,
          inventoryFields.get(line.recordId) ?? null,
          line.deliveryAsset ?? null,
        ),
    );
    if (line.kind === 'digital' && line.deliveryAsset)
      pendingEntitlements.push({ line, itemId });
  }
  await db.batch(statements);

  // Entitlements are created now and stay shut. Creating them at payment time
  // instead would mean a webhook arriving before the row existed had nothing to
  // release.
  const deliveryTokens: Array<{ title: string; token: string }> = [];
  for (const entry of pendingEntitlements) {
    const token =
      crypto.randomUUID().replaceAll('-', '') +
      crypto.randomUUID().replaceAll('-', '');
    await db
      .prepare(
        `INSERT INTO entitlements (id, organization_id, order_id, order_item_id, record_id,
           token_hash, asset_url, title, status, max_downloads)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 10)`,
      )
      .bind(
        `entitlement_${crypto.randomUUID()}`,
        input.organizationId,
        orderId,
        entry.itemId,
        entry.line.recordId,
        await sha256(token),
        entry.line.deliveryAsset!,
        entry.line.title,
      )
      .run();
    deliveryTokens.push({ title: entry.line.title, token });
  }

  return {
    ok: true,
    orderId,
    status: 'awaiting_payment',
    total: priced.total,
    currency: 'INR',
    hasDigital: priced.hasDigital,
    lines: priced.lines.map((line) => ({
      title: line.title,
      quantity: line.quantity,
      lineTotal: line.lineTotal,
    })),
    deliveryTokens,
    sayToCustomer: orderSayToCustomer('awaiting_payment', priced.hasDigital),
  };
}

export type ReleaseResult = {
  released: number;
  alreadyPaid: boolean;
  inventoryShortfalls: string[];
};

/**
 * Marks an order paid, releases its digital entitlements and decrements stock.
 *
 * **Only the verified webhook may call this.** It is idempotent on the order's
 * own status, because a provider will happily deliver the same event twice.
 */
export async function releaseOrder(input: {
  organizationId: string;
  orderId: string;
}): Promise<ReleaseResult> {
  const db = getRawDb();
  // The status change is the lock: a second delivery of the same event changes
  // no rows and releases nothing.
  const claimed = await db
    .prepare(
      `UPDATE orders SET status = 'paid', paid_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND organization_id = ? AND status = 'awaiting_payment'`,
    )
    .bind(input.orderId, input.organizationId)
    .run();
  if (!claimed.meta.changes)
    return { released: 0, alreadyPaid: true, inventoryShortfalls: [] };

  const items = await db
    .prepare(
      `SELECT id, record_id, object_key, title, quantity, inventory_field
       FROM order_items WHERE order_id = ?`,
    )
    .bind(input.orderId)
    .all<{
      id: string;
      record_id: string | null;
      object_key: string | null;
      title: string;
      quantity: number;
      inventory_field: string | null;
    }>();

  // Stock was checked when the order was placed; minutes have passed, so it is
  // checked again here. A shortfall is recorded rather than silently ignored —
  // the money has arrived, so this is now a fulfilment problem for a human.
  const inventoryShortfalls: string[] = [];
  for (const item of items.results ?? []) {
    if (!item.inventory_field || !item.record_id || !item.object_key) continue;
    const object = await getObject(input.organizationId, item.object_key);
    if (!object) continue;
    const result = await adjustInventory({
      organizationId: input.organizationId,
      object,
      recordId: item.record_id,
      fieldKey: item.inventory_field,
      delta: -item.quantity,
    });
    if (!result.ok) inventoryShortfalls.push(item.title);
  }

  const released = await db
    .prepare(
      `UPDATE entitlements SET status = 'released', released_at = CURRENT_TIMESTAMP,
         expires_at = datetime('now', '+30 days')
       WHERE order_id = ? AND organization_id = ? AND status = 'pending'`,
    )
    .bind(input.orderId, input.organizationId)
    .run();

  return {
    released: released.meta.changes ?? 0,
    alreadyPaid: false,
    inventoryShortfalls,
  };
}

/** Finds a record when the caller did not say which object it belongs to. */
async function findRecordAnywhere(organizationId: string, recordId: string) {
  const row = await getRawDb()
    .prepare(
      `SELECT o.key FROM records r INNER JOIN custom_objects o ON o.id = r.object_id
       WHERE r.id = ? AND r.organization_id = ? LIMIT 1`,
    )
    .bind(recordId, organizationId)
    .first<{ key: string }>();
  if (!row) return null;
  const object = await getObject(organizationId, row.key);
  if (!object) return null;
  return { object, record: await getRecord(organizationId, object, recordId) };
}
