import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { authenticateApiKey } from '@/lib/api-key-auth';
import { ingestLead, normalizeLeadInput } from '@/lib/lead-engine';
import { dispatchWebhook } from '@/lib/webhook-dispatch';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await authenticateApiKey(request, 'leads:write');
  if (!auth) {
    return NextResponse.json({ error: 'Valid API key with leads:write is required.' }, { status: 401 });
  }
  try {
    const lead = await ingestLead(auth.organizationId, normalizeLeadInput(await request.json()));
    await dispatchWebhook(auth.organizationId, 'lead.created', { lead });
    if (lead.score >= 75) {
      await dispatchWebhook(auth.organizationId, 'lead.qualified', { lead });
    }
    return NextResponse.json({ data: lead }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to create lead.' },
      { status: 400 },
    );
  }
}

export async function GET(request: Request) {
  const auth = await authenticateApiKey(request, 'leads:read');
  if (!auth) {
    return NextResponse.json({ error: 'Valid API key with leads:read is required.' }, { status: 401 });
  }
  const rows = await getRawDb()
    .prepare(
      `SELECT l.id, l.name, l.phone, l.email, l.status, l.score, l.intent,
         l.ai_summary, l.captured_at, s.type AS source
       FROM leads l INNER JOIN lead_sources s ON s.id = l.source_id
       WHERE l.organization_id = ? ORDER BY l.captured_at DESC LIMIT 100`,
    )
    .bind(auth.organizationId)
    .all();
  return NextResponse.json({ data: rows.results });
}
