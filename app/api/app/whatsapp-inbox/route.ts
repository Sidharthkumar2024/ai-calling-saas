import { NextResponse } from 'next/server';
import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireAnyCustomerPermission } from '@/lib/customer-rbac';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireAnyCustomerPermission(request, ['crm.manage', 'support.manage']);
  if (auth.response) return auth.response;
  await ensureSchema();
  const rows = await getRawDb()
    .prepare(`SELECT * FROM whatsapp_messages
      WHERE organization_id = ? ORDER BY created_at DESC LIMIT 200`)
    .bind(auth.session.organizationId)
    .all();
  return NextResponse.json({ messages: rows.results ?? [] });
}
