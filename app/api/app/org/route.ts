import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import {
  requireAnyCustomerPermission,
  requireCustomerPermission,
  type CustomerPermission,
} from '@/lib/customer-rbac';
import { recordAudit } from '@/lib/demo-seed';
import { SUPPORTED_LANGUAGE_CODES } from '@/lib/languages';
import { agentOnShift, formatMinute, minuteOfDay } from '@/lib/shifts';

export const dynamic = 'force-dynamic';

const ROUTE_TYPES = [
  'reception',
  'sales',
  'support',
  'campaign',
  'vip',
  'overflow',
];
const OFF_HOURS_ACTIONS = ['voicemail', 'callback', 'queue', 'reject'];

/** Branches, departments, teams, shifts, number routes and contacts (§5-6). */
export async function GET(request: Request) {
  const auth = await requireAnyCustomerPermission(request, [
    'workspace.manage',
    'telephony.manage',
    'calls.monitor',
    'crm.manage',
  ]);
  if (auth.response) return auth.response;
  const db = getRawDb();
  const organizationId = auth.session.organizationId;

  const [branches, departments, teams, shifts, routes, numbers, contacts] =
    await Promise.all([
      db
        .prepare(`SELECT id, name, code, city, timezone, status,
          (SELECT count(*) FROM support_agents a WHERE a.branch_id = b.id) AS agent_count
        FROM branches b WHERE b.organization_id = ? ORDER BY b.name`)
        .bind(organizationId)
        .all(),
      db
        .prepare(
          `SELECT id, name, code, status FROM departments WHERE organization_id = ? ORDER BY name`,
        )
        .bind(organizationId)
        .all(),
      db
        .prepare(`SELECT t.id, t.name, t.status, t.branch_id, t.department_id,
          b.name AS branch_name, d.name AS department_name,
          (SELECT count(*) FROM support_agents a WHERE a.team_id = t.id) AS member_count
        FROM teams t
        LEFT JOIN branches b ON b.id = t.branch_id
        LEFT JOIN departments d ON d.id = t.department_id
        WHERE t.organization_id = ? ORDER BY t.name`)
        .bind(organizationId)
        .all(),
      db
        .prepare(`SELECT s.id, s.support_agent_id, s.team_id, s.name, s.days_json,
          s.start_minute, s.end_minute, s.break_start_minute, s.break_end_minute,
          s.timezone, s.status, a.name AS agent_name
        FROM shifts s LEFT JOIN support_agents a ON a.id = s.support_agent_id
        WHERE s.organization_id = ? ORDER BY a.name, s.start_minute`)
        .bind(organizationId)
        .all(),
      db
        .prepare(`SELECT r.id, r.number_id, r.route_type, r.agent_id, r.queue_id,
          r.campaign_id, r.branch_id, r.language, r.priority, r.off_hours_action,
          r.status, n.phone_number, va.name AS agent_name, q.slug AS queue_slug,
          c.name AS campaign_name
        FROM number_routes r
        INNER JOIN phone_numbers n ON n.id = r.number_id
        LEFT JOIN voice_agents va ON va.id = r.agent_id
        LEFT JOIN queues q ON q.id = r.queue_id
        LEFT JOIN campaigns c ON c.id = r.campaign_id
        WHERE r.organization_id = ? ORDER BY n.phone_number, r.priority`)
        .bind(organizationId)
        .all(),
      db
        .prepare(`SELECT id, phone_number, status, direction, assigned_agent_name,
          (SELECT count(*) FROM number_routes r WHERE r.number_id = phone_numbers.id) AS route_count
        FROM phone_numbers WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100`)
        .bind(organizationId)
        .all(),
      db
        .prepare(`SELECT id, full_name, phone, email, preferred_language,
          consent_status, tags_json, last_contacted_at, lead_id, created_at
        FROM contacts WHERE organization_id = ? ORDER BY updated_at DESC LIMIT 200`)
        .bind(organizationId)
        .all(),
    ]);

  // Show whether each shift is covering right now, so "why did nobody get
  // this call" is answerable from the screen.
  const now = new Date();
  const asText = (value: unknown, fallback: string) =>
    typeof value === 'string' ? value : fallback;
  const shiftRows = (shifts.results ?? []).map((row) => {
    const record = row as Record<string, unknown>;
    let days: number[] = [];
    try {
      const parsed = JSON.parse(asText(record.days_json, '[]')) as unknown;
      days = Array.isArray(parsed) ? parsed.map((item) => Number(item)) : [];
    } catch {
      days = [];
    }
    const verdict = agentOnShift(
      [
        {
          days,
          startMinute: Number(record.start_minute),
          endMinute: Number(record.end_minute),
          breakStartMinute:
            record.break_start_minute === null
              ? null
              : Number(record.break_start_minute),
          breakEndMinute:
            record.break_end_minute === null
              ? null
              : Number(record.break_end_minute),
          timezone: asText(record.timezone, 'Asia/Kolkata'),
          status: asText(record.status, 'active'),
        },
      ],
      now,
    );
    return {
      ...record,
      days,
      start_label: formatMinute(Number(record.start_minute)),
      end_label: formatMinute(Number(record.end_minute)),
      covering_now: verdict.onShift,
      coverage_reason: verdict.reason,
    };
  });

  return NextResponse.json({
    branches: branches.results ?? [],
    departments: departments.results ?? [],
    teams: teams.results ?? [],
    shifts: shiftRows,
    numberRoutes: routes.results ?? [],
    numbers: numbers.results ?? [],
    contacts: contacts.results ?? [],
    routeTypes: ROUTE_TYPES,
    offHoursActions: OFF_HOURS_ACTIONS,
    checkedAt: now.toISOString(),
  });
}

const ACTION_PERMISSIONS: Record<string, CustomerPermission> = {
  create_branch: 'workspace.manage',
  delete_branch: 'workspace.manage',
  create_department: 'workspace.manage',
  create_team: 'workspace.manage',
  assign_agent: 'workspace.manage',
  create_shift: 'workspace.manage',
  delete_shift: 'workspace.manage',
  set_agent_languages: 'workspace.manage',
  create_number_route: 'telephony.manage',
  delete_number_route: 'telephony.manage',
  upsert_contact: 'crm.manage',
};

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const action = typeof body.action === 'string' ? body.action : '';
  const permission = ACTION_PERMISSIONS[action] ?? 'workspace.manage';
  const auth = await requireCustomerPermission(request, permission);
  if (auth.response) return auth.response;
  const db = getRawDb();
  const organizationId = auth.session.organizationId!;
  const text = (value: unknown, max = 120) =>
    typeof value === 'string' ? value.trim().slice(0, max) : '';
  const bounded = (value: unknown, min: number, max: number, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? Math.min(max, Math.max(min, Math.round(parsed)))
      : fallback;
  };
  const owned = async (table: string, id: string) => {
    if (!id) return true;
    const row = await db
      .prepare(
        `SELECT id FROM ${table} WHERE id = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(id, organizationId)
      .first<{ id: string }>();
    return Boolean(row);
  };

  if (action === 'create_branch') {
    const name = text(body.name, 80);
    if (!name)
      return NextResponse.json(
        { error: 'Branch name is required.' },
        { status: 400 },
      );
    const branchId = `branch_${crypto.randomUUID()}`;
    await db
      .prepare(`INSERT INTO branches (id, organization_id, name, code, city, timezone)
        VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(
        branchId,
        organizationId,
        name,
        text(body.code, 20) || null,
        text(body.city, 60) || null,
        text(body.timezone, 60) || 'Asia/Kolkata',
      )
      .run();
    await recordAudit(auth.session, 'branch.created', 'branch', branchId, {
      name,
    });
    return NextResponse.json({ ok: true, branchId });
  }

  if (action === 'delete_branch') {
    const branchId = text(body.branchId, 80);
    const result = await db
      .prepare(`DELETE FROM branches WHERE id = ? AND organization_id = ?`)
      .bind(branchId, organizationId)
      .run();
    if (!result.meta.changes)
      return NextResponse.json({ error: 'Branch not found.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  if (action === 'create_department') {
    const name = text(body.name, 80);
    if (!name)
      return NextResponse.json(
        { error: 'Department name is required.' },
        { status: 400 },
      );
    const departmentId = `dept_${crypto.randomUUID()}`;
    await db
      .prepare(
        `INSERT INTO departments (id, organization_id, name, code) VALUES (?, ?, ?, ?)`,
      )
      .bind(departmentId, organizationId, name, text(body.code, 20) || null)
      .run();
    return NextResponse.json({ ok: true, departmentId });
  }

  if (action === 'create_team') {
    const name = text(body.name, 80);
    const branchId = text(body.branchId, 80);
    const departmentId = text(body.departmentId, 80);
    if (!name)
      return NextResponse.json(
        { error: 'Team name is required.' },
        { status: 400 },
      );
    if (!(await owned('branches', branchId)))
      return NextResponse.json({ error: 'Branch not found.' }, { status: 404 });
    if (!(await owned('departments', departmentId)))
      return NextResponse.json(
        { error: 'Department not found.' },
        { status: 404 },
      );
    const teamId = `team_${crypto.randomUUID()}`;
    await db
      .prepare(`INSERT INTO teams (id, organization_id, branch_id, department_id, name)
        VALUES (?, ?, ?, ?, ?)`)
      .bind(
        teamId,
        organizationId,
        branchId || null,
        departmentId || null,
        name,
      )
      .run();
    return NextResponse.json({ ok: true, teamId });
  }

  if (action === 'assign_agent') {
    const agentId = text(body.supportAgentId, 80);
    const branchId = text(body.branchId, 80);
    const teamId = text(body.teamId, 80);
    const departmentId = text(body.departmentId, 80);
    if (!(await owned('support_agents', agentId)))
      return NextResponse.json({ error: 'Agent not found.' }, { status: 404 });
    if (!(await owned('branches', branchId)))
      return NextResponse.json({ error: 'Branch not found.' }, { status: 404 });
    if (!(await owned('teams', teamId)))
      return NextResponse.json({ error: 'Team not found.' }, { status: 404 });
    if (!(await owned('departments', departmentId)))
      return NextResponse.json(
        { error: 'Department not found.' },
        { status: 404 },
      );
    await db
      .prepare(`UPDATE support_agents SET branch_id = ?, team_id = ?, department_id = ?,
        updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`)
      .bind(
        branchId || null,
        teamId || null,
        departmentId || null,
        agentId,
        organizationId,
      )
      .run();
    return NextResponse.json({ ok: true });
  }

  if (action === 'create_shift') {
    const agentId = text(body.supportAgentId, 80);
    if (!(await owned('support_agents', agentId)))
      return NextResponse.json({ error: 'Agent not found.' }, { status: 404 });
    const start = minuteOfDay(text(body.start, 5));
    const end = minuteOfDay(text(body.end, 5));
    if (start === null || end === null)
      return NextResponse.json(
        { error: 'Start and end must be HH:MM in 24-hour time.' },
        { status: 400 },
      );
    if (start === end)
      return NextResponse.json(
        { error: 'A shift cannot start and end at the same minute.' },
        { status: 400 },
      );
    const breakStart = text(body.breakStart, 5)
      ? minuteOfDay(text(body.breakStart, 5))
      : null;
    const breakEnd = text(body.breakEnd, 5)
      ? minuteOfDay(text(body.breakEnd, 5))
      : null;
    if (
      (breakStart === null) !== (breakEnd === null) ||
      breakStart === undefined
    )
      return NextResponse.json(
        { error: 'Give both a break start and a break end, or neither.' },
        { status: 400 },
      );
    const days = Array.isArray(body.days)
      ? Array.from(
          new Set(
            body.days
              .map((item) => Number(item))
              .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6),
          ),
        )
      : [];
    if (!days.length)
      return NextResponse.json(
        { error: 'Choose at least one day.' },
        { status: 400 },
      );
    const shiftId = `shift_${crypto.randomUUID()}`;
    await db
      .prepare(`INSERT INTO shifts
        (id, organization_id, support_agent_id, name, days_json, start_minute,
         end_minute, break_start_minute, break_end_minute, timezone)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        shiftId,
        organizationId,
        agentId,
        text(body.name, 60) || null,
        JSON.stringify(days),
        start,
        end,
        breakStart,
        breakEnd,
        text(body.timezone, 60) || 'Asia/Kolkata',
      )
      .run();
    await recordAudit(auth.session, 'shift.created', 'support_agent', agentId, {
      start: formatMinute(start),
      end: formatMinute(end),
      days,
    });
    return NextResponse.json({ ok: true, shiftId });
  }

  if (action === 'delete_shift') {
    const shiftId = text(body.shiftId, 80);
    const result = await db
      .prepare(`DELETE FROM shifts WHERE id = ? AND organization_id = ?`)
      .bind(shiftId, organizationId)
      .run();
    if (!result.meta.changes)
      return NextResponse.json({ error: 'Shift not found.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  if (action === 'set_agent_languages') {
    const agentId = text(body.supportAgentId, 80);
    if (!(await owned('support_agents', agentId)))
      return NextResponse.json({ error: 'Agent not found.' }, { status: 404 });
    const languages = Array.isArray(body.languages)
      ? Array.from(
          new Set(
            body.languages
              .map((item) => String(item))
              .filter((item) => SUPPORTED_LANGUAGE_CODES.has(item)),
          ),
        )
      : [];
    await db
      .prepare(
        `DELETE FROM agent_languages WHERE support_agent_id = ? AND organization_id = ?`,
      )
      .bind(agentId, organizationId)
      .run();
    for (const language of languages) {
      await db
        .prepare(`INSERT INTO agent_languages
          (id, organization_id, support_agent_id, language) VALUES (?, ?, ?, ?)`)
        .bind(
          `al_${crypto.randomUUID()}`,
          organizationId,
          agentId,
          language,
        )
        .run();
    }
    // Routing reads languages_json, so keep the two in step rather than
    // leaving a second source of truth that silently disagrees.
    await db
      .prepare(
        `UPDATE support_agents SET languages_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .bind(JSON.stringify(languages), agentId)
      .run();
    return NextResponse.json({ ok: true, languages });
  }

  if (action === 'create_number_route') {
    const numberId = text(body.numberId, 80);
    if (!(await owned('phone_numbers', numberId)))
      return NextResponse.json({ error: 'Number not found.' }, { status: 404 });
    const routeType = ROUTE_TYPES.includes(text(body.routeType, 30))
      ? text(body.routeType, 30)
      : 'reception';
    const agentId = text(body.agentId, 80);
    const queueId = text(body.queueId, 80);
    const campaignId = text(body.campaignId, 80);
    if (!(await owned('voice_agents', agentId)))
      return NextResponse.json(
        { error: 'Voice agent not found.' },
        { status: 404 },
      );
    if (!(await owned('queues', queueId)))
      return NextResponse.json({ error: 'Queue not found.' }, { status: 404 });
    if (!(await owned('campaigns', campaignId)))
      return NextResponse.json(
        { error: 'Campaign not found.' },
        { status: 404 },
      );
    if (!agentId && !queueId && !campaignId)
      return NextResponse.json(
        {
          error:
            'A route must point at a voice agent, a queue or a campaign — otherwise it does nothing.',
        },
        { status: 400 },
      );
    const routeId = `nroute_${crypto.randomUUID()}`;
    await db
      .prepare(`INSERT INTO number_routes
        (id, organization_id, number_id, route_type, agent_id, queue_id,
         campaign_id, branch_id, language, priority, off_hours_action)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        routeId,
        organizationId,
        numberId,
        routeType,
        agentId || null,
        queueId || null,
        campaignId || null,
        text(body.branchId, 80) || null,
        text(body.language, 20) || null,
        bounded(body.priority, 1, 1000, 100),
        OFF_HOURS_ACTIONS.includes(text(body.offHoursAction, 20))
          ? text(body.offHoursAction, 20)
          : 'voicemail',
      )
      .run();
    await recordAudit(
      auth.session,
      'number_route.created',
      'phone_number',
      numberId,
      { routeType },
    );
    return NextResponse.json({ ok: true, routeId });
  }

  if (action === 'delete_number_route') {
    const routeId = text(body.routeId, 80);
    const result = await db
      .prepare(`DELETE FROM number_routes WHERE id = ? AND organization_id = ?`)
      .bind(routeId, organizationId)
      .run();
    if (!result.meta.changes)
      return NextResponse.json({ error: 'Route not found.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  if (action === 'upsert_contact') {
    const phone = text(body.phone, 20);
    if (!/^\+?\d{8,15}$/.test(phone))
      return NextResponse.json(
        { error: 'A valid phone number is required.' },
        { status: 400 },
      );
    const contactId = `contact_${crypto.randomUUID()}`;
    await db
      .prepare(`INSERT INTO contacts
        (id, organization_id, full_name, phone, email, preferred_language, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(organization_id, phone) DO UPDATE SET
          full_name = coalesce(excluded.full_name, contacts.full_name),
          email = coalesce(excluded.email, contacts.email),
          preferred_language = coalesce(excluded.preferred_language, contacts.preferred_language),
          notes = coalesce(excluded.notes, contacts.notes),
          updated_at = CURRENT_TIMESTAMP`)
      .bind(
        contactId,
        organizationId,
        text(body.fullName, 120) || null,
        phone,
        text(body.email, 160) || null,
        SUPPORTED_LANGUAGE_CODES.has(text(body.preferredLanguage, 20))
          ? text(body.preferredLanguage, 20)
          : null,
        text(body.notes, 600) || null,
      )
      .run();
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
}
