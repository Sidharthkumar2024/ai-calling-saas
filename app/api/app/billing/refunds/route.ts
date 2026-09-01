import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';
import { getRazorpayCredentials } from '@/lib/commerce';
import { recordAudit } from '@/lib/demo-seed';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  await ensureSchema();
  const body = await request.json() as { paymentId?: string; amount?: number; reason?: string };
  const amount = Math.round(Number(body.amount || 0));
  if (!body.paymentId || amount < 100) return NextResponse.json({ error: 'Payment ID and refund amount are required.' }, { status: 400 });
  const credentials = await getRazorpayCredentials(auth.session.organizationId!);
  if (!credentials.keyId || !credentials.keySecret) {
    return NextResponse.json({ error: 'Live Razorpay credentials are not connected; no refund was created.' }, { status: 409 });
  }
  const payment = await getRawDb().prepare(`SELECT id, amount FROM payment_reconciliations
    WHERE organization_id = ? AND external_id = ? AND provider = 'razorpay' AND status = 'matched'`)
    .bind(auth.session.organizationId, body.paymentId).first<{ id: string; amount: number }>();
  if (!payment || amount > payment.amount) return NextResponse.json({ error: 'A matched tenant payment with sufficient amount is required.' }, { status: 409 });
  const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(body.paymentId)}/refund`, {
    method: 'POST',
    headers: { authorization: `Basic ${btoa(`${credentials.keyId}:${credentials.keySecret}`)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ amount, notes: { reason: body.reason?.slice(0, 200) || 'Customer-approved refund', organization_id: auth.session.organizationId } }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json() as { id?: string; status?: string; error?: { description?: string } };
  if (!response.ok || !payload.id) return NextResponse.json({ error: payload.error?.description || 'Refund could not be created.' }, { status: 502 });
  await getRawDb().prepare(`INSERT INTO payment_reconciliations
    (id, organization_id, provider, external_id, entity_type, entity_id, amount, currency, status)
    VALUES (?, ?, 'razorpay', ?, 'refund', ?, ?, 'INR', ?)`)
    .bind(`reconciliation_${crypto.randomUUID()}`, auth.session.organizationId, payload.id, payment.id, -amount, payload.status || 'processing').run();
  await recordAudit(auth.session, 'payment.refund_created', 'razorpay_refund', payload.id, { amount });
  return NextResponse.json({ refundId: payload.id, status: payload.status }, { status: 201 });
}
