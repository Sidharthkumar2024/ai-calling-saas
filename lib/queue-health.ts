/**
 * Whether background work is running at all.
 *
 * This is the single most important operational fact about this product and
 * nothing reported it. Everything that happens between requests — dialling a
 * campaign, delivering a WhatsApp message, executing a workflow, generating a
 * report, closing an abandoned call — happens in `background_jobs`, and the
 * queue is drained by an external scheduler calling `/api/internal/jobs`.
 * There is no `scheduled` handler; if that scheduler stops, the product goes
 * quiet and keeps saying it is fine.
 *
 * It said so literally. The queue's health was judged on its lifetime success
 * rate and its backlog depth: a workspace whose cron had been dead for three
 * days, with hundreds of old completions and two hundred jobs waiting, scored
 * a ~0% error rate and reported healthy. The one staleness rule in the health
 * code only applies when a component has recorded nothing at all, which a
 * queue that once worked never satisfies again.
 *
 * So the queue is judged on a different question: has anything been drained
 * since the oldest waiting job appeared?
 *
 * Pure — no database, no clock of its own — so the arithmetic is tested
 * directly.
 */

/** A scheduler is expected to call in far more often than this. */
export const STALLED_AFTER_MS = 15 * 60 * 1000;
/** Draining, but not fast enough to matter for a conversation. */
export const BEHIND_AFTER_MS = 60 * 60 * 1000;

export type QueueFacts = {
  /** Jobs waiting to run: queued or retrying. */
  waiting: number;
  /** When the longest-waiting job became available. */
  oldestWaitingAt: string | null;
  /** The most recent completion of any job. */
  lastCompletedAt: string | null;
  /** Jobs that gave up. */
  dead: number;
};

export type QueueVerdict = {
  state: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  reason: string;
  /** How long the oldest waiting job has waited, in ms. */
  waitedMs: number | null;
  /** How long since anything was drained, in ms. */
  idleMs: number | null;
};

function ms(value: string | null, now: number): number | null {
  if (!value) return null;
  // SQLite writes "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker; read as
  // local time that is hours out, which here would invent or hide a stall.
  const normalised = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const parsed = Date.parse(normalised);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, now - parsed);
}

function readable(value: number): string {
  const minutes = Math.round(value / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(value / 3_600_000);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${Math.round(value / 86_400_000)} days`;
}

/** The sentence a workspace needs when the scheduler has stopped. */
export const STALLED_DETAIL =
  'Background work runs from a scheduler calling /api/internal/jobs. While it is not running, campaigns are not dialled, WhatsApp messages are not sent, workflows do not execute and reports are not generated.';

export function queueVerdict(
  facts: QueueFacts,
  now: number = Date.now(),
): QueueVerdict {
  const waitedMs = ms(facts.oldestWaitingAt, now);
  const idleMs = ms(facts.lastCompletedAt, now);
  const base = { waitedMs, idleMs };

  if (facts.waiting === 0) {
    if (idleMs === null)
      return {
        ...base,
        state: 'unknown',
        reason: 'Nothing has been queued yet, so there is nothing to measure.',
      };
    // An empty queue is the normal resting state. It says nothing about
    // whether the worker still runs, and claiming otherwise would be the same
    // lie in the other direction.
    return {
      ...base,
      state: 'healthy',
      reason: `Nothing is waiting. The last job finished ${readable(idleMs)} ago.`,
    };
  }

  // Work is waiting, so the question is whether anything is draining it — and
  // that is an absolute question, not one relative to the oldest job.
  // Comparing the two ages was wrong in exactly the case this module exists
  // for: a cron dead for three days leaves both at three days, which read as
  // "running but not keeping up" and would send somebody to look at capacity.
  if (idleMs === null || idleMs > STALLED_AFTER_MS)
    return {
      ...base,
      state: 'unhealthy',
      reason: `${facts.waiting} job${facts.waiting === 1 ? '' : 's'} are waiting and nothing has been processed${
        idleMs === null ? ' at all' : ` in ${readable(idleMs)}`
      }. ${STALLED_DETAIL}`,
    };

  if (waitedMs !== null && waitedMs > STALLED_AFTER_MS)
    return {
      ...base,
      state: waitedMs > BEHIND_AFTER_MS ? 'unhealthy' : 'degraded',
      reason: `The oldest waiting job has been waiting ${readable(waitedMs)}. The scheduler is running but not keeping up.`,
    };

  if (facts.dead > 0)
    return {
      ...base,
      state: 'degraded',
      reason: `${facts.waiting} waiting, and ${facts.dead} job${facts.dead === 1 ? ' has' : 's have'} given up after repeated failures.`,
    };

  return {
    ...base,
    state: 'healthy',
    reason: `${facts.waiting} waiting and being drained.`,
  };
}
