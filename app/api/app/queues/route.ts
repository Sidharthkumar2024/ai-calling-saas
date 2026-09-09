import { NextResponse } from 'next/server';
import { archiveOrgConfig, restoreOrgConfig } from '@/lib/org-config-service';

import { getRawDb } from '@/db/index';
import {
  requireAnyCustomerPermission,
  requireCustomerPermission,
  type CustomerPermission,
} from '@/lib/customer-rbac';
import { recordAudit } from '@/lib/demo-seed';
import { copilotForHandoff } from '@/lib/copilot';
import { initiateWarmTransfer, resolveRouting } from '@/lib/handoff-service';
import { queueRemoval } from '@/lib/agent-lifecycle';
import { ROUTING_STRATEGIES } from '@/lib/routing';

export const dynamic = 'force-dynamic';

const OVERFLOW_ACTIONS = [
  'callback',
  'ticket',
  'ai_continue',
  'overflow_queue',
];
const MATCH_TYPES = ['skill', 'language', 'number', 'use_case', 'reason'];
const DISPOSITIONS = [
  'resolved',
  'follow_up',
  'escalated',
  'no_answer',
  'not_interested',
];

/** Queue configuration, the agent's own inbox and the supervisor wallboard. */
export async function GET(request: Request) {
  const auth = await requireAnyCustomerPermission(request, [
    'calls.monitor',
    'workspace.manage',
  ]);
  if (auth.response) return auth.response;
  const db = getRawDb();
  const organizationId = auth.session.organizationId;
  if (new URL(request.url).searchParams.get('view') === 'events') {
    const [calls, handoffs] = await Promise.all([
      db
        .prepare(
          "SELECT id, status, channel FROM call_records WHERE organization_id = ? AND channel = 'phone' AND status IN ('queued','ringing','in_progress','connected') ORDER BY started_at DESC LIMIT 50",
        )
        .bind(organizationId)
        .all(),
      db
        .prepare(
          "SELECT id, status FROM handoffs WHERE organization_id = ? AND status IN ('queued','assigned','accepted') ORDER BY created_at DESC LIMIT 50",
        )
        .bind(organizationId)
        .all(),
    ]);
    return NextResponse.json(
      { calls: calls.results, handoffs: handoffs.results },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const [queues, agents, rules, waiting, active, recent, members] =
    await Promise.all([
      db
        .prepare(`SELECT q.id, q.name, q.slug, q.description, q.strategy, q.priority,
        q.required_skill, q.language, q.min_role, q.sla_seconds, q.overflow_action,
        q.overflow_queue_id, q.status,
        (SELECT count(*) FROM queue_members m WHERE m.queue_id = q.id) AS member_count,
        (SELECT count(*) FROM queue_members m
           INNER JOIN support_agents a ON a.id = m.support_agent_id
           WHERE m.queue_id = q.id AND a.availability = 'online') AS online_count,
        (SELECT count(*) FROM handoffs h
           WHERE h.queue_id = q.id AND h.status = 'queued') AS waiting_count
      FROM queues q WHERE q.organization_id = ? ORDER BY q.priority, q.name`)
        .bind(organizationId)
        .all(),
      db
        .prepare(`SELECT id, user_id, name, role, skills_json, languages_json,
        availability, active_calls, coalesce(max_concurrent_calls, 1) AS max_concurrent_calls,
        priority_tier, last_assigned_at, presence_changed_at
      FROM support_agents WHERE organization_id = ? ORDER BY name`)
        .bind(organizationId)
        .all(),
      db
        .prepare(`SELECT r.id, r.name, r.match_type, r.match_value, r.queue_id,
        r.priority, r.status, q.slug AS queue_slug
      FROM routing_rules r LEFT JOIN queues q ON q.id = r.queue_id
      WHERE r.organization_id = ? ORDER BY r.priority`)
        .bind(organizationId)
        .all(),
      db
        .prepare(`SELECT h.id, h.reason, h.summary, h.ai_summary, h.skill, h.language,
        h.status, h.queue_id, h.enqueued_at, h.session_id, q.slug AS queue_slug,
        q.sla_seconds,
        cast((strftime('%s','now') - strftime('%s', coalesce(h.enqueued_at, h.created_at))) AS INTEGER) AS waiting_seconds
      FROM handoffs h LEFT JOIN queues q ON q.id = h.queue_id
      WHERE h.organization_id = ? AND h.status = 'queued'
      ORDER BY coalesce(h.enqueued_at, h.created_at) LIMIT 50`)
        .bind(organizationId)
        .all(),
      db
        .prepare(`SELECT h.id, h.reason, h.ai_summary, h.status, h.assigned_agent_id,
        h.accepted_at, h.queue_id, h.call_id, h.session_id,
        a.name AS agent_name, q.slug AS queue_slug
      FROM handoffs h
      LEFT JOIN support_agents a ON a.id = h.assigned_agent_id
      LEFT JOIN queues q ON q.id = h.queue_id
      WHERE h.organization_id = ? AND h.status IN ('assigned','accepted')
      ORDER BY h.created_at DESC LIMIT 50`)
        .bind(organizationId)
        .all(),
      db
        .prepare(`SELECT h.id, h.reason, h.status, h.disposition, h.disposition_notes,
        h.created_at, a.name AS agent_name, q.slug AS queue_slug
      FROM handoffs h
      LEFT JOIN support_agents a ON a.id = h.assigned_agent_id
      LEFT JOIN queues q ON q.id = h.queue_id
      WHERE h.organization_id = ? AND h.status IN ('completed','abandoned')
      ORDER BY h.created_at DESC LIMIT 25`)
        .bind(organizationId)
        .all(),
      db
        .prepare(`SELECT queue_id, support_agent_id, priority FROM queue_members
        WHERE organization_id = ? ORDER BY priority`)
        .bind(organizationId)
        .all(),
    ]);

  // The support agent record belonging to the signed-in user, if any — this is
  // what makes the Agent Desk personal rather than a shared list.
  const me = (agents.results ?? []).find(
    (row) => (row as { user_id?: string }).user_id === auth.session.userId,
  );

  const waitingRows = (waiting.results ?? []) as Array<Record<string, unknown>>;
  const breaching = waitingRows.filter(
    (row) => Number(row.waiting_seconds ?? 0) > Number(row.sla_seconds ?? 60),
  ).length;
  const agentRows = (agents.results ?? []) as Array<Record<string, unknown>>;

  return NextResponse.json({
    queues: queues.results ?? [],
    // Who is in each queue. The list carried a member count and nothing else,
    // so a screen could say "0 members" and offer no way to change it — and
    // routing to a queue looks only at its members, which meant a queue with
    // none reached nobody, every time.
    queueMembers: members.results ?? [],
    agents: agentRows,
    rules: rules.results ?? [],
    waiting: waitingRows,
    activeHandoffs: active.results ?? [],
    recentHandoffs: recent.results ?? [],
    me: me ?? null,
    strategies: ROUTING_STRATEGIES,
    overflowActions: OVERFLOW_ACTIONS,
    matchTypes: MATCH_TYPES,
    dispositions: DISPOSITIONS,
    wallboard: {
      waiting: waitingRows.length,
      slaBreaching: breaching,
      longestWaitSeconds: waitingRows.reduce(
        (max, row) => Math.max(max, Number(row.waiting_seconds ?? 0)),
        0,
      ),
      humanActive: (active.results ?? []).length,
      agentsOnline: agentRows.filter((row) => row.availability === 'online')
        .length,
      agentsBusy: agentRows.filter((row) => row.availability === 'busy').length,
      agentsOffline: agentRows.filter((row) => row.availability === 'offline')
        .length,
      capacityFree: agentRows.reduce(
        (total, row) =>
          row.availability === 'online'
            ? total +
              Math.max(
                0,
                Number(row.max_concurrent_calls ?? 1) -
                  Number(row.active_calls ?? 0),
              )
            : total,
        0,
      ),
    },
  });
}

const ACTION_PERMISSIONS: Record<string, CustomerPermission> = {
  create_queue: 'workspace.manage',
  update_queue: 'workspace.manage',
  delete_queue: 'workspace.manage',
  add_member: 'workspace.manage',
  remove_member: 'workspace.manage',
  create_rule: 'workspace.manage',
  delete_rule: 'workspace.manage',
  set_presence: 'calls.monitor',
  accept_handoff: 'calls.monitor',
  reject_handoff: 'calls.monitor',
  wrap_up: 'calls.monitor',
  test_route: 'calls.monitor',
  request_takeover: 'calls.monitor',
  copilot: 'calls.monitor',
};

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const action = typeof body.action === 'string' ? body.action : '';
  // Unknown actions fall to the most restrictive permission so a new handler
  // cannot ship unguarded.
  const permission = ACTION_PERMISSIONS[action] ?? 'workspace.manage';
  const auth = await requireCustomerPermission(request, permission);
  if (auth.response) return auth.response;
  const db = getRawDb();
  const organizationId = auth.session.organizationId!;
  const text = (value: unknown, max = 120) =>
    typeof value === 'string' ? value.trim().slice(0, max) : '';
  const bounded = (
    value: unknown,
    min: number,
    max: number,
    fallback: number,
  ) => {
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? Math.min(max, Math.max(min, Math.round(parsed)))
      : fallback;
  };

  if (action === 'create_queue' || action === 'update_queue') {
    const name = text(body.name, 80);
    if (!name)
      return NextResponse.json(
        { error: 'Queue name is required.' },
        { status: 400 },
      );
    const strategy = ROUTING_STRATEGIES.includes(
      text(body.strategy) as (typeof ROUTING_STRATEGIES)[number],
    )
      ? text(body.strategy)
      : 'skill_first';
    const overflow = OVERFLOW_ACTIONS.includes(text(body.overflowAction))
      ? text(body.overflowAction)
      : 'callback';
    const slug =
      text(body.slug, 40)
        .toLowerCase()
        .replaceAll(/[^a-z0-9_-]/g, '-') ||
      name
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, '-')
        .slice(0, 40);
    // An overflow queue must exist in this workspace, or overflow silently
    // dead-ends at routing time.
    let overflowQueueId = text(body.overflowQueueId, 80) || null;
    if (overflow === 'overflow_queue') {
      const target = overflowQueueId
        ? await db
            .prepare(
              `SELECT id FROM queues WHERE id = ? AND organization_id = ? LIMIT 1`,
            )
            .bind(overflowQueueId, organizationId)
            .first<{ id: string }>()
        : null;
      if (!target)
        return NextResponse.json(
          { error: 'Choose an existing queue to overflow into.' },
          { status: 400 },
        );
    } else {
      overflowQueueId = null;
    }

    if (action === 'update_queue') {
      const queueId = text(body.queueId, 80);
      if (queueId === overflowQueueId)
        return NextResponse.json(
          { error: 'A queue cannot overflow into itself.' },
          { status: 400 },
        );
      const result = await db
        .prepare(`UPDATE queues SET name = ?, description = ?, strategy = ?,
          priority = ?, required_skill = ?, language = ?, min_role = ?,
          sla_seconds = ?, overflow_action = ?, overflow_queue_id = ?,
          status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND organization_id = ?`)
        .bind(
          name,
          text(body.description, 240) || null,
          strategy,
          bounded(body.priority, 1, 1000, 100),
          text(body.requiredSkill, 60) || null,
          text(body.language, 20) || null,
          text(body.minRole, 30) || null,
          bounded(body.slaSeconds, 5, 3600, 60),
          overflow,
          overflowQueueId,
          text(body.status, 20) === 'paused' ? 'paused' : 'active',
          queueId,
          organizationId,
        )
        .run();
      if (!result.meta.changes)
        return NextResponse.json(
          { error: 'Queue not found.' },
          { status: 404 },
        );
      await recordAudit(auth.session, 'queue.updated', 'queue', queueId, {
        strategy,
        overflow,
      });
      return NextResponse.json({ ok: true, queueId });
    }

    const queueId = `queue_${crypto.randomUUID()}`;
    try {
      await db
        .prepare(`INSERT INTO queues
          (id, organization_id, name, slug, description, strategy, priority,
           required_skill, language, min_role, sla_seconds, overflow_action, overflow_queue_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          queueId,
          organizationId,
          name,
          slug,
          text(body.description, 240) || null,
          strategy,
          bounded(body.priority, 1, 1000, 100),
          text(body.requiredSkill, 60) || null,
          text(body.language, 20) || null,
          text(body.minRole, 30) || null,
          bounded(body.slaSeconds, 5, 3600, 60),
          overflow,
          overflowQueueId,
        )
        .run();
    } catch {
      return NextResponse.json(
        { error: 'A queue with that slug already exists.' },
        { status: 409 },
      );
    }
    await recordAudit(auth.session, 'queue.created', 'queue', queueId, {
      slug,
      strategy,
    });
    return NextResponse.json({ ok: true, queueId, slug });
  }

  if (action === 'delete_queue') {
    const queueId = text(body.queueId, 80);
    const queue = await db
      .prepare(
        `SELECT id FROM queues WHERE id = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(queueId, organizationId)
      .first<{ id: string }>();
    if (!queue)
      return NextResponse.json({ error: 'Queue not found.' }, { status: 404 });

    // What still points at it. This used to be a bare DELETE, and the schema
    // cascades: it took the queue's routing rules with it — the same rules the
    // handler below archives rather than deletes, precisely so the record of
    // why calls went where survives — and blanked `queue_id` on every handoff
    // and number route besides.
    const references = await db
      .prepare(`SELECT
        (SELECT count(*) FROM handoffs WHERE queue_id = ?) AS handoffs,
        (SELECT count(*) FROM routing_rules WHERE queue_id = ?) AS rules,
        (SELECT count(*) FROM number_routes WHERE queue_id = ?) AS numberRoutes,
        (SELECT count(*) FROM queue_members WHERE queue_id = ?) AS members`)
      .bind(queueId, queueId, queueId, queueId)
      .first<{
        handoffs: number;
        rules: number;
        numberRoutes: number;
        members: number;
      }>();
    const removal = queueRemoval(references ?? {});
    if (!removal.deletable) {
      await db
        .prepare(
          `UPDATE queues SET status = 'archived', updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND organization_id = ?`,
        )
        .bind(queueId, organizationId)
        .run();
      await recordAudit(auth.session, 'queue.archived', 'queue', queueId, {
        held: removal.counts,
      });
      return NextResponse.json({
        ok: true,
        archived: true,
        reason: removal.reason,
      });
    }

    await db
      .prepare(`DELETE FROM queues WHERE id = ? AND organization_id = ?`)
      .bind(queueId, organizationId)
      .run();
    await recordAudit(auth.session, 'queue.deleted', 'queue', queueId, {});
    return NextResponse.json({ ok: true, archived: false });
  }

  if (action === 'add_member' || action === 'remove_member') {
    const queueId = text(body.queueId, 80);
    const agentId = text(body.supportAgentId, 80);
    const queue = await db
      .prepare(
        `SELECT id FROM queues WHERE id = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(queueId, organizationId)
      .first<{ id: string }>();
    const agent = await db
      .prepare(
        `SELECT id FROM support_agents WHERE id = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(agentId, organizationId)
      .first<{ id: string }>();
    if (!queue || !agent)
      return NextResponse.json(
        { error: 'Queue or agent not found.' },
        { status: 404 },
      );
    if (action === 'remove_member') {
      await db
        .prepare(
          `DELETE FROM queue_members WHERE queue_id = ? AND support_agent_id = ? AND organization_id = ?`,
        )
        .bind(queueId, agentId, organizationId)
        .run();
      return NextResponse.json({ ok: true });
    }
    await db
      .prepare(`INSERT INTO queue_members
        (id, organization_id, queue_id, support_agent_id, priority)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(queue_id, support_agent_id) DO UPDATE SET priority = excluded.priority`)
      .bind(
        `qm_${crypto.randomUUID()}`,
        organizationId,
        queueId,
        agentId,
        bounded(body.priority, 1, 1000, 100),
      )
      .run();
    return NextResponse.json({ ok: true });
  }

  if (action === 'create_rule') {
    const matchType = MATCH_TYPES.includes(text(body.matchType))
      ? text(body.matchType)
      : '';
    const matchValue = text(body.matchValue, 80);
    const queueId = text(body.queueId, 80);
    if (!matchType || !matchValue)
      return NextResponse.json(
        { error: 'Match type and value are required.' },
        { status: 400 },
      );
    const queue = await db
      .prepare(
        `SELECT id FROM queues WHERE id = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(queueId, organizationId)
      .first<{ id: string }>();
    if (!queue)
      return NextResponse.json({ error: 'Queue not found.' }, { status: 404 });
    const ruleId = `rr_${crypto.randomUUID()}`;
    await db
      .prepare(`INSERT INTO routing_rules
        (id, organization_id, name, match_type, match_value, queue_id, priority)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        ruleId,
        organizationId,
        text(body.name, 80) || `${matchType} = ${matchValue}`,
        matchType,
        matchValue,
        queueId,
        bounded(body.priority, 1, 1000, 100),
      )
      .run();
    await recordAudit(auth.session, 'routing_rule.created', 'queue', ruleId, {
      matchType,
      matchValue,
    });
    return NextResponse.json({ ok: true, ruleId });
  }

  // Archived, not deleted: a rule that decided how calls were routed last
  // month is part of why they went where they went.
  if (action === 'archive_rule') {
    return NextResponse.json(
      await archiveOrgConfig({
        organizationId,
        kind: 'routing_rule',
        id: text(body.ruleId, 80),
      }),
    );
  }

  if (action === 'restore_rule') {
    return NextResponse.json(
      await restoreOrgConfig({
        organizationId,
        kind: 'routing_rule',
        id: text(body.ruleId, 80),
      }),
    );
  }

  if (action === 'set_presence') {
    const availability = ['online', 'offline', 'break'].includes(
      text(body.availability, 20),
    )
      ? text(body.availability, 20)
      : '';
    if (!availability)
      return NextResponse.json(
        { error: 'Availability must be online, break or offline.' },
        { status: 400 },
      );
    const agentId = text(body.supportAgentId, 80);
    // A member may only change their own presence; changing someone else's
    // needs workspace authority.
    const target = await db
      .prepare(
        `SELECT id, user_id FROM support_agents WHERE id = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(agentId, organizationId)
      .first<{ id: string; user_id: string | null }>();
    if (!target)
      return NextResponse.json({ error: 'Agent not found.' }, { status: 404 });
    if (target.user_id !== auth.session.userId) {
      const elevated = await requireCustomerPermission(
        request,
        'workspace.manage',
      );
      if (elevated.response)
        return NextResponse.json(
          { error: 'You can only change your own availability.' },
          { status: 403 },
        );
    }
    // §19: when the workspace requires a device test, going Available needs a
    // recent passing one. Without this check the policy would be decorative.
    if (availability === 'online') {
      const policy = await db
        .prepare(`SELECT coalesce(require_device_test, 0) AS required,
            coalesce(device_test_valid_hours, 12) AS hours
          FROM organization_settings WHERE organization_id = ? LIMIT 1`)
        .bind(organizationId)
        .first<{ required: number; hours: number }>();
      if (Number(policy?.required ?? 0) && target.user_id) {
        const hours = Number(policy?.hours ?? 12);
        const recent = await db
          .prepare(`SELECT support_code, readiness, created_at FROM device_test_runs
            WHERE organization_id = ? AND user_id = ? AND readiness != 'blocked'
              AND created_at >= datetime('now', ?)
            ORDER BY created_at DESC LIMIT 1`)
          .bind(organizationId, target.user_id, `-${hours} hours`)
          .first<{ support_code: string }>();
        if (!recent)
          return NextResponse.json(
            {
              error: `This workspace requires a passing device test within the last ${hours} hours before going available. Run one in Device & diagnostics.`,
              requiresDeviceTest: true,
            },
            { status: 409 },
          );
      }
    }
    await db
      .prepare(`UPDATE support_agents SET availability = ?,
        presence_changed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND organization_id = ?`)
      .bind(availability, agentId, organizationId)
      .run();
    return NextResponse.json({ ok: true, availability });
  }

  if (action === 'accept_handoff' || action === 'reject_handoff') {
    const handoffId = text(body.handoffId, 80);
    const agentId = text(body.supportAgentId, 80);
    const handoff = await db
      .prepare(
        `SELECT id, status, queue_id, assigned_agent_id FROM handoffs
         WHERE id = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(handoffId, organizationId)
      .first<{
        id: string;
        status: string;
        queue_id: string | null;
        assigned_agent_id: string | null;
      }>();
    if (!handoff)
      return NextResponse.json(
        { error: 'Handoff not found.' },
        { status: 404 },
      );
    if (action === 'reject_handoff') {
      // Rejecting puts the case back in its queue and frees the agent's slot.
      await db
        .prepare(`UPDATE handoffs SET status = 'queued', queue_status = 'queued',
          assigned_agent_id = NULL, accepted_at = NULL,
          enqueued_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(handoffId)
        .run();
      if (handoff.assigned_agent_id)
        await db
          .prepare(`UPDATE support_agents SET active_calls = max(0, active_calls - 1),
            availability = CASE WHEN availability = 'busy' THEN 'online' ELSE availability END,
            updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(handoff.assigned_agent_id)
          .run();
      return NextResponse.json({ ok: true, status: 'queued' });
    }
    if (handoff.status === 'accepted')
      return NextResponse.json(
        { error: 'This conversation was already accepted.' },
        { status: 409 },
      );
    // Who is taking it. This used to bind `agentId || handoff.assigned_agent_id`
    // and accepting a *queued* case supplied neither — the body carries no
    // `supportAgentId` and a queued row has no assignee — so it bound null and
    // the conversation was accepted by nobody. Every later update that keys off
    // the assignee then did nothing, which is why `active_calls` never came
    // back down and a completed escalation could not say who handled it.
    const takenBy =
      agentId ||
      handoff.assigned_agent_id ||
      (
        await db
          .prepare(
            `SELECT id FROM support_agents WHERE organization_id = ? AND user_id = ? LIMIT 1`,
          )
          .bind(organizationId, auth.session.userId)
          .first<{ id: string }>()
      )?.id ||
      null;
    if (!takenBy)
      return NextResponse.json(
        {
          error:
            'You are not on the agent desk in this workspace, so this conversation cannot be assigned to you.',
        },
        { status: 409 },
      );

    // Claim atomically so two agents cannot accept the same conversation.
    const claimed = await db
      .prepare(`UPDATE handoffs SET status = 'accepted', queue_status = 'accepted',
        assigned_agent_id = ?, accepted_at = CURRENT_TIMESTAMP
        WHERE id = ? AND organization_id = ? AND status IN ('queued','assigned')`)
      .bind(takenBy, handoffId, organizationId)
      .run();
    if (!claimed.meta.changes)
      return NextResponse.json(
        { error: 'Another agent already took this conversation.' },
        { status: 409 },
      );
    // Guarded on `agentId` before, which is only set when the body names one —
    // so accepting from the desk incremented nothing while wrap-up
    // decremented, and the counter routing uses to decide who is free drifted
    // out of step with reality. It moves for whoever actually took the call.
    await db
      .prepare(`UPDATE support_agents SET active_calls = active_calls + 1,
        last_assigned_at = CURRENT_TIMESTAMP,
        availability = CASE
          WHEN active_calls + 1 >= coalesce(max_concurrent_calls, 1) THEN 'busy'
          ELSE availability END,
        updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`)
      .bind(takenBy, organizationId)
      .run();
    return NextResponse.json({ ok: true, status: 'accepted' });
  }

  if (action === 'wrap_up') {
    const handoffId = text(body.handoffId, 80);
    const disposition = DISPOSITIONS.includes(text(body.disposition, 40))
      ? text(body.disposition, 40)
      : '';
    if (!disposition)
      return NextResponse.json(
        { error: 'Choose a disposition.' },
        { status: 400 },
      );
    const handoff = await db
      .prepare(
        `SELECT id, assigned_agent_id FROM handoffs WHERE id = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(handoffId, organizationId)
      .first<{ id: string; assigned_agent_id: string | null }>();
    if (!handoff)
      return NextResponse.json(
        { error: 'Handoff not found.' },
        { status: 404 },
      );
    await db
      .prepare(`UPDATE handoffs SET status = 'completed', queue_status = 'completed',
        disposition = ?, disposition_notes = ? WHERE id = ?`)
      .bind(disposition, text(body.notes, 600) || null, handoffId)
      .run();
    if (handoff.assigned_agent_id)
      await db
        .prepare(`UPDATE support_agents SET active_calls = max(0, active_calls - 1),
          availability = CASE WHEN availability = 'busy' THEN 'online' ELSE availability END,
          updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(handoff.assigned_agent_id)
        .run();
    await recordAudit(auth.session, 'handoff.wrapped', 'handoff', handoffId, {
      disposition,
    });
    return NextResponse.json({ ok: true, disposition });
  }

  if (action === 'copilot') {
    // Live assist for the human who took the conversation.
    const handoffId = text(body.handoffId, 80);
    const result = await copilotForHandoff({ organizationId, handoffId });
    return NextResponse.json(result);
  }

  if (action === 'request_takeover') {
    // The live-monitor "Take over" button had no handler. Audio monitoring
    // needs a media gateway, but escalating the call to a human is real work
    // this runtime can do: it creates a routed handoff with the AI summary.
    const callId = text(body.callId, 120);
    const call = await db
      .prepare(`SELECT c.id, c.agent_id, c.summary, c.customer_name,
          t.language AS transcript_language
        FROM call_records c LEFT JOIN transcripts t ON t.call_id = c.id
        WHERE c.id = ? AND c.organization_id = ? LIMIT 1`)
      .bind(callId, organizationId)
      .first<{
        id: string;
        agent_id: string | null;
        summary: string | null;
        customer_name: string | null;
        transcript_language: string | null;
      }>();
    if (!call)
      return NextResponse.json({ error: 'Call not found.' }, { status: 404 });
    const existing = await db
      .prepare(`SELECT id, status FROM handoffs
        WHERE organization_id = ? AND call_id = ? AND status IN ('queued','assigned','accepted')
        LIMIT 1`)
      .bind(organizationId, callId)
      .first<{ id: string; status: string }>();
    if (existing)
      return NextResponse.json({
        ok: true,
        alreadyRequested: true,
        handoffId: existing.id,
        status: existing.status,
        message: 'This call is already waiting for a human.',
      });
    const transfer = await initiateWarmTransfer({
      organizationId,
      agentId: call.agent_id,
      callId: call.id,
      reason: 'Supervisor requested takeover from live monitoring',
      summary:
        call.summary ||
        `Live call with ${call.customer_name || 'an unidentified caller'}; no AI summary yet.`,
      language: call.transcript_language,
      skill: text(body.skill, 60) || null,
    });
    await recordAudit(
      auth.session,
      'call.takeover_requested',
      'call_record',
      callId,
      { transferred: transfer.transferred, queue: transfer.queue ?? null },
    );
    return NextResponse.json(transfer);
  }

  if (action === 'test_route') {
    // Dry run: shows which agent would be picked and why, without creating a
    // handoff or touching anyone's capacity.
    const { outcome, overflowedFrom } = await resolveRouting({
      organizationId,
      queueId: text(body.queueId, 80) || null,
      skill: text(body.skill, 60) || null,
      language: text(body.language, 20) || null,
      reason: text(body.reason, 80) || null,
    });
    return NextResponse.json({
      ok: true,
      queue: outcome.queue?.slug ?? null,
      strategy: outcome.queue?.strategy ?? 'skill_first',
      reason: outcome.reason,
      matchTier: outcome.matchTier ?? null,
      considered: outcome.considered,
      overflowedFrom,
      agent: outcome.agent
        ? {
            id: outcome.agent.id,
            name: outcome.agent.name,
            role: outcome.agent.role,
            activeCalls: outcome.agent.activeCalls,
          }
        : null,
    });
  }

  return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
}
