// Relative, with the extension: `@/lib/...` does not resolve under bare Node,
// and this module is imported directly by `scripts/test-release-safety.mjs`.
import { REALTIME_CREDITS } from './realtime-reservations.ts';

/**
 * Paying for a call the browser carried.
 *
 * The dialer read the wallet, refused below ten credits, and then charged
 * nothing at all. Two things followed:
 *
 *  - The check was a race with no lock behind it. Ten starts arriving together
 *    on a ten-credit wallet all read the same balance and all passed, because
 *    nothing was held between the read and the call.
 *  - A browser call was free. `settleExotel` covers a carrier's calls; nothing
 *    covered this one, so the minutes a workspace spent through its own tab
 *    never reached the ledger.
 *
 * The reservation the dialer now takes at start is the answer to the first,
 * and it is deliberately the same ten credits as the minimum charge — one
 * started minute. So a call under a minute is already paid for when it ends,
 * and settlement only ever charges the *extra* minutes beyond it. That is what
 * keeps a reservation and a usage charge from becoming two charges for one
 * call.
 */

/** Started-minute pulses, the same rule a carrier bills on. */
export function browserCallCredits(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new Error('Invalid duration');
  return Math.max(
    REALTIME_CREDITS,
    Math.ceil(Math.max(1, seconds) / 60) * REALTIME_CREDITS,
  );
}

export const BROWSER_SETTLEMENT_SQL = [
  // Only the minutes beyond the reservation. `balance_after` comes from the
  // wallet row rather than from arithmetic done before the call.
  `INSERT INTO credit_ledger
     (id, organization_id, type, amount, balance_after, reference_type, reference_id, description)
   SELECT ?, organization_id, 'usage', ?, balance - ?, 'call', ?, 'Browser call usage beyond the reserved first minute: 10 credits/started minute'
   FROM organization_wallets WHERE organization_id = ?`,
  `UPDATE organization_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP
   WHERE organization_id = ?`,
  `UPDATE call_records SET cost_credits = ? WHERE id = ? AND organization_id = ?`,
  // The reservation stops being outstanding whether or not extra was owed, so
  // a reconciliation job does not keep finding a finished call.
  `UPDATE realtime_reservations SET status = 'settled', updated_at = CURRENT_TIMESTAMP
   WHERE id = ? AND organization_id = ? AND status = 'reserved'`,
];

export type BrowserSettlement = {
  settled: boolean;
  /** Total credits this call cost, reservation included. */
  credits: number;
  /** Charged now, on top of the reservation already taken. */
  extra: number;
  alreadySettled: boolean;
};

/**
 * Settles one browser call.
 *
 * The call id is the gate: a retried end, a double-clicked hang-up and a
 * gateway that reports the same call twice all settle once. A wallet that has
 * gone negative on the extra minutes keeps that debt rather than being reset
 * to zero — the same rule `settleExotel` follows, because a balance that
 * disagrees with the ledger is worse than a balance that is negative.
 */
export async function settleBrowserCall(
  db: D1Database,
  input: { organizationId: string; callId: string; seconds: number },
): Promise<BrowserSettlement> {
  const { organizationId, callId, seconds } = input;
  const credits = browserCallCredits(seconds);
  const extra = credits - REALTIME_CREDITS;
  const ledgerId = `browser_settlement_${callId}`;

  // Two gates, because one is not enough. The ledger row only exists when there
  // were extra minutes to charge, so a call under a minute wrote nothing and a
  // second settlement sailed straight through — harmless while the duration
  // still reads zero, and a double charge the moment a later reading of the
  // same call is longer. The reservation's own status covers every call,
  // charged or not.
  const [existing, reservation] = await Promise.all([
    db
      .prepare('SELECT id FROM credit_ledger WHERE id = ?')
      .bind(ledgerId)
      .first<{ id: string }>(),
    db
      .prepare(
        'SELECT status FROM realtime_reservations WHERE id = ? AND organization_id = ?',
      )
      .bind(callId, organizationId)
      .first<{ status: string }>(),
  ]);
  if (existing || reservation?.status === 'settled')
    return { settled: false, credits, extra, alreadySettled: true };

  const statements = [];
  if (extra > 0) {
    statements.push(
      db
        .prepare(BROWSER_SETTLEMENT_SQL[0])
        .bind(ledgerId, -extra, extra, callId, organizationId),
      db.prepare(BROWSER_SETTLEMENT_SQL[1]).bind(extra, organizationId),
    );
  }
  statements.push(
    db.prepare(BROWSER_SETTLEMENT_SQL[2]).bind(credits, callId, organizationId),
    db.prepare(BROWSER_SETTLEMENT_SQL[3]).bind(callId, organizationId),
  );

  try {
    await db.batch(statements);
  } catch (error) {
    // If the ledger row landed, another settlement won the race and this one
    // has nothing to do. Anything else is a real failure and is raised.
    const landed = await db
      .prepare('SELECT id FROM credit_ledger WHERE id = ?')
      .bind(ledgerId)
      .first<{ id: string }>();
    if (!landed) throw error;
    return { settled: false, credits, extra, alreadySettled: true };
  }
  return { settled: true, credits, extra, alreadySettled: false };
}
