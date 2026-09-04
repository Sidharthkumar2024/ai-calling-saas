/**
 * Readers for data the product records and never shows.
 *
 * A sweep for tables that real code writes and no real code reads turned up
 * four. Two were false positives — `invoice_sequences` is read through its own
 * UPSERT's `RETURNING`, and `graph_agents` through a helper that builds the
 * SELECT dynamically. The rest were genuine, including one written earlier in
 * this same session:
 *
 * - **`lead_events`** carries why a lead's score moved: the previous value, the
 *   new one, and every contribution with its own delta. It was written to make
 *   a score explainable and nothing could read it, which makes it exactly the
 *   failure it was meant to fix.
 * - **`agent_tool_calls`** logs every tool the agent invokes, with input,
 *   result, ok flag and latency. Nothing surfaced it, so a workspace choosing
 *   which actions to enable had no idea which ones were being used or failing.
 * - **`job_attempts`** records each attempt at a background job including the
 *   error. Only `background_jobs.last_error` was ever shown, which holds the
 *   most recent failure and loses the history that says whether something
 *   fails always or intermittently.
 *
 * Pure: shaping and description only.
 */

export type LeadEvent = {
  id: string;
  eventType: string;
  createdAt: string;
  payload: Record<string, unknown>;
};

export type DescribedEvent = {
  id: string;
  createdAt: string;
  eventType: string;
  headline: string;
  /** Each contribution, when the event carries them. */
  reasons: Array<{ signal: string; delta: number; note: string }>;
  delta: number | null;
  direction: 'up' | 'down' | 'flat';
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function num(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Turns one stored event into a line a salesperson can read.
 *
 * The payload is whatever was written, possibly by an older version, so every
 * field is treated as absent until proven otherwise. An event whose shape is
 * unrecognised still produces a headline — a timeline that silently skips
 * entries is worse than one that says "something happened here".
 */
export function describeLeadEvent(event: LeadEvent): DescribedEvent {
  const payload = asRecord(event.payload);
  const previous = num(payload.previous);
  const score = num(payload.score);
  const delta =
    num(payload.delta) ??
    (previous !== null && score !== null ? score - previous : null);
  const reasons = Array.isArray(payload.reasons)
    ? payload.reasons.map(asRecord).flatMap((raw) => {
        const value = num(raw.delta);
        const signal = typeof raw.signal === 'string' ? raw.signal : '';
        if (!signal || value === null) return [];
        return [
          {
            signal,
            delta: value,
            note: typeof raw.note === 'string' ? raw.note : signal,
          },
        ];
      })
    : [];

  let headline: string;
  if (
    event.eventType === 'score_recalculated' &&
    previous !== null &&
    score !== null
  ) {
    const status = typeof payload.status === 'string' ? payload.status : '';
    headline =
      delta === 0
        ? `Score unchanged at ${score} after a call`
        : `Score ${delta !== null && delta > 0 ? 'rose' : 'fell'} from ${previous} to ${score} after a call${status ? ` · ${status}` : ''}`;
  } else {
    headline = event.eventType.replaceAll('_', ' ');
    headline = headline.charAt(0).toUpperCase() + headline.slice(1);
  }

  return {
    id: event.id,
    createdAt: event.createdAt,
    eventType: event.eventType,
    headline,
    // Biggest contribution first: the reason a score moved is usually one of
    // them, and reading it should not mean scanning the list.
    reasons: reasons.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
    delta,
    direction:
      delta === null || delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down',
  };
}

/**
 * Reasons that mean the tool worked and the answer was no.
 *
 * `runTool` returns `{ ok: false, reason }` for both "I could not do this" and
 * "I did this and the answer is no", because that flag is the tool's reply *to
 * the model* — and the model genuinely needs to be told there is no such
 * customer. Reusing the same flag as an operational health signal made
 * `lookup_customer` read as 13 calls and 0 successes when it was working
 * perfectly every time: the callers simply were not existing customers.
 *
 * Nothing read the column, so nothing noticed. It matters the moment something
 * does, because a panel showing a healthy tool at 100% failure sends somebody
 * to debug code that has no bug in it.
 */
const NEGATIVE_ANSWERS = new Set([
  'not_found',
  'no_slots',
  'no_availability',
  'insufficient_inventory',
  'already_exists',
  'nothing_to_cancel',
  'out_of_stock',
  'not_eligible',
]);

/**
 * Reasons that mean the tool refused what it was handed.
 *
 * Counted apart from failures because the tool is behaving correctly and
 * something upstream is not. This is what surfaced the second finding: an
 * agent called `lookup_customer` with the literal string "incoming call" as a
 * phone number, because on an inbound call it was never given the caller's
 * number and guessed.
 */
const REJECTED_INPUT = new Set([
  'invalid_phone',
  'invalid_amount',
  'invalid_input',
  'missing_field',
  'invalid_date',
]);

export type ToolOutcomeKind =
  | 'succeeded'
  | 'answered_no'
  | 'rejected_input'
  | 'failed';

/** What a tool call actually was, for metrics rather than for the model. */
export function toolOutcomeKind(
  ok: boolean,
  reason?: string | null,
): ToolOutcomeKind {
  if (ok) return 'succeeded';
  const key = String(reason ?? '').trim();
  if (NEGATIVE_ANSWERS.has(key)) return 'answered_no';
  if (REJECTED_INPUT.has(key)) return 'rejected_input';
  return 'failed';
}

export type ToolCallRow = {
  toolName: string;
  succeeded: number;
  answeredNo: number;
  rejectedInput: number;
  failed: number;
  latencies: number[];
};

export type ToolUsage = {
  toolName: string;
  calls: number;
  failed: number;
  /** 0..1, or null when nothing has been called yet. */
  failureRate: number | null;
  medianLatencyMs: number | null;
  p95LatencyMs: number | null;
};

function percentile(sorted: number[], fraction: number): number | null {
  if (!sorted.length) return null;
  // Nearest-rank on a sorted array: with a handful of samples an interpolated
  // percentile invents a latency no call actually had.
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return sorted[index];
}

/**
 * Aggregates tool invocations into something worth showing.
 *
 * Failure rate is reported as null rather than 0 when a tool has never been
 * called, because "never failed" and "never tried" are different facts and a
 * green zero for the second one is a lie.
 */
export function summariseToolUsage(rows: ToolCallRow[]): ToolUsage[] {
  return (rows ?? [])
    .map((row) => {
      const succeeded = Number(row.succeeded ?? 0);
      const answeredNo = Number(row.answeredNo ?? 0);
      const rejectedInput = Number(row.rejectedInput ?? 0);
      const failed = Number(row.failed ?? 0);
      const calls = succeeded + answeredNo + rejectedInput + failed;
      const sorted = [...(row.latencies ?? [])]
        .map(Number)
        .filter((value) => Number.isFinite(value) && value >= 0)
        .sort((a, b) => a - b);
      return {
        toolName: row.toolName,
        calls,
        succeeded,
        answeredNo,
        rejectedInput,
        failed,
        // Only real failures. Counting a negative answer here is what made a
        // working lookup read as broken.
        failureRate: calls > 0 ? failed / calls : null,
        medianLatencyMs: percentile(sorted, 0.5),
        p95LatencyMs: percentile(sorted, 0.95),
      };
    })
    .sort((a, b) => b.calls - a.calls);
}

export type JobAttempt = {
  attempt: number;
  status: string;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
};

export type JobFailurePattern = {
  attempts: number;
  failures: number;
  /** 'always', 'intermittent' or 'recovered' — the thing one error cannot say. */
  pattern: 'always' | 'intermittent' | 'recovered' | 'clean';
  lastError: string | null;
  /** Distinct error messages, so one cause is not counted as five failures. */
  distinctErrors: string[];
};

/**
 * Reads a job's attempt history for the shape of its failure.
 *
 * Only `background_jobs.last_error` was ever surfaced, which is the most recent
 * failure and says nothing about whether a job fails every time — a bad payload
 * or a missing key — or intermittently, which is a provider or a timeout. Those
 * need different responses, and the history that distinguishes them was being
 * written all along.
 */
export function jobFailurePattern(attempts: JobAttempt[]): JobFailurePattern {
  const ordered = [...(attempts ?? [])].sort((a, b) => a.attempt - b.attempt);
  const failures = ordered.filter((attempt) => attempt.status !== 'succeeded');
  const errors = failures
    .map((attempt) => (attempt.error ?? '').trim())
    .filter(Boolean);
  const distinctErrors = [...new Set(errors)];
  const lastSucceeded =
    ordered.length > 0 && ordered[ordered.length - 1].status === 'succeeded';

  const pattern: JobFailurePattern['pattern'] = !ordered.length
    ? 'clean'
    : !failures.length
      ? 'clean'
      : lastSucceeded
        ? 'recovered'
        : failures.length === ordered.length
          ? 'always'
          : 'intermittent';

  return {
    attempts: ordered.length,
    failures: failures.length,
    pattern,
    lastError: errors.length ? errors[errors.length - 1] : null,
    distinctErrors,
  };
}
