/** Exotel completed calls: started-minute pulses; independent of browser sessions. */
export function exotelCredits(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new Error('Invalid duration');
  return Math.max(10, Math.ceil(Math.max(1, seconds) / 60) * 10);
}
export const EXOTEL_SETTLEMENT_SQL = [
  `INSERT INTO credit_ledger (id, organization_id, type, amount, balance_after, reference_type, reference_id, description)
   SELECT ?, organization_id, 'usage', ?, balance - ?, 'call', ?, 'Exotel completed-call usage: 10 credits/started minute'
   FROM organization_wallets WHERE organization_id = ?`,
  `UPDATE organization_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE organization_id = ?`,
  `UPDATE call_records SET cost_credits = ? WHERE id = ? AND organization_id = ?`,
];
/** Ledger ID is the unique transactional gate. Preserve debt, never invent a
 * zero balance that disagrees with the ledger. No payment method is charged. */
export async function settleExotel(
  db: D1Database,
  org: string,
  callId: string,
  credits: number,
) {
  if (!Number.isSafeInteger(credits) || credits <= 0)
    throw new Error('Invalid call charge.');
  const ledgerId = `exotel_settlement_${callId}`;
  if (
    await db
      .prepare('SELECT id FROM credit_ledger WHERE id = ?')
      .bind(ledgerId)
      .first()
  )
    return false;
  const wallet = await db
    .prepare(
      'SELECT organization_id FROM organization_wallets WHERE organization_id = ?',
    )
    .bind(org)
    .first();
  if (!wallet)
    throw new Error('Call wallet is missing; settlement requires review.');
  try {
    await db.batch([
      db
        .prepare(EXOTEL_SETTLEMENT_SQL[0])
        .bind(ledgerId, -credits, credits, callId, org),
      db.prepare(EXOTEL_SETTLEMENT_SQL[1]).bind(credits, org),
      db.prepare(EXOTEL_SETTLEMENT_SQL[2]).bind(credits, callId, org),
    ]);
    return true;
  } catch (error) {
    if (
      !(await db
        .prepare('SELECT id FROM credit_ledger WHERE id = ?')
        .bind(ledgerId)
        .first())
    )
      throw error;
    return false;
  }
}
