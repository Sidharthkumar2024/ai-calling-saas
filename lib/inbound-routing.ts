import { getRawDb } from '@/db/index';
import { agentOnShift, type Shift } from '@/lib/shifts';
import { routeToAgent } from '@/lib/handoff-service';

/**
 * Inbound call resolution (blueprint §6).
 *
 * `number_routes` was configurable but had no consumer: the only telephony
 * webhook updated existing outbound calls, so nothing ever decided where an
 * inbound call should go. This resolves a dialled number to a route, honours
 * the route's off-hours action, and reports the decision.
 *
 * It stops at the decision. Bridging media is a separate service — this runtime
 * has no WebSocket binding — so nothing here claims a call was connected.
 */

export type InboundDecision = {
  matched: boolean;
  organizationId?: string;
  numberId?: string;
  routeId?: string;
  routeType?: string;
  target:
    | { kind: 'voice_agent'; id: string; name: string }
    | { kind: 'queue'; id: string; slug: string; agentAvailable: boolean }
    | { kind: 'campaign'; id: string; name: string }
    | null;
  offHours: boolean;
  action:
    | 'connect_agent'
    | 'enqueue'
    | 'voicemail'
    | 'callback'
    | 'reject'
    | 'no_route'
    | 'unknown_number';
  reason: string;
};

function parseDays(raw: string) {
  try {
    const parsed = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => Number(item)) : [];
  } catch {
    return [];
  }
}

/** Whether any agent in the workspace is on shift right now. */
async function anyoneOnShift(organizationId: string, at: Date) {
  const db = getRawDb();
  const rows = await db
    .prepare(`SELECT s.support_agent_id, s.days_json, s.start_minute, s.end_minute,
        s.break_start_minute, s.break_end_minute, s.timezone, s.status
      FROM shifts s WHERE s.organization_id = ?`)
    .bind(organizationId)
    .all<{
      support_agent_id: string;
      days_json: string;
      start_minute: number;
      end_minute: number;
      break_start_minute: number | null;
      break_end_minute: number | null;
      timezone: string;
      status: string;
    }>();
  const shifts = rows.results ?? [];
  // No shifts configured means hours are not enforced, matching routing.
  if (!shifts.length) return true;
  const byAgent = new Map<string, Shift[]>();
  for (const row of shifts) {
    const list = byAgent.get(row.support_agent_id) ?? [];
    list.push({
      days: parseDays(row.days_json),
      startMinute: Number(row.start_minute),
      endMinute: Number(row.end_minute),
      breakStartMinute: row.break_start_minute,
      breakEndMinute: row.break_end_minute,
      timezone: row.timezone,
      status: row.status,
    });
    byAgent.set(row.support_agent_id, list);
  }
  for (const list of byAgent.values()) {
    if (agentOnShift(list, at).onShift) return true;
  }
  return false;
}

export async function resolveInboundCall(input: {
  toNumber: string;
  fromNumber: string;
  at?: Date;
}): Promise<InboundDecision> {
  const db = getRawDb();
  const at = input.at ?? new Date();
  // Match on the dialled number, tolerating a missing or extra country prefix.
  const digits = input.toNumber.replace(/\D/g, '');
  const number = await db
    .prepare(`SELECT id, organization_id, phone_number, status
      FROM phone_numbers
      WHERE replace(replace(replace(phone_number, '+', ''), ' ', ''), '-', '') IN (?, ?)
      LIMIT 1`)
    .bind(digits, digits.slice(-10))
    .first<{
      id: string;
      organization_id: string;
      phone_number: string;
      status: string;
    }>();
  if (!number)
    return {
      matched: false,
      target: null,
      offHours: false,
      action: 'unknown_number',
      reason: `No workspace owns ${input.toNumber}.`,
    };

  const route = await db
    .prepare(`SELECT r.id, r.route_type, r.agent_id, r.queue_id, r.campaign_id,
        r.language, r.off_hours_action, va.name AS agent_name,
        q.slug AS queue_slug, c.name AS campaign_name
      FROM number_routes r
      LEFT JOIN voice_agents va ON va.id = r.agent_id
      LEFT JOIN queues q ON q.id = r.queue_id
      LEFT JOIN campaigns c ON c.id = r.campaign_id
      WHERE r.number_id = ? AND r.organization_id = ? AND r.status = 'active'
      ORDER BY r.priority LIMIT 1`)
    .bind(number.id, number.organization_id)
    .first<{
      id: string;
      route_type: string;
      agent_id: string | null;
      queue_id: string | null;
      campaign_id: string | null;
      language: string | null;
      off_hours_action: string;
      agent_name: string | null;
      queue_slug: string | null;
      campaign_name: string | null;
    }>();
  if (!route)
    return {
      matched: true,
      organizationId: number.organization_id,
      numberId: number.id,
      target: null,
      offHours: false,
      action: 'no_route',
      reason: `${number.phone_number} has no active route, so there is nothing to connect the caller to.`,
    };

  const offHours = !(await anyoneOnShift(number.organization_id, at));

  if (route.queue_id) {
    const outcome = await routeToAgent({
      organizationId: number.organization_id,
      queueId: route.queue_id,
      language: route.language,
    });
    const available = Boolean(outcome.agent);
    // A human queue outside hours with nobody on shift follows the route's
    // configured fallback rather than ringing into an empty room.
    const action = available
      ? 'enqueue'
      : offHours
        ? ['voicemail', 'callback', 'reject'].includes(route.off_hours_action)
          ? (route.off_hours_action as 'voicemail' | 'callback' | 'reject')
          : 'voicemail'
        : 'enqueue';
    return {
      matched: true,
      organizationId: number.organization_id,
      numberId: number.id,
      routeId: route.id,
      routeType: route.route_type,
      target: {
        kind: 'queue',
        id: route.queue_id,
        slug: route.queue_slug ?? 'queue',
        agentAvailable: available,
      },
      offHours,
      action,
      reason: available
        ? `Queue ${route.queue_slug} has ${outcome.agent?.name} available.`
        : `Queue ${route.queue_slug} has nobody available (${outcome.reason}).`,
    };
  }

  if (route.agent_id)
    return {
      matched: true,
      organizationId: number.organization_id,
      numberId: number.id,
      routeId: route.id,
      routeType: route.route_type,
      target: {
        kind: 'voice_agent',
        id: route.agent_id,
        name: route.agent_name ?? 'AI agent',
      },
      offHours,
      // The AI answers regardless of staff hours; that is the point of it.
      action: 'connect_agent',
      reason: `${route.agent_name} answers ${route.route_type} calls on this number.`,
    };

  if (route.campaign_id)
    return {
      matched: true,
      organizationId: number.organization_id,
      numberId: number.id,
      routeId: route.id,
      routeType: route.route_type,
      target: {
        kind: 'campaign',
        id: route.campaign_id,
        name: route.campaign_name ?? 'campaign',
      },
      offHours,
      action: 'connect_agent',
      reason: `Number is bound to campaign ${route.campaign_name}.`,
    };

  return {
    matched: true,
    organizationId: number.organization_id,
    numberId: number.id,
    routeId: route.id,
    routeType: route.route_type,
    target: null,
    offHours,
    action: 'no_route',
    reason: 'The route points at nothing.',
  };
}
