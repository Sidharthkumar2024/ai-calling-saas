/** Session tariff, deliberately NOT a per-minute voice rate. */
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
  `INSERT INTO realtime_reservations (id, organization_id, agent_id, request_hash, unit, credits, status)
   VALUES (?, ?, ?, ?, ?, ?, CASE WHEN coalesce((SELECT balance FROM organization_wallets WHERE organization_id = ?), 0) >= ? THEN 'reserved' ELSE 'insufficient' END)`,
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
