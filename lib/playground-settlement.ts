/**
 * Charging one playground turn, once, and never charging a turn twice.
 *
 * What was here: the provider was called, then the wallet was debited with
 * `balance >= cost` written into the `UPDATE` as a guard, and a `credit_ledger`
 * row was inserted beside it in the same batch. Two things follow from that,
 * and both are real money:
 *
 *  - When the guard fails — a concurrent turn drained the wallet between the
 *    read and the write — the `UPDATE` matches no rows and the `INSERT` still
 *    runs. The ledger then records a 10-credit spend that the wallet never
 *    made, and the turn is delivered free. Nothing reports the disagreement.
 *  - `balance_after` was computed in JavaScript from a balance read before the
 *    provider call. Two turns in flight write the same `balance_after`, so the
 *    ledger's running balance stops being a running balance.
 *
 * Both are fixed the way `settleExotel` already fixes them: one ledger id per
 * turn as the transactional gate, `balance_after` derived from the wallet row
 * inside the statement, and the ledger insert predicated on the same condition
 * as the debit — so either both happen or neither does.
 */

export const PLAYGROUND_SETTLEMENT_SQL = [
  // Both statements carry the same `balance >= ?` predicate. A wallet that
  // cannot pay produces no ledger row *and* no debit, rather than one of the
  // two.
  `INSERT INTO credit_ledger
     (id, organization_id, type, amount, balance_after, reference_type, reference_id, description)
   SELECT ?, organization_id, 'trial_usage', ?, balance - ?, 'agent_test', ?, 'No-call agent playground turn'
   FROM organization_wallets WHERE organization_id = ? AND balance >= ?`,
  `UPDATE organization_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP
   WHERE organization_id = ? AND balance >= ?`,
  // Predicated on the ledger row this batch just wrote, not on nothing. Left
  // unconditional it advanced on turns the wallet had refused to pay for, so
  // the session's "credits used" drifted above what was actually charged —
  // the same defect as the one above, one statement over.
  `UPDATE agent_test_sessions SET credits_used = credits_used + ?, updated_at = CURRENT_TIMESTAMP
   WHERE id = ? AND EXISTS (SELECT 1 FROM credit_ledger WHERE id = ?)`,
];

export type PlaygroundSettlement = {
  charged: boolean;
  /** Set when the turn was already paid for, so a retry is not a second charge. */
  alreadySettled: boolean;
  reason?: string;
};

/**
 * Settles one turn.
 *
 * `turnId` is the caller's own idempotency key — the assistant message id — so
 * a retried request settles once. The ledger id is derived from it rather than
 * generated, which is what makes the retry visible to the database instead of
 * to a variable in a request that has already ended.
 */
export async function settlePlaygroundTurn(
  db: D1Database,
  input: {
    organizationId: string;
    sessionId: string;
    turnId: string;
    credits: number;
  },
): Promise<PlaygroundSettlement> {
  const { organizationId, sessionId, turnId, credits } = input;
  if (!Number.isSafeInteger(credits) || credits <= 0)
    throw new Error('Invalid turn charge.');

  const ledgerId = `playground_turn_${turnId}`;
  const existing = await db
    .prepare('SELECT id FROM credit_ledger WHERE id = ?')
    .bind(ledgerId)
    .first<{ id: string }>();
  if (existing) return { charged: false, alreadySettled: true };

  await db.batch([
    db
      .prepare(PLAYGROUND_SETTLEMENT_SQL[0])
      .bind(ledgerId, -credits, credits, sessionId, organizationId, credits),
    db
      .prepare(PLAYGROUND_SETTLEMENT_SQL[1])
      .bind(credits, organizationId, credits),
    db.prepare(PLAYGROUND_SETTLEMENT_SQL[2]).bind(credits, sessionId, ledgerId),
  ]);

  // Whether the wallet could pay is read back from the ledger rather than
  // taken from the batch's return value. D1 reports `meta.changes` and
  // node:sqlite reports `changes`, and a settlement that believed it had
  // failed because it was handed the wrong envelope would refund a turn the
  // customer was correctly charged for. The row is the fact.
  const written = await db
    .prepare('SELECT id FROM credit_ledger WHERE id = ?')
    .bind(ledgerId)
    .first<{ id: string }>();
  const charged = Boolean(written);
  if (!charged)
    return {
      charged: false,
      alreadySettled: false,
      reason: 'Not enough credits for this turn.',
    };
  return { charged: true, alreadySettled: false };
}
