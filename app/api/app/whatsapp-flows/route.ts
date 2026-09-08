import { NextResponse } from 'next/server';
import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireAnyCustomerPermission } from '@/lib/customer-rbac';
import { recordAudit } from '@/lib/demo-seed';
import {
  createWhatsAppFlow,
  fetchWhatsAppFlows,
  publishWhatsAppFlow,
  whatsAppTemplateAccess,
} from '@/lib/commerce';
import {
  toFlowJson,
  validateFlow,
  type FlowScreen,
} from '@/lib/whatsapp-flows';

export const dynamic = 'force-dynamic';

type FlowRow = {
  id: string;
  name: string;
  cta_label: string;
  screens_json: string;
  status: string;
  provider_id: string | null;
  error: string | null;
  published_at: string | null;
  synced_at: string | null;
};

function screensOf(row: FlowRow): FlowScreen[] {
  try {
    const parsed = JSON.parse(row.screens_json) as unknown;
    return Array.isArray(parsed) ? (parsed as FlowScreen[]) : [];
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const auth = await requireAnyCustomerPermission(request, [
    'crm.manage',
    'support.manage',
  ]);
  if (auth.response) return auth.response;
  await ensureSchema();
  const db = getRawDb();
  const rows = await db
    .prepare(`SELECT id, name, cta_label, screens_json, status, provider_id,
      error, published_at, synced_at
      FROM whatsapp_flows WHERE organization_id = ? ORDER BY created_at DESC`)
    .bind(auth.session.organizationId)
    .all<FlowRow>();
  // What came back, so a workspace can see the answers rather than only that a
  // form was sent.
  const responses = await db
    .prepare(`SELECT r.id, r.flow_id, r.phone, r.status, r.answers_json,
      r.sent_at, r.answered_at, f.name AS flow_name
      FROM whatsapp_flow_responses r
      LEFT JOIN whatsapp_flows f ON f.id = r.flow_id
      WHERE r.organization_id = ? ORDER BY r.sent_at DESC LIMIT 50`)
    .bind(auth.session.organizationId)
    .all<Record<string, unknown>>();
  const access = await whatsAppTemplateAccess(auth.session.organizationId!);
  return NextResponse.json({
    flows: (rows.results ?? []).map((row) => ({
      ...row,
      screens: screensOf(row),
    })),
    responses: (responses.results ?? []).map((row) => ({
      ...row,
      answers: safeAnswers(row.answers_json),
    })),
    manageable: access.ok,
    reason: access.ok ? null : access.reason,
  });
}

function safeAnswers(value: unknown): Record<string, string> {
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

export async function POST(request: Request) {
  const auth = await requireAnyCustomerPermission(request, [
    'crm.manage',
    'support.manage',
  ]);
  if (auth.response) return auth.response;
  await ensureSchema();
  const input = (await request.json().catch(() => null)) as {
    action?: unknown;
    id?: unknown;
    name?: unknown;
    ctaLabel?: unknown;
    screens?: unknown;
  } | null;
  const db = getRawDb();
  const organizationId = auth.session.organizationId!;
  const action = typeof input?.action === 'string' ? input.action : '';
  const text = (value: unknown) => (typeof value === 'string' ? value : '');

  if (action === 'create_flow' || action === 'update_flow') {
    const draft = {
      name: text(input?.name).trim(),
      ctaLabel: text(input?.ctaLabel).trim() || 'Open form',
      screens: Array.isArray(input?.screens)
        ? (input.screens as FlowScreen[])
        : [],
    };
    const problems = validateFlow(draft);
    if (problems.length)
      return NextResponse.json({ error: problems.join(' ') }, { status: 400 });

    if (action === 'update_flow') {
      const id = text(input?.id);
      const existing = await db
        .prepare(
          `SELECT id, status FROM whatsapp_flows WHERE id = ? AND organization_id = ?`,
        )
        .bind(id, organizationId)
        .first<{ id: string; status: string }>();
      if (!existing)
        return NextResponse.json(
          { error: 'That flow is not in this workspace.' },
          { status: 404 },
        );
      // A published flow's definition is fixed at Meta. Editing this row would
      // leave the screen describing something other than the form customers
      // are opening.
      if (existing.status === 'PUBLISHED')
        return NextResponse.json(
          {
            error:
              'This flow is published. Create a new one rather than editing what customers are already opening.',
          },
          { status: 409 },
        );
      await db
        .prepare(`UPDATE whatsapp_flows
          SET name = ?, cta_label = ?, screens_json = ?, error = NULL
          WHERE id = ? AND organization_id = ?`)
        .bind(
          draft.name,
          draft.ctaLabel,
          JSON.stringify(draft.screens),
          id,
          organizationId,
        )
        .run();
      await recordAudit(
        auth.session,
        'whatsapp.flow_updated',
        'whatsapp_flow',
        id,
        {
          name: draft.name,
        },
      );
      return NextResponse.json({ ok: true, id });
    }

    const id = `wfl_${crypto.randomUUID()}`;
    try {
      await db
        .prepare(`INSERT INTO whatsapp_flows
          (id, organization_id, name, cta_label, screens_json, status)
          VALUES (?, ?, ?, ?, ?, 'draft')`)
        .bind(
          id,
          organizationId,
          draft.name,
          draft.ctaLabel,
          JSON.stringify(draft.screens),
        )
        .run();
    } catch {
      return NextResponse.json(
        { error: 'A flow with that name already exists here.' },
        { status: 409 },
      );
    }
    await recordAudit(
      auth.session,
      'whatsapp.flow_created',
      'whatsapp_flow',
      id,
      {
        name: draft.name,
      },
    );
    return NextResponse.json({ ok: true, id });
  }

  if (action === 'send_to_meta') {
    const id = text(input?.id);
    const row = await db
      .prepare(
        `SELECT id, name, cta_label, screens_json, status, provider_id FROM whatsapp_flows WHERE id = ? AND organization_id = ?`,
      )
      .bind(id, organizationId)
      .first<FlowRow>();
    if (!row)
      return NextResponse.json(
        { error: 'That flow is not in this workspace.' },
        { status: 404 },
      );
    if (row.provider_id)
      return NextResponse.json(
        { error: 'This one is already at Meta.' },
        { status: 409 },
      );
    const access = await whatsAppTemplateAccess(organizationId);
    if (!access.ok)
      return NextResponse.json({ error: access.reason }, { status: 409 });
    let created;
    try {
      created = await createWhatsAppFlow(organizationId, {
        name: row.name,
        flowJson: toFlowJson({ screens: screensOf(row) }),
      });
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'Meta refused the flow.';
      await db
        .prepare(
          `UPDATE whatsapp_flows SET error = ? WHERE id = ? AND organization_id = ?`,
        )
        .bind(reason, id, organizationId)
        .run();
      return NextResponse.json({ error: reason }, { status: 502 });
    }
    await db
      .prepare(`UPDATE whatsapp_flows
        SET provider_id = ?, status = 'DRAFT', error = NULL, synced_at = CURRENT_TIMESTAMP
        WHERE id = ? AND organization_id = ?`)
      .bind(created.id, id, organizationId)
      .run();
    await recordAudit(auth.session, 'whatsapp.flow_sent', 'whatsapp_flow', id, {
      providerId: created.id,
    });
    return NextResponse.json({ ok: true, providerId: created.id });
  }

  if (action === 'publish_flow') {
    const id = text(input?.id);
    const row = await db
      .prepare(
        `SELECT id, provider_id, status FROM whatsapp_flows WHERE id = ? AND organization_id = ?`,
      )
      .bind(id, organizationId)
      .first<{ id: string; provider_id: string | null; status: string }>();
    if (!row)
      return NextResponse.json(
        { error: 'That flow is not in this workspace.' },
        { status: 404 },
      );
    if (!row.provider_id)
      return NextResponse.json(
        { error: 'Send it to Meta first.' },
        { status: 409 },
      );
    if (row.status === 'PUBLISHED')
      return NextResponse.json(
        { error: 'This one is already published.' },
        { status: 409 },
      );
    try {
      await publishWhatsAppFlow(organizationId, row.provider_id);
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'Meta refused to publish it.';
      await db
        .prepare(
          `UPDATE whatsapp_flows SET error = ? WHERE id = ? AND organization_id = ?`,
        )
        .bind(reason, id, organizationId)
        .run();
      return NextResponse.json({ error: reason }, { status: 502 });
    }
    await db
      .prepare(`UPDATE whatsapp_flows
        SET status = 'PUBLISHED', error = NULL, published_at = CURRENT_TIMESTAMP,
            synced_at = CURRENT_TIMESTAMP
        WHERE id = ? AND organization_id = ?`)
      .bind(id, organizationId)
      .run();
    await recordAudit(
      auth.session,
      'whatsapp.flow_published',
      'whatsapp_flow',
      id,
      {},
    );
    return NextResponse.json({ ok: true });
  }

  if (action === 'sync_flows') {
    const access = await whatsAppTemplateAccess(organizationId);
    if (!access.ok)
      return NextResponse.json({ error: access.reason }, { status: 409 });
    let remote;
    try {
      remote = await fetchWhatsAppFlows(organizationId);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Meta did not return the flows.',
        },
        { status: 502 },
      );
    }
    let updated = 0;
    for (const flow of remote) {
      const result = await db
        .prepare(`UPDATE whatsapp_flows
          SET status = ?, synced_at = CURRENT_TIMESTAMP
          WHERE organization_id = ? AND provider_id = ?`)
        .bind(flow.status, organizationId, flow.id)
        .run();
      if (result.meta?.changes) updated += 1;
    }
    await recordAudit(
      auth.session,
      'whatsapp.flows_synced',
      'whatsapp_flow',
      organizationId,
      { updated, seen: remote.length },
    );
    // Flows Meta knows about that this workspace does not are reported rather
    // than imported: their definition lives at Meta and copying a name here
    // would create a row that cannot be edited or sent.
    return NextResponse.json({
      ok: true,
      updated,
      unknown: remote.length - updated,
    });
  }

  if (action === 'delete_flow') {
    const id = text(input?.id);
    const row = await db
      .prepare(
        `SELECT id, status FROM whatsapp_flows WHERE id = ? AND organization_id = ?`,
      )
      .bind(id, organizationId)
      .first<{ id: string; status: string }>();
    if (!row)
      return NextResponse.json(
        { error: 'That flow is not in this workspace.' },
        { status: 404 },
      );
    await db
      .prepare(
        `DELETE FROM whatsapp_flows WHERE id = ? AND organization_id = ?`,
      )
      .bind(id, organizationId)
      .run();
    await recordAudit(
      auth.session,
      'whatsapp.flow_removed',
      'whatsapp_flow',
      id,
      {
        status: row.status,
      },
    );
    // Only the local row. Deleting at Meta is a separate act with its own
    // consequences for forms customers may have open.
    return NextResponse.json({
      ok: true,
      note:
        row.status === 'PUBLISHED'
          ? 'Removed from this list. The flow still exists at Meta.'
          : undefined,
    });
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
