/** Session tariff, deliberately NOT a per-minute voice rate. */
// Relative, with the extension: this module is loaded directly by
// `scripts/test-release-safety.mjs`, where `@/lib/...` does not resolve.
import { MAX_CONCURRENT_CALLS } from './call-limits.ts';

export const REALTIME_CREDITS = 10;
export const REALTIME_UNIT = 'realtime_session_v1';

export type Reservation = {
  id: string;
  request_hash: string;
  status: string;
  credits: number;
};
export async function realtimeDigest(value: string) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

// D1 batch is transactional. An unconditional unique INSERT is the owner gate:
// a duplicate must roll back, never reuse an earlier reservation's debit predicate.
export const RESERVE_SQL = [
  // Two conditions decide the status, in one statement, because deciding them
  // in JavaScript and inserting afterwards is the count-then-act race this
  // table exists to close: money, and how many calls this workspace already
  // has open. Outstanding reservations *are* the open calls, so the cap reads
  // the same row it is about to add to.
  `INSERT INTO realtime_reservations (id, organization_id, agent_id, request_hash, unit, credits, status)
   VALUES (?, ?, ?, ?, ?, ?,
     CASE
       WHEN coalesce((SELECT balance FROM organization_wallets WHERE organization_id = ?), 0) < ?
         THEN 'insufficient'
       WHEN (SELECT count(*) FROM realtime_reservations WHERE organization_id = ? AND status = 'reserved') >= ?
         THEN 'at_capacity'
       ELSE 'reserved'
     END)`,
  `UPDATE organization_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP
   WHERE organization_id = ? AND EXISTS (SELECT 1 FROM realtime_reservations WHERE id = ? AND status = 'reserved')`,
  `INSERT INTO credit_ledger (id, organization_id, type, amount, balance_after, reference_type, reference_id, description)
   SELECT ?, organization_id, 'trial_usage', ?, balance, 'agent_test', ?, 'Realtime session v1 reservation (10 credits/session)'
   FROM organization_wallets WHERE organization_id = ? AND EXISTS (SELECT 1 FROM realtime_reservations WHERE id = ? AND status = 'reserved')`,
  `INSERT INTO agent_test_sessions (id, organization_id, agent_id, mode, status, credits_used)
   SELECT id, organization_id, agent_id, 'realtime', 'connecting', credits FROM realtime_reservations WHERE id = ? AND status = 'reserved'`,
];

export async function reserveRealtime(
  db: D1Database,
  input: {
    id: string;
    organizationId: string;
    agentId: string;
    requestHash: string;
  },
) {
  const { id, organizationId: org, agentId, requestHash } = input;
  let replay = false;
  try {
    await db.batch([
      db
        .prepare(RESERVE_SQL[0])
        .bind(
          id,
          org,
          agentId,
          requestHash,
          REALTIME_UNIT,
          REALTIME_CREDITS,
          org,
          REALTIME_CREDITS,
          org,
          MAX_CONCURRENT_CALLS,
        ),
      db.prepare(RESERVE_SQL[1]).bind(REALTIME_CREDITS, org, id),
      db
        .prepare(RESERVE_SQL[2])
        .bind(`debit_${id}`, -REALTIME_CREDITS, id, org, id),
      db.prepare(RESERVE_SQL[3]).bind(id),
    ]);
  } catch (error) {
    const existing = await db
      .prepare(
        'SELECT id, request_hash, status, credits FROM realtime_reservations WHERE id = ? AND organization_id = ?',
      )
      .bind(id, org)
      .first<Reservation>();
    if (!existing) throw error;
    replay = true;
  }
  const row = await db
    .prepare(
      'SELECT id, request_hash, status, credits FROM realtime_reservations WHERE id = ? AND organization_id = ?',
    )
    .bind(id, org)
    .first<Reservation>();
  if (!row) throw new Error('Reservation could not be confirmed.');
  return { ...row, replay, mismatch: row.request_hash !== requestHash };
}

export const REFUND_SQL = [
  `INSERT INTO credit_ledger (id, organization_id, type, amount, balance_after, reference_type, reference_id, description)
   SELECT ?, r.organization_id, 'refund', r.credits, w.balance + r.credits, 'agent_test', r.id, 'Realtime rejected before acceptance; reservation released'
   FROM realtime_reservations r JOIN organization_wallets w ON w.organization_id = r.organization_id WHERE r.id = ? AND r.status = 'reserved'`,
  `UPDATE organization_wallets SET balance = balance + (SELECT credits FROM realtime_reservations WHERE id = ?), updated_at = CURRENT_TIMESTAMP
   WHERE organization_id = (SELECT organization_id FROM realtime_reservations WHERE id = ? AND status = 'reserved')`,
  `UPDATE agent_test_sessions SET status = 'failed', credits_used = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND EXISTS (SELECT 1 FROM realtime_reservations WHERE id = ? AND status = 'reserved')`,
  `UPDATE realtime_reservations SET status = 'refunded', error_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'reserved'`,
];
export async function refundRealtime(db: D1Database, id: string, code: string) {
  await db.batch([
    db.prepare(REFUND_SQL[0]).bind(`refund_${id}`, id),
    db.prepare(REFUND_SQL[1]).bind(id, id),
    db.prepare(REFUND_SQL[2]).bind(id, id),
    db.prepare(REFUND_SQL[3]).bind(code, id),
  ]);
}

/* ------------------------------------------------------------------ *
 * Reconciliation
 *
 * A realtime negotiation that times out, 5xxs, or fails writing after the
 * provider accepted does not prove non-acceptance. Refunding on that would
 * hand back credits for a session that ran; charging silently would take
 * credits for one that never started. So the reservation is parked at
 * `reconciliation_required` and its credits stay held.
 *
 * Parked is where they stayed. Nothing listed them, nothing resolved them, and
 * the workspace simply had ten fewer credits with no line anywhere saying why.
 * These two functions are the resolution, and they are deliberately for an
 * operator rather than automatic: the only evidence of whether that session ran
 * is the provider's own record, which this server cannot read.
 * ------------------------------------------------------------------ */

export const RECONCILE_REFUND_SQL = [
  `INSERT INTO credit_ledger (id, organization_id, type, amount, balance_after, reference_type, reference_id, description)
   SELECT ?, r.organization_id, 'refund', r.credits, w.balance + r.credits, 'agent_test', r.id, 'Realtime session reconciled as never started; reservation released'
   FROM realtime_reservations r JOIN organization_wallets w ON w.organization_id = r.organization_id
   WHERE r.id = ? AND r.status = 'reconciliation_required'`,
  `UPDATE organization_wallets SET balance = balance + (SELECT credits FROM realtime_reservations WHERE id = ?), updated_at = CURRENT_TIMESTAMP
   WHERE organization_id = (SELECT organization_id FROM realtime_reservations WHERE id = ? AND status = 'reconciliation_required')`,
  `UPDATE realtime_reservations SET status = 'refunded', error_code = ?, updated_at = CURRENT_TIMESTAMP
   WHERE id = ? AND status = 'reconciliation_required'`,
];

/** The session never ran: the customer gets the credits back. */
export async function reconcileAsNotStarted(
  db: D1Database,
  id: string,
  note: string,
) {
  const before = await db
    .prepare(
      'SELECT status FROM realtime_reservations WHERE id = ? AND status = ?',
    )
    .bind(id, 'reconciliation_required')
    .first<{ status: string }>();
  if (!before)
    return { resolved: false, reason: 'Not awaiting reconciliation.' };
  await db.batch([
    db.prepare(RECONCILE_REFUND_SQL[0]).bind(`reconciled_${id}`, id),
    db.prepare(RECONCILE_REFUND_SQL[1]).bind(id, id),
    db.prepare(RECONCILE_REFUND_SQL[2]).bind(note.slice(0, 200), id),
  ]);
  return { resolved: true, outcome: 'refunded' as const };
}

/**
 * The session did run: the reservation becomes the charge.
 *
 * No further debit — the credits left the wallet when the reservation was
 * taken. This only stops the row being outstanding, so it releases its
 * concurrency slot and disappears from the queue an operator is working
 * through.
 */
export async function reconcileAsStarted(
  db: D1Database,
  id: string,
  note: string,
) {
  // Read the state first, exactly as the refund path does. Deciding from the
  // row *after* the update cannot tell "I just settled this" from "somebody
  // settled it an hour ago", so a second operator working the same queue was
  // told their click had done something.
  const before = await db
    .prepare(
      'SELECT status FROM realtime_reservations WHERE id = ? AND status = ?',
    )
    .bind(id, 'reconciliation_required')
    .first<{ status: string }>();
  if (!before)
    return { resolved: false, reason: 'Not awaiting reconciliation.' };
  await db
    .prepare(
      `UPDATE realtime_reservations SET status = 'settled', error_code = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'reconciliation_required'`,
    )
    .bind(note.slice(0, 200), id)
    .run();
  return { resolved: true, outcome: 'settled' as const };
}

/** What is still held and unresolved, oldest first — the operator's queue. */
export async function pendingReconciliations(
  db: D1Database,
  organizationId?: string,
) {
  const rows = organizationId
    ? await db
        .prepare(
          `SELECT id, organization_id, agent_id, credits, error_code, provider_reference, created_at
           FROM realtime_reservations
           WHERE status = 'reconciliation_required' AND organization_id = ?
           ORDER BY created_at LIMIT 100`,
        )
        .bind(organizationId)
        .all()
    : await db
        .prepare(
          `SELECT id, organization_id, agent_id, credits, error_code, provider_reference, created_at
           FROM realtime_reservations
           WHERE status = 'reconciliation_required'
           ORDER BY created_at LIMIT 100`,
        )
        .all();
  return rows.results ?? [];
}

/* ------------------------------------------------------------------ *
 * Duration
 *
 * A realtime session is negotiated straight between the browser and the
 * provider, so no server sees it end. It cost ten credits however long it ran,
 * and the sweep that releases an abandoned reservation deliberately charges
 * nothing more, because a duration nobody measured must not be billed.
 *
 * This measures it. The session beats every half minute while it is open; a
 * beat is a fact about a moment the session was alive, which is the most this
 * server can honestly know. When the tab closes the beats stop, and the last
 * one is the end — accurate to within one interval, and never longer than the
 * session actually was.
 * ------------------------------------------------------------------ */

/** How often an open session should report itself, in seconds. */
export const HEARTBEAT_SECONDS = 30;

/**
 * Silence after which a session is taken to have ended.
 *
 * Three missed beats rather than one: a browser throttles timers in a
 * background tab, and ending a live call because a laptop slept for a minute
 * would bill a conversation as shorter than it was.
 */
export const HEARTBEAT_GRACE_SECONDS = HEARTBEAT_SECONDS * 3;

/** Records that a session was alive now. Only ever moves a live reservation. */
export async function heartbeatRealtime(
  db: D1Database,
  id: string,
  organizationId: string,
) {
  const result = await db
    .prepare(
      `UPDATE realtime_reservations
       SET last_heartbeat_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND organization_id = ? AND status = 'reserved'`,
    )
    .bind(id, organizationId)
    .run();
  return Number(result.meta?.changes ?? 0) > 0;
}

/**
 * Seconds a session was alive, from its own beats.
 *
 * Deliberately the *last beat*, not now: the gap between the final beat and
 * whenever this is asked is time nobody can show the session existed for.
 * Rounding it into the bill would be charging for silence.
 */
export function measuredSeconds(
  createdAt: string,
  lastBeatAt: string | null,
): number {
  const start = parseUtc(createdAt);
  const end = parseUtc(lastBeatAt ?? createdAt);
  if (!start || !end || end < start) return 0;
  return Math.round((end - start) / 1000);
}

function parseUtc(value: string | null): number | null {
  if (!value) return null;
  const normalised = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const parsed = Date.parse(normalised);
  return Number.isNaN(parsed) ? null : parsed;
}
