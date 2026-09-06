/**
 * Telling a job that did its work from a job that succeeded at doing none.
 *
 * The health screen reads `job_attempts`, but only where the job is failing.
 * A job that completes is invisible — and "completed" is exactly what a
 * reminder run looks like when it found an appointment due, could not send
 * anything because the workspace has no WhatsApp connection, and correctly
 * left the row unmarked so the reminder is still owed.
 *
 * Verified against the running app: `{considered: 1, sent: 0, skipped: 1}`,
 * status `completed`, and nowhere for anybody to see it. A workspace whose
 * every reminder is skipping has no way to find that out, because nothing
 * failed.
 *
 * These are pure so the rule can be tested. The shapes are the ones the
 * workers in `lib/job-queue.ts` actually return.
 */

export type JobResult = Record<string, unknown>;

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Tolerant of an unreadable column: an unparseable result is simply not a skip. */
export function parseResult(json: string | null | undefined): JobResult | null {
  try {
    const parsed = JSON.parse(String(json ?? '')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as JobResult)
      : null;
  } catch {
    return null;
  }
}

export type SilentRun = {
  /** How many items the run had work for. */
  considered: number;
  /** How many it could not act on. */
  skipped: number;
  message: string;
};

/**
 * Whether a completed run left work undone, and how much.
 *
 * Null when the run did what it was for — including when it had nothing to do,
 * which is not a problem and must not be reported as one. A queue with no
 * appointments in the next day should be quiet, not amber.
 */
export function silentRun(
  type: string,
  result: JobResult | null,
): SilentRun | null {
  if (!result) return null;
  const considered = num(result.considered);
  const skipped = num(result.skipped);
  const failed = num(result.failed);

  // Nothing to do is not the same as nothing done.
  if (considered === 0 && skipped === 0 && failed === 0) return null;
  if (skipped === 0 && failed === 0) return null;

  const undone = skipped + failed;
  return {
    considered,
    skipped: undone,
    message: `${label(type)} had ${considered || undone} to do and left ${undone} undone. Nothing failed, so nothing was reported — the usual cause is a channel this workspace has not connected.`,
  };
}

function label(type: string): string {
  switch (type) {
    case 'appointments.remind':
      return 'The appointment reminder run';
    case 'messages.deliver':
      return 'The message delivery run';
    case 'report.generate':
      return 'The report run';
    default:
      return `The ${type} run`;
  }
}

/**
 * Rolls repeated runs of one job type into a single line.
 *
 * A run that skips every hour is one problem reported twenty-four times, and a
 * panel that lists all of them buries the other three.
 */
export function summariseSilentRuns(
  rows: Array<{ type: string; result: string | null }>,
): Array<{
  type: string;
  runs: number;
  considered: number;
  skipped: number;
  message: string;
}> {
  const byType = new Map<
    string,
    {
      type: string;
      runs: number;
      considered: number;
      skipped: number;
      message: string;
    }
  >();
  for (const row of rows) {
    const silent = silentRun(row.type, parseResult(row.result));
    if (!silent) continue;
    const entry = byType.get(row.type) ?? {
      type: row.type,
      runs: 0,
      considered: 0,
      skipped: 0,
      message: silent.message,
    };
    entry.runs += 1;
    entry.considered += silent.considered;
    entry.skipped += silent.skipped;
    byType.set(row.type, entry);
  }
  return [...byType.values()].sort(
    (left, right) => right.skipped - left.skipped,
  );
}
