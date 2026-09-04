import { getRawDb } from '@/db/index';
import {
  NOTIFICATION_SPECS,
  dedupeKey,
  inboxSummary,
  isNotificationEvent,
  requiresAcknowledgement,
  type InboxRow,
  type NotificationEvent,
} from '@/lib/notifications';

/**
 * The notification centre (§3.2).
 *
 * Stored server-side, not per browser. §3.2 requires read state "consistent
 * across tabs/devices", and localStorage is by definition neither: a person who
 * reads a notification on their laptop would find it unread on their phone.
 *
 * The dedupe key is what makes this also the fix for duplicate toasts. Two tabs
 * observing the same event both report it; the unique index rejects the second,
 * `created` comes back false, and only the tab that actually wrote the row
 * shows a toast. That is §3.2's "single event ID", enforced by the database
 * rather than by hoping the tabs coordinate.
 */

export type RecordInput = {
  organizationId: string;
  event: NotificationEvent;
  title?: string;
  detail?: string | null;
  /** The thing this is about — a call id, invoice number, handoff id. */
  subject?: string | null;
  /** Null or absent means the whole workspace sees it. */
  userId?: string | null;
};

export async function recordNotification(
  input: RecordInput,
): Promise<{ created: boolean; id: string }> {
  if (!isNotificationEvent(input.event)) return { created: false, id: '' };
  const spec = NOTIFICATION_SPECS[input.event];
  const key = dedupeKey({ event: input.event, subject: input.subject });
  const id = `notif_${crypto.randomUUID()}`;
  const db = getRawDb();

  // One statement decides it. Checking first and inserting after would let two
  // tabs both pass the check, which is the race this is meant to close.
  const row = await db
    .prepare(
      `INSERT INTO notifications
         (id, organization_id, user_id, event, title, detail, severity,
          requires_ack, dedupe_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(organization_id, dedupe_key) DO NOTHING
       RETURNING id`,
    )
    .bind(
      id,
      input.organizationId,
      input.userId ?? null,
      input.event,
      (input.title || spec.title).slice(0, 200),
      input.detail ? String(input.detail).slice(0, 500) : null,
      spec.severity,
      requiresAcknowledgement(input.event) ? 1 : 0,
      key,
    )
    .first<{ id: string }>();

  // No row returned means the conflict clause swallowed it: somebody else
  // already reported this event, so this caller must not toast.
  return row?.id ? { created: true, id: row.id } : { created: false, id: '' };
}

export async function listNotifications(input: {
  organizationId: string;
  userId: string;
  limit?: number;
}) {
  const rows = await getRawDb()
    .prepare(
      `SELECT id, event, title, detail, severity,
              requires_ack AS requiresAck,
              read_at AS readAt, acknowledged_at AS acknowledgedAt,
              created_at AS createdAt
       FROM notifications
       WHERE organization_id = ?
         AND (user_id IS NULL OR user_id = ?)
       ORDER BY
         -- Anything still waiting on a person comes first, however old.
         (requires_ack = 1 AND acknowledged_at IS NULL) DESC,
         created_at DESC
       LIMIT ?`,
    )
    .bind(
      input.organizationId,
      input.userId,
      Math.max(1, Math.min(100, input.limit ?? 40)),
    )
    .all<{
      id: string;
      event: string;
      title: string;
      detail: string | null;
      severity: string;
      requiresAck: number;
      readAt: string | null;
      acknowledgedAt: string | null;
      createdAt: string;
    }>();

  const list: InboxRow[] = (rows.results ?? []).map((row) => ({
    id: row.id,
    event: row.event,
    title: row.title,
    detail: row.detail,
    severity: row.severity,
    requiresAck: Number(row.requiresAck) === 1,
    readAt: row.readAt,
    acknowledgedAt: row.acknowledgedAt,
    createdAt: row.createdAt,
  }));
  return { notifications: list, summary: inboxSummary(list) };
}

export async function markRead(input: {
  organizationId: string;
  userId: string;
  /** Omit to mark everything this person can see. */
  notificationId?: string | null;
}) {
  const db = getRawDb();
  if (input.notificationId) {
    await db
      .prepare(
        `UPDATE notifications SET read_at = CURRENT_TIMESTAMP
         WHERE id = ? AND organization_id = ?
           AND (user_id IS NULL OR user_id = ?) AND read_at IS NULL`,
      )
      .bind(input.notificationId, input.organizationId, input.userId)
      .run();
    return { ok: true };
  }
  await db
    .prepare(
      `UPDATE notifications SET read_at = CURRENT_TIMESTAMP
       WHERE organization_id = ? AND (user_id IS NULL OR user_id = ?)
         AND read_at IS NULL`,
    )
    .bind(input.organizationId, input.userId)
    .run();
  return { ok: true };
}

/**
 * Acknowledges an event that was waiting for a person.
 *
 * Records who, because the point of making a failed payment or a failed
 * transfer stay on screen is that somebody takes responsibility for having seen
 * it. Acknowledging also marks it read — nobody acknowledges something unread.
 */
export async function acknowledgeNotification(input: {
  organizationId: string;
  userId: string;
  notificationId: string;
}) {
  await getRawDb()
    .prepare(
      `UPDATE notifications
       SET acknowledged_at = CURRENT_TIMESTAMP,
           acknowledged_by = ?,
           read_at = coalesce(read_at, CURRENT_TIMESTAMP)
       WHERE id = ? AND organization_id = ?
         AND (user_id IS NULL OR user_id = ?)
         AND acknowledged_at IS NULL`,
    )
    .bind(
      input.userId,
      input.notificationId,
      input.organizationId,
      input.userId,
    )
    .run();
  return { ok: true };
}
