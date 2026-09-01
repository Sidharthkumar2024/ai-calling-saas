import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';
import { enqueueJob } from '@/lib/job-queue';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  await ensureSchema();
  const rows = await getRawDb().prepare(`SELECT * FROM retargeting_audiences
    WHERE organization_id = ? ORDER BY created_at DESC`).bind(auth.session.organizationId).all();
  return NextResponse.json({ audiences: rows.results });
}

export async function POST(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  await ensureSchema();
  const body = await request.json() as { action?: string; name?: string; destination?: string; rules?: Record<string, unknown>; audienceId?: string };
  const organizationId = auth.session.organizationId!;
  const db = getRawDb();
  if (body.action === 'create') {
    if (!body.name?.trim() || !['meta_ads','google_ads'].includes(body.destination || '')) return NextResponse.json({ error: 'Name and supported destination are required.' }, { status: 400 });
    const eligible = await db.prepare(`SELECT count(*) AS count FROM leads l
      WHERE l.organization_id = ? AND l.phone NOT IN (
        SELECT c.phone FROM consent_records c WHERE c.organization_id = l.organization_id AND c.status = 'revoked'
      )`).bind(organizationId).first<{ count: number }>();
    const id = `audience_${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO retargeting_audiences
      (id, organization_id, name, destination, rules_json, status, eligible_count)
      VALUES (?, ?, ?, ?, ?, 'ready', ?)`).bind(id, organizationId, body.name.trim().slice(0, 120), body.destination, JSON.stringify(body.rules || {}), Number(eligible?.count || 0)).run();
    return NextResponse.json({ id, eligibleCount: Number(eligible?.count || 0) }, { status: 201 });
  }
  if (body.action === 'sync' && body.audienceId) {
    await db.prepare(`UPDATE retargeting_audiences SET status = 'syncing' WHERE id = ? AND organization_id = ?`)
      .bind(body.audienceId, organizationId).run();
    await enqueueJob({ organizationId, queue: 'retargeting', type: 'retargeting.sync', idempotencyKey: `audience-sync:${body.audienceId}:${new Date().toISOString().slice(0, 13)}`, payload: { audienceId: body.audienceId } });
    return NextResponse.json({ status: 'syncing' }, { status: 202 });
  }
  return NextResponse.json({ error: 'Unsupported audience action.' }, { status: 400 });
}
