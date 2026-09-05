/**
 * Working the callback queue.
 *
 * Rows arrive from `create_callback` on a live call and from the follow-up
 * job. Until now that was the end of it: they were listed and never moved.
 *
 * Two things happen here that did not before. Somebody is told a callback
 * exists, because a promise sitting on a screen nobody has open is the same as
 * no promise. And a callback can be claimed, attempted and resolved — with a
 * "no answer" that returns it to the queue rather than closing it, since
 * dialling is not reaching.
 */

import { getRawDb } from '@/db/index';
import {
  canMoveCallback,
  isCallbackStatus,
  lateness,
  queueOrder,
  queueSummary,
  type CallbackStatus,
} from '@/lib/callbacks';

export async function listCallbacks(organizationId: string) {
  const rows = await getRawDb()
    .prepare(`SELECT c.id, c.customer_name, c.customer_phone, c.reason,
        c.requested_window, c.status, c.attempts, c.claimed_by, c.resolved_by,
        c.outcome_note, c.created_at, c.resolved_at
      FROM callback_requests c WHERE c.organization_id = ?
      ORDER BY c.created_at DESC LIMIT 200`)
    .bind(organizationId)
    .all<{
      id: string;
      status: string;
      created_at: string;
      requested_window: string | null;
      [key: string]: unknown;
    }>();

  const mapped = (rows.results ?? []).map((row) => ({
    ...row,
    status: isCallbackStatus(row.status) ? row.status : 'pending',
    createdAt: row.created_at,
    requestedWindow: row.requested_window,
  }));

  const ordered = queueOrder(mapped as never);
  return {
    // Late first, oldest first — the person owed most is at the top rather
    // than the one who called a minute ago.
    callbacks: ordered.map((row) => ({
      ...row,
      lateness: lateness({
        status: row.status,
        createdAt: row.createdAt,
        requestedWindow: row.requestedWindow,
      }),
    })),
    summary: queueSummary(mapped as never),
  };
}

export type CallbackMove = { ok: boolean; reason?: string };

export async function moveCallback(input: {
  organizationId: string;
  callbackId: string;
  status: CallbackStatus;
  note?: string;
  userId: string;
}): Promise<CallbackMove> {
  const db = getRawDb();
  const row = await db
    .prepare(
      `SELECT status FROM callback_requests WHERE id = ? AND organization_id = ? LIMIT 1`,
    )
    .bind(input.callbackId, input.organizationId)
    .first<{ status: string }>();
  if (!row) return { ok: false, reason: 'That callback is not in this queue.' };
  const from = isCallbackStatus(row.status) ? row.status : 'pending';
  // The transition rules live in the pure module, so "you cannot mark it
  // reached without calling it" holds here and not only on the screen.
  if (!canMoveCallback(from, input.status))
    return {
      ok: false,
      reason: `A callback that is ${from.replace('_', ' ')} cannot be moved to ${input.status.replace('_', ' ')}.`,
    };

  const closing = input.status === 'completed' || input.status === 'cancelled';
  await db
    .prepare(`UPDATE callback_requests SET status = ?,
      attempts = attempts + CASE WHEN ? = 'in_progress' THEN 1 ELSE 0 END,
      claimed_by = CASE WHEN ? = 'in_progress' THEN ? ELSE claimed_by END,
      claimed_at = CASE WHEN ? = 'in_progress' THEN CURRENT_TIMESTAMP ELSE claimed_at END,
      resolved_by = CASE WHEN ? THEN ? ELSE resolved_by END,
      resolved_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE resolved_at END,
      outcome_note = coalesce(?, outcome_note)
      WHERE id = ? AND organization_id = ?`)
    .bind(
      input.status,
      input.status,
      input.status,
      input.userId,
      input.status,
      closing ? 1 : 0,
      input.userId,
      closing ? 1 : 0,
      input.note?.slice(0, 300) || null,
      input.callbackId,
      input.organizationId,
    )
    .run();
  return { ok: true };
}
