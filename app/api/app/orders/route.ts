import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import { recordAudit } from '@/lib/demo-seed';
import { createOrder } from '@/lib/order-service';

export const dynamic = 'force-dynamic';

/**
 * Orders (§9).
 *
 * Deliberately missing from this route: anything that marks an order paid or
 * opens a download. That happens in exactly one place — the payment provider's
 * verified webhook — and adding a convenience action here would be a way around
 * the whole point of §9.
 */
export async function GET(request: Request) {
  const auth = await requireCustomerPermission(request, 'crm.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const organizationId = auth.session.organizationId!;
  const db = getRawDb();
  const url = new URL(request.url);
  const orderId = url.searchParams.get('id');

  if (orderId) {
    const order = await db
      .prepare(
        `SELECT id, customer_name, customer_phone, customer_email, status, currency,
           subtotal, total, has_digital, payment_link_id, notes, paid_at, created_at
         FROM orders WHERE id = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(orderId, organizationId)
      .first();
    if (!order)
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    const [items, entitlements] = await Promise.all([
      db
        .prepare(
          `SELECT id, title, kind, quantity, unit_price, line_total, record_id, object_key
           FROM order_items WHERE order_id = ?`,
        )
        .bind(orderId)
        .all(),
      // The token itself is never returned — only its hash is stored, and a
      // link that could be re-read from the dashboard would not be a
      // credential.
      db
        .prepare(
          `SELECT id, title, status, download_count, max_downloads, released_at, expires_at
           FROM entitlements WHERE order_id = ? AND organization_id = ?`,
        )
        .bind(orderId, organizationId)
        .all(),
    ]);
    return NextResponse.json({
      order,
      items: items.results ?? [],
      entitlements: entitlements.results ?? [],
    });
  }

  const rows = await db
    .prepare(
      `SELECT o.id, o.customer_name, o.customer_phone, o.status, o.total, o.currency,
         o.has_digital, o.paid_at, o.created_at,
         (SELECT count(*) FROM order_items i WHERE i.order_id = o.id) AS item_count
       FROM orders o WHERE o.organization_id = ?
       ORDER BY o.created_at DESC LIMIT 100`,
    )
    .bind(organizationId)
    .all();
  const totals = await db
    .prepare(
      `SELECT status, count(*) AS count, coalesce(sum(total), 0) AS value
       FROM orders WHERE organization_id = ? GROUP BY status`,
    )
    .bind(organizationId)
    .all();
  return NextResponse.json({
    orders: rows.results ?? [],
    byStatus: totals.results ?? [],
  });
}

export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'crm.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const organizationId = auth.session.organizationId!;
  const body = (await request.json()) as {
    action?: string;
    orderId?: string;
    objectKey?: string;
    items?: Array<{ recordId?: string; record_id?: string; quantity?: number }>;
    customerName?: string;
    customerPhone?: string;
    customerEmail?: string;
    notes?: string;
    idempotencyKey?: string;
  };
  const db = getRawDb();

  if (body.action === 'create') {
    const items = (body.items ?? [])
      .map((item) => ({
        recordId: String(item.recordId ?? item.record_id ?? ''),
        quantity: Number(item.quantity ?? 1),
      }))
      .filter((item) => item.recordId);
    const result = await createOrder({
      organizationId,
      objectKey: body.objectKey ?? null,
      items,
      customerName: body.customerName ?? null,
      customerPhone: body.customerPhone ?? null,
      customerEmail: body.customerEmail ?? null,
      notes: body.notes ?? null,
      idempotencyKey: body.idempotencyKey ?? null,
    });
    if (!result.ok)
      return NextResponse.json(
        { error: 'This order cannot be placed.', problems: result.errors },
        { status: 400 },
      );
    await recordAudit(auth.session, 'order.created', 'order', result.orderId, {
      total: result.total,
      digital: result.hasDigital,
    });
    return NextResponse.json(
      {
        ...result,
        // Built here because the raw tokens exist only in this response.
        deliveryLinks: result.deliveryTokens.map((entry) => ({
          title: entry.title,
          url: new URL(`/api/deliver/${entry.token}`, request.url).toString(),
        })),
      },
      { status: 201 },
    );
  }

  if (body.action === 'cancel') {
    // Only an unpaid order can be cancelled here. Once money has arrived the
    // way back is a refund, which has its own policy engine and approvals.
    const result = await db
      .prepare(
        `UPDATE orders SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND organization_id = ? AND status = 'awaiting_payment'`,
      )
      .bind(body.orderId ?? '', organizationId)
      .run();
    if (!result.meta.changes)
      return NextResponse.json(
        { error: 'Only an order still awaiting payment can be cancelled.' },
        { status: 409 },
      );
    await db
      .prepare(
        `UPDATE entitlements SET status = 'revoked' WHERE order_id = ? AND organization_id = ?`,
      )
      .bind(body.orderId ?? '', organizationId)
      .run();
    await recordAudit(
      auth.session,
      'order.cancelled',
      'order',
      body.orderId ?? '',
    );
    return NextResponse.json({ cancelled: true });
  }

  return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
}
