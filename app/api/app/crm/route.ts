import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import {
  requireAnyCustomerPermission,
  requireCustomerPermission,
} from '@/lib/customer-rbac';
import { describeLeadEvent } from '@/lib/activity-timeline';
import { isBulkAction } from '@/lib/lead-views';
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
           -- A merged or archived lead must leave the pipeline, or both
           -- actions do nothing a person can see and the duplicate they just
           -- merged is still sitting there.
           AND l.status NOT IN ('merged', 'archived')
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

  // Why each score is what it is. `lead_events` has carried the previous
  // value, the new one and every contribution since the post-call loop
  // shipped, and nothing read it — so a score that moved thirty points could
  // not say why, which is the exact thing the trail was written to fix.
  const events = await db
    .prepare(
      `SELECT id, lead_id AS leadId, event_type AS eventType,
              payload_json AS payload, created_at AS createdAt
       FROM lead_events
       WHERE organization_id = ?
       ORDER BY created_at DESC LIMIT 200`,
    )
    .bind(organizationId)
    .all<{
      id: string;
      leadId: string;
      eventType: string;
      payload: string;
      createdAt: string;
    }>();

  const timeline: Record<string, unknown[]> = {};
  for (const row of events.results ?? []) {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(row.payload || '{}') as Record<string, unknown>;
    } catch {
      // A payload written by an older version is still an event that happened.
      payload = {};
    }
    const described = describeLeadEvent({
      id: row.id,
      eventType: row.eventType,
      createdAt: row.createdAt,
      payload,
    });
    (timeline[row.leadId] ??= []).push(described);
  }

  // §3.5 saved views: a person's own, plus anything the team has shared.
  const views = await db
    .prepare(
      `SELECT id, name, view, filters_json AS filters, shared,
              user_id = ? AS mine
       FROM saved_lead_views
       WHERE organization_id = ? AND (user_id = ? OR shared = 1)
       ORDER BY name`,
    )
    .bind(auth.session.userId, organizationId, auth.session.userId)
    .all<{
      id: string;
      name: string;
      view: string;
      filters: string;
      shared: number;
      mine: number;
    }>();

  return NextResponse.json({
    pipeline: pipeline.results,
    activities: activities.results,
    timeline,
    savedViews: (views.results ?? []).map((row) => {
      let filters: Record<string, unknown> = {};
      try {
        filters = JSON.parse(row.filters || '{}') as Record<string, unknown>;
      } catch {
        // A view saved by an older version still opens; it just filters less.
        filters = {};
      }
      return {
        id: row.id,
        name: row.name,
        view: row.view,
        filters,
        shared: Number(row.shared) === 1,
        mine: Number(row.mine) === 1,
      };
    }),
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

/**
 * Bulk actions, deduplication merge and saved views (§3.5).
 *
 * Separated from POST (which creates an activity) because these operate on a
 * selection rather than a single lead, and because merging is destructive
 * enough to want its own audited path.
 */
export async function PUT(request: Request) {
  const auth = await requireCustomerPermission(request, 'crm.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const organizationId = auth.session.organizationId!;
  const db = getRawDb();
  const body = (await request.json()) as {
    action?: string;
    leadIds?: unknown;
    owner?: string;
    stage?: string;
    primaryId?: string;
    fill?: Record<string, string>;
    score?: number;
    name?: string;
    view?: string;
    filters?: Record<string, unknown>;
    shared?: boolean;
    viewId?: string;
  };

  if (body.action === 'save_view') {
    const name = String(body.name ?? '')
      .trim()
      .slice(0, 60);
    if (!name)
      return NextResponse.json(
        { error: 'A view needs a name.' },
        { status: 400 },
      );
    const id = `view_${crypto.randomUUID()}`;
    // Re-saving under the same name replaces it: the alternative is a list of
    // "Hot leads", "Hot leads 2", "Hot leads 3".
    await db
      .prepare(
        `INSERT INTO saved_lead_views
           (id, organization_id, user_id, name, view, filters_json, shared)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(organization_id, user_id, name) DO UPDATE SET
           view = excluded.view,
           filters_json = excluded.filters_json,
           shared = excluded.shared`,
      )
      .bind(
        id,
        organizationId,
        auth.session.userId,
        name,
        body.view === 'list' ? 'list' : 'kanban',
        JSON.stringify(body.filters ?? {}),
        body.shared ? 1 : 0,
      )
      .run();
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'delete_view') {
    // Scoped to the owner: a shared view is visible to everybody and deletable
    // only by whoever saved it.
    await db
      .prepare(
        `DELETE FROM saved_lead_views
         WHERE id = ? AND organization_id = ? AND user_id = ?`,
      )
      .bind(body.viewId, organizationId, auth.session.userId)
      .run();
    return NextResponse.json({ ok: true });
  }

  const leadIds = Array.isArray(body.leadIds)
    ? body.leadIds
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
        .slice(0, 500)
    : [];

  if (isBulkAction(body.action)) {
    if (!leadIds.length)
      return NextResponse.json(
        { error: 'Select at least one lead.' },
        { status: 400 },
      );
    // Every statement carries the organization id: a selection posted from a
    // browser is a list of ids, and ids from another tenant must do nothing.
    const placeholders = leadIds.map(() => '?').join(',');
    if (body.action === 'assign_owner') {
      const owner = String(body.owner ?? '')
        .trim()
        .slice(0, 80);
      if (!owner)
        return NextResponse.json(
          { error: 'An owner is required.' },
          { status: 400 },
        );
      await db
        .prepare(
          `UPDATE sales_opportunities SET owner = ?, updated_at = CURRENT_TIMESTAMP
           WHERE organization_id = ? AND lead_id IN (${placeholders})`,
        )
        .bind(owner, organizationId, ...leadIds)
        .run();
    } else if (body.action === 'move_stage') {
      if (!allowedStages.has(String(body.stage ?? '')))
        return NextResponse.json({ error: 'Unknown stage.' }, { status: 400 });
      await db
        .prepare(
          `UPDATE sales_opportunities SET stage = ?, updated_at = CURRENT_TIMESTAMP
           WHERE organization_id = ? AND lead_id IN (${placeholders})`,
        )
        .bind(body.stage, organizationId, ...leadIds)
        .run();
    } else {
      // Archive marks the lead, rather than deleting: a bulk delete behind one
      // click on a multi-select is not something to offer.
      await db
        .prepare(
          `UPDATE leads SET status = 'archived', updated_at = CURRENT_TIMESTAMP
           WHERE organization_id = ? AND id IN (${placeholders})`,
        )
        .bind(organizationId, ...leadIds)
        .run();
    }
    await recordAudit(auth.session, `crm.${body.action}`, 'lead', undefined, {
      leads: leadIds.length,
      owner: body.owner ?? null,
      stage: body.stage ?? null,
    });
    return NextResponse.json({ ok: true, affected: leadIds.length });
  }

  if (body.action === 'merge') {
    const primaryId = String(body.primaryId ?? '');
    const mergedIds = leadIds.filter((id) => id !== primaryId);
    if (!primaryId || !mergedIds.length)
      return NextResponse.json(
        { error: 'A primary lead and at least one duplicate are required.' },
        { status: 400 },
      );
    const placeholders = mergedIds.map(() => '?').join(',');
    const owned = await db
      .prepare(
        `SELECT count(*) AS n FROM leads
         WHERE organization_id = ? AND id IN (${placeholders}, ?)`,
      )
      .bind(organizationId, ...mergedIds, primaryId)
      .first<{ n: number }>();
    if (Number(owned?.n ?? 0) !== mergedIds.length + 1)
      return NextResponse.json(
        { error: 'Some of those leads are not in this workspace.' },
        { status: 404 },
      );

    // Only fields the caller was told were safe to fill. The client sends back
    // the plan's `fill`, and anything conflicting was never in it — so a merge
    // cannot quietly overwrite a value the two leads disagreed about.
    const fillable = [
      'name',
      'email',
      'phone',
      'campaign_name',
      'product_interest',
    ];
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [field, value] of Object.entries(body.fill ?? {})) {
      if (!fillable.includes(field)) continue;
      if (typeof value !== 'string' || !value.trim()) continue;
      sets.push(`${field} = ?`);
      values.push(value.trim().slice(0, 200));
    }
    const score = Number(body.score);
    if (Number.isFinite(score))
      // The score is evidence accumulated from calls; the merge keeps the best
      // of the group rather than whatever the surviving row happened to hold.
      sets.push(
        `score = max(score, ${Math.max(0, Math.min(100, Math.round(score)))})`,
      );

    const statements = [];
    if (sets.length)
      statements.push(
        db
          .prepare(
            `UPDATE leads SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND organization_id = ?`,
          )
          .bind(...values, primaryId, organizationId),
      );
    // History moves to the survivor rather than dying with the merged rows.
    for (const table of ['crm_activities', 'lead_events', 'call_records'])
      statements.push(
        db
          .prepare(
            `UPDATE ${table} SET lead_id = ?
             WHERE organization_id = ? AND lead_id IN (${placeholders})`,
          )
          .bind(primaryId, organizationId, ...mergedIds),
      );
    statements.push(
      db
        .prepare(
          `UPDATE leads SET status = 'merged', updated_at = CURRENT_TIMESTAMP
           WHERE organization_id = ? AND id IN (${placeholders})`,
        )
        .bind(organizationId, ...mergedIds),
    );
    statements.push(
      db
        .prepare(
          `INSERT INTO lead_events (id, organization_id, lead_id, event_type, payload_json)
           VALUES (?, ?, ?, 'leads_merged', ?)`,
        )
        .bind(
          `leadevt_${crypto.randomUUID()}`,
          organizationId,
          primaryId,
          JSON.stringify({ mergedIds, filled: Object.keys(body.fill ?? {}) }),
        ),
    );
    await db.batch(statements);
    await recordAudit(auth.session, 'crm.leads_merged', 'lead', primaryId, {
      mergedIds,
    });
    return NextResponse.json({ ok: true, primaryId, merged: mergedIds.length });
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
