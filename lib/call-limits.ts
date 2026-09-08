/**
 * The two limits a workspace cannot exceed, whatever a browser asks for.
 *
 * A reservation holds one started minute. That is the right floor and a poor
 * ceiling: nothing stopped a workspace opening calls in parallel, each holding
 * ten credits and each free to run for an hour. Ten tabs on a hundred-credit
 * wallet is six hundred credits of debt by the time anyone looks, and every one
 * of those minutes costs a supplier invoice that arrives whether the customer
 * can pay or not.
 *
 * So: a cap on how many calls may be open at once, enforced where the
 * reservation is taken rather than by counting first and inserting after — the
 * count-then-act race is exactly what the reservation exists to close. And a
 * hard ceiling on how long one call may run, enforced by the sweep, because a
 * call with a turn every minute never goes idle and would otherwise run until
 * the tab is closed.
 */

/**
 * Calls one workspace may have open at once.
 *
 * Six is a working desk's worth — more than a person needs, few enough that a
 * runaway script is stopped before the wallet is. It is a limit on concurrency,
 * not on volume: a workspace may place any number of calls in a day.
 */
export const MAX_CONCURRENT_CALLS = 6;

/**
 * The longest one call may run before the server ends it.
 *
 * Ninety minutes is far beyond any real conversation and short enough that a
 * socket nobody is listening to stops billing the same day. A call ended this
 * way is settled for the minutes it actually ran, not written off.
 */
export const MAX_CALL_MINUTES = 90;

export type ConcurrencyVerdict = {
  allowed: boolean;
  open: number;
  limit: number;
  /** What the operator is told. Names the number, because "try later" does not. */
  reason?: string;
};

export function concurrencyVerdict(
  open: number,
  limit: number = MAX_CONCURRENT_CALLS,
): ConcurrencyVerdict {
  const running = Math.max(0, Math.round(Number(open) || 0));
  if (running < limit) return { allowed: true, open: running, limit };
  return {
    allowed: false,
    open: running,
    limit,
    reason: `${running} calls are already open in this workspace, which is the limit of ${limit}. End one before starting another.`,
  };
}

/** Whether a call that started this long ago has outstayed the ceiling. */
export function overranMaximum(
  startedAtMs: number,
  now: number = Date.now(),
  maxMinutes: number = MAX_CALL_MINUTES,
): boolean {
  if (!Number.isFinite(startedAtMs) || startedAtMs <= 0) return false;
  return now - startedAtMs >= maxMinutes * 60 * 1000;
}
