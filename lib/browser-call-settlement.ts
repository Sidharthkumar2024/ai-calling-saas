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

/**
 * Reservations that were taken and never closed.
 *
 * A realtime session reserves its first minute, negotiates with the provider,
 * and then runs — and nothing ends it. The reservation stayed `reserved` for
 * ever, which was invisible until a concurrency cap was put on that very table:
 * six realtime sessions and the workspace could never start another call
 * again, permanently, because the slots were held by sessions that had ended
 * hours ago in the only place that knew — the browser.
 *
 * This closes them once they are past any real call's length. It charges
 * nothing beyond the minute already reserved, and that is deliberate: no end
 * signal reaches this server, so the platform cannot evidence a single minute
 * beyond the first. Billing a duration nobody measured would be a guess in the
 * supplier's favour, and the customer is the one who cannot check it.
 *
 * Real duration billing for realtime needs the gateway to report the end of a
 * session. Until it does, this releases the slot and says why, rather than
 * leaving a workspace quietly unable to call.
 */
export const STALE_RESERVATION_SQL = `UPDATE realtime_reservations
   SET status = 'settled', error_code = ?, updated_at = CURRENT_TIMESTAMP
   WHERE id = ? AND status = 'reserved'`;

/**
 * Closes sessions that have stopped reporting themselves, and bills the
 * minutes they can be shown to have run.
 *
 * Two ways in. A session that has beaten recently is alive and is left alone. A
 * session whose beats stopped is over, and its last beat is the end — so the
 * duration is measured rather than guessed, accurate to within one heartbeat
 * interval and never longer than the session was. A session that never beat at
 * all is closed at the ceiling with nothing beyond the reserved minute charged,
 * which is the old behaviour and still the right one: no evidence, no bill.
 */
export async function closeStaleReservations(
  db: D1Database,
  organizationId: string,
  maxMinutes: number,
): Promise<number> {
  const { HEARTBEAT_GRACE_SECONDS, measuredSeconds } =
    await import('./realtime-reservations.ts');
  const stale = await db
    .prepare(
      `SELECT id, created_at, last_heartbeat_at FROM realtime_reservations
       WHERE organization_id = ? AND status = 'reserved'
         AND (
           (last_heartbeat_at IS NOT NULL AND last_heartbeat_at <= datetime('now', ?))
           OR created_at <= datetime('now', ?)
         )
       LIMIT 100`,
    )
    .bind(
      organizationId,
      `-${HEARTBEAT_GRACE_SECONDS} seconds`,
      `-${maxMinutes} minutes`,
    )
    .all<{
      id: string;
      created_at: string;
      last_heartbeat_at: string | null;
    }>();

  let closed = 0;
  for (const row of stale.results ?? []) {
    // Null means the session never reported itself. There is nothing to
    // measure, so nothing beyond the reserved minute is billed — `updated_at`
    // cannot stand in here, because it moves whenever any column is written
    // and would have billed the whole window from creation to sweep.
    const beat = row.last_heartbeat_at;
    const seconds = beat
      ? measuredSeconds(row.created_at, row.last_heartbeat_at)
      : 0;
    if (beat && seconds > 0) {
      // Settle *first*. `settleBrowserCall` closes the reservation itself, and
      // its own guard refuses a reservation already marked settled — so
      // marking it here first made the settlement a no-op and the measured
      // minutes were never charged.
      await settleBrowserCall(db, { organizationId, callId: row.id, seconds });
      await db
        .prepare(
          `UPDATE realtime_reservations SET error_code = 'closed_at_last_heartbeat' WHERE id = ?`,
        )
        .bind(row.id)
        .run();
    } else {
      await db
        .prepare(STALE_RESERVATION_SQL)
        .bind('closed_without_end_signal', row.id)
        .run();
    }
    closed += 1;
  }
  return closed;
}
