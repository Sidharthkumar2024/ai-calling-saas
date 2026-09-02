import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import {
  requireAnyCustomerPermission,
  requireCustomerPermission,
} from '@/lib/customer-rbac';
import { ensureDemoLeads, recordAudit } from '@/lib/demo-seed';

export const dynamic = 'force-dynamic';

const allowedStages = new Set([
  'new',
  'contacted',
  'ai_qualified',
  'hot_lead',
  'proposal',
  'won',
  'lost',
]);

export async function GET(request: Request) {
  const auth = await requireAnyCustomerPermission(request, [
    'crm.manage',
    'analytics.view',
  ]);
  if (auth.response) return auth.response;
  const organizationId = auth.session.organizationId!;
  await ensureSchema();
  await ensureDemoLeads(organizationId);
  const db = getRawDb();

  const [pipeline, activities] = await Promise.all([
    db
      .prepare(
        `SELECT l.id, l.name, l.phone, l.email, l.score, l.intent, l.status,
           l.ai_summary, l.campaign_name, l.product_interest, l.captured_at,
           s.type AS source_type, s.name AS source_name,
           coalesce(o.stage, 'new') AS stage,
           coalesce(o.estimated_value, 0) AS estimated_value,
           coalesce(o.owner, 'Unassigned') AS owner,
           coalesce(o.next_action, 'Review and qualify') AS next_action
         FROM leads l
         INNER JOIN lead_sources s ON s.id = l.source_id
         LEFT JOIN sales_opportunities o ON o.lead_id = l.id
         WHERE l.organization_id = ?
         ORDER BY l.score DESC, l.captured_at DESC`,
      )
      .bind(organizationId)
      .all(),
    db
      .prepare(
        `SELECT a.id, a.lead_id, a.type, a.subject, a.notes, a.due_at,
           a.completed_at, a.created_by, a.created_at, l.name AS lead_name
         FROM crm_activities a INNER JOIN leads l ON l.id = a.lead_id
         WHERE a.organization_id = ? ORDER BY a.created_at DESC LIMIT 50`,
      )
      .bind(organizationId)
      .all(),
  ]);

  return NextResponse.json({
    pipeline: pipeline.results,
    activities: activities.results,
  });
}

export async function PATCH(request: Request) {
  const auth = await requireCustomerPermission(request, 'crm.manage');
  if (auth.response) return auth.response;
  const organizationId = auth.session.organizationId!;
  const body = (await request.json()) as {
    leadId?: string;
    stage?: string;
    estimatedValue?: number;
    owner?: string;
    nextAction?: string;
  };
  if (!body.leadId || !body.stage || !allowedStages.has(body.stage)) {
    return NextResponse.json(
      { error: 'Valid lead and stage are required.' },
      { status: 400 },
    );
  }

  const db = getRawDb();
  const lead = await db
    .prepare('SELECT id FROM leads WHERE id = ? AND organization_id = ?')
    .bind(body.leadId, organizationId)
    .first();
  if (!lead)
    return NextResponse.json({ error: 'Lead not found.' }, { status: 404 });

  const opportunityId = `opportunity_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO sales_opportunities
       (id, organization_id, lead_id, stage, estimated_value, owner, next_action, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (organization_id, lead_id) DO UPDATE SET
         stage = excluded.stage,
         estimated_value = excluded.estimated_value,
         owner = excluded.owner,
         next_action = excluded.next_action,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      opportunityId,
      organizationId,
      body.leadId,
      body.stage,
      Math.max(0, Math.round(body.estimatedValue ?? 0)),
      body.owner?.trim() || 'AI SDR',
      body.nextAction?.trim() || 'Review and qualify',
    )
    .run();
  await db
    .prepare(
      'UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    )
    .bind(body.stage === 'won' ? 'converted' : body.stage, body.leadId)
    .run();
  await recordAudit(auth.session, 'crm.stage_changed', 'lead', body.leadId, {
    stage: body.stage,
  });
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'crm.manage');
  if (auth.response) return auth.response;
  const organizationId = auth.session.organizationId!;
  const body = (await request.json()) as {
    leadId?: string;
    type?: string;
    subject?: string;
    notes?: string;
    dueAt?: string;
  };
  if (!body.leadId || !body.subject?.trim()) {
    return NextResponse.json(
      { error: 'Lead and subject are required.' },
      { status: 400 },
    );
  }

  const db = getRawDb();
  const lead = await db
    .prepare('SELECT id FROM leads WHERE id = ? AND organization_id = ?')
    .bind(body.leadId, organizationId)
    .first();
  if (!lead)
    return NextResponse.json({ error: 'Lead not found.' }, { status: 404 });

  const activityId = `activity_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO crm_activities
       (id, organization_id, lead_id, type, subject, notes, due_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      activityId,
      organizationId,
      body.leadId,
      body.type || 'task',
      body.subject.trim(),
      body.notes?.trim() || null,
      body.dueAt || null,
      auth.session.name,
    )
    .run();
  await recordAudit(
    auth.session,
    'crm.activity_created',
    'crm_activity',
    activityId,
  );
  return NextResponse.json({ id: activityId }, { status: 201 });
}
