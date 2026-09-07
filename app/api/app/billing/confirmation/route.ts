import { NextResponse } from 'next/server';
import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const sessionId = new URL(request.url).searchParams.get('session_id');
  if (!sessionId || !/^cs_[A-Za-z0-9_]{8,240}$/.test(sessionId)) return NextResponse.json({ error: 'Invalid checkout reference.' }, { status: 400 });
  const row = await getRawDb().prepare(`SELECT i.id AS invoiceId, i.invoice_number AS invoiceNumber, l.amount AS creditsAdded, w.balance
    FROM invoices i INNER JOIN credit_ledger l ON l.reference_id = i.id AND l.reference_type = 'invoice' AND l.type = 'purchase' AND l.organization_id = i.organization_id
    INNER JOIN organization_wallets w ON w.organization_id = i.organization_id
    WHERE i.organization_id = ? AND i.external_invoice_id = ? AND i.status = 'paid' LIMIT 1`).bind(auth.session.organizationId!, sessionId).first();
  return NextResponse.json(row ? { completed: true, ...row } : { completed: false }, { headers: { 'Cache-Control': 'no-store' } });
}
