import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import { recordAudit } from '@/lib/demo-seed';
import {
  checkOriginRule,
  isWidgetMode,
  MAX_DAILY_CAP,
  normaliseBranding,
  WIDGET_MODES,
  type WidgetMode,
} from '@/lib/web-widget';

export const dynamic = 'force-dynamic';

/**
 * Configuring the web voice widget (§8).
 *
 * `agents.manage`, because a published widget puts the workspace's agent on a
 * public web page and spends its credits doing so.
 */
export async function GET(request: Request) {
  const auth = await requireCustomerPermission(request, 'agents.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const organizationId = auth.session.organizationId!;
  const db = getRawDb();
  const origin = new URL(request.url).origin;

  const [rows, agents] = await Promise.all([
    db
      .prepare(`SELECT id, public_key, name, status, agent_id, allowed_origins_json,
        modes_json, branding_json, daily_cap, hourly_cap, created_at
        FROM web_widgets WHERE organization_id = ? ORDER BY created_at DESC LIMIT 20`)
      .bind(organizationId)
      .all<WidgetRow>(),
    db
      .prepare(
        `SELECT id, name FROM voice_agents WHERE organization_id = ? AND status = 'active' ORDER BY created_at`,
      )
      .bind(organizationId)
      .all<{ id: string; name: string }>(),
  ]);

  // Last 7 days of activity per widget, refusals included with their reason.
  // §8 asks for sessions, conversion and drop-off; a widget that quietly stops
  // answering is the thing people actually need to diagnose.
  const activity = await db
    .prepare(`SELECT widget_id, outcome, refusal_code, count(*) AS n
      FROM web_widget_sessions WHERE organization_id = ? AND created_at >= datetime('now','-7 day')
      GROUP BY widget_id, outcome, refusal_code`)
    .bind(organizationId)
    .all<{
      widget_id: string;
      outcome: string;
      refusal_code: string | null;
      n: number;
    }>();

  return NextResponse.json({
    widgets: (rows.results ?? []).map((row) => ({
      id: row.id,
      publicKey: row.public_key,
      name: row.name,
      status: row.status,
      agentId: row.agent_id,
      allowedOrigins: safeList(row.allowed_origins_json),
      modes: safeList(row.modes_json).filter(isWidgetMode),
      branding: normaliseBranding(safeObject(row.branding_json), row.name),
      dailyCap: row.daily_cap,
      hourlyCap: row.hourly_cap,
      embedCode: `<script async src="${origin}/api/widget/voice/${row.public_key}"></script>`,
      activity: (activity.results ?? [])
        .filter((entry) => entry.widget_id === row.id)
        .map((entry) => ({
          outcome: entry.outcome,
          reason: entry.refusal_code,
          count: entry.n,
        })),
    })),
    agents: agents.results ?? [],
    modes: WIDGET_MODES,
    maxDailyCap: MAX_DAILY_CAP,
  });
}

export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'agents.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const organizationId = auth.session.organizationId!;
  const db = getRawDb();
  const body = (await request.json()) as {
    action?: string;
    widgetId?: string;
    name?: string;
    agentId?: string | null;
    allowedOrigins?: unknown;
    modes?: unknown;
    branding?: unknown;
    dailyCap?: unknown;
    hourlyCap?: unknown;
    status?: string;
  };

  if (body.action === 'create') {
    const id = `widget_${crypto.randomUUID()}`;
    // A widget is created paused with no origins. It cannot answer anybody
    // until somebody has decided which sites may embed it — the setting that
    // matters most should not have a default.
    await db
      .prepare(`INSERT INTO web_widgets (id, organization_id, public_key, name, status)
        VALUES (?, ?, ?, ?, 'paused')`)
      .bind(
        id,
        organizationId,
        `wv_${crypto.randomUUID().replaceAll('-', '')}`,
        String(body.name ?? '')
          .trim()
          .slice(0, 80) || 'Website assistant',
      )
      .run();
    await recordAudit(auth.session, 'web_widget.created', 'web_widget', id, {});
    return NextResponse.json({ ok: true, widgetId: id });
  }

  if (body.action === 'save') {
    const owned = await db
      .prepare(
        `SELECT id FROM web_widgets WHERE id = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(body.widgetId, organizationId)
      .first<{ id: string }>();
    if (!owned)
      return NextResponse.json({ error: 'Widget not found.' }, { status: 404 });

    // Every origin is checked as it is saved, so a typo is refused while
    // somebody is looking at it rather than at 2am when the widget stops
    // answering and nobody knows why.
    const entries = Array.isArray(body.allowedOrigins)
      ? body.allowedOrigins.map((entry: unknown) =>
          typeof entry === 'string' ? entry : '',
        )
      : [];
    const checked = entries.map((entry) => checkOriginRule(entry));
    const rejected = checked.filter((rule) => rule.value && rule.problem);
    if (rejected.length > 0)
      return NextResponse.json(
        {
          error: rejected
            .map((rule) => `${rule.value}: ${rule.problem}`)
            .join(' '),
        },
        { status: 400 },
      );
    const origins = checked
      .filter((rule) => rule.value && !rule.problem)
      .map((rule) => rule.value);

    const modes = (Array.isArray(body.modes) ? body.modes : []).filter(
      (entry: unknown): entry is WidgetMode => isWidgetMode(entry),
    );
    if (modes.length === 0)
      return NextResponse.json(
        { error: 'Switch on at least one of voice, text or callback.' },
        { status: 400 },
      );

    const status = body.status === 'active' ? 'active' : 'paused';
    if (status === 'active' && origins.length === 0)
      return NextResponse.json(
        {
          // The one refusal worth spelling out: a live widget with no origin
          // list is a public endpoint anybody can point at their own page.
          error:
            'Add the websites this widget may run on before switching it on. Without that list, any site on the internet could start calls on your account.',
        },
        { status: 400 },
      );

    await db
      .prepare(`UPDATE web_widgets SET name = ?, agent_id = ?, status = ?,
        allowed_origins_json = ?, modes_json = ?, branding_json = ?,
        daily_cap = ?, hourly_cap = ? WHERE id = ? AND organization_id = ?`)
      .bind(
        String(body.name ?? '')
          .trim()
          .slice(0, 80) || 'Website assistant',
        typeof body.agentId === 'string' && body.agentId ? body.agentId : null,
        status,
        JSON.stringify(origins),
        JSON.stringify(modes),
        JSON.stringify(normaliseBranding(body.branding, 'Website assistant')),
        bounded(body.dailyCap, 1, MAX_DAILY_CAP, 200),
        bounded(body.hourlyCap, 1, MAX_DAILY_CAP, 40),
        body.widgetId,
        organizationId,
      )
      .run();
    await recordAudit(
      auth.session,
      `web_widget.${status}`,
      'web_widget',
      String(body.widgetId),
      {
        origins: origins.length,
        modes,
      },
    );
    return NextResponse.json({ ok: true, status });
  }

  if (body.action === 'delete') {
    await db
      .prepare(`DELETE FROM web_widgets WHERE id = ? AND organization_id = ?`)
      .bind(body.widgetId, organizationId)
      .run();
    await recordAudit(
      auth.session,
      'web_widget.deleted',
      'web_widget',
      String(body.widgetId),
      {},
    );
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}

type WidgetRow = {
  id: string;
  public_key: string;
  name: string;
  status: string;
  agent_id: string | null;
  allowed_origins_json: string;
  modes_json: string;
  branding_json: string;
  daily_cap: number;
  hourly_cap: number;
  created_at: string;
};

function bounded(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function safeList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry: unknown): entry is string => typeof entry === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

function safeObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
