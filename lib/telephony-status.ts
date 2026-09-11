/**
 * What a carrier's word for a call means here.
 *
 * Two separate things went wrong with this, and both were invisible.
 *
 * The normaliser turned spaces into underscores and nothing else, so Exotel's
 * own `no-answer` matched no known status and fell through to `processing` —
 * a call nobody picked up, recorded for ever as still being worked on, with no
 * end time, because the end time is only written for a terminal status.
 *
 * And the terminal set was written out by hand in the SQL that decides whether
 * to stamp `ended_at`, which is the only other place it exists. One list, two
 * copies, and the copy the normaliser needed was not a list at all.
 */

/** Statuses a call can be in while it is still going on. */
export const LIVE_CALL_STATUSES = [
  'queued',
  'ringing',
  'in_progress',
  'processing',
] as const;

/** Statuses that mean the call is over. Nothing moves a call out of one. */
export const TERMINAL_CALL_STATUSES = [
  'completed',
  'failed',
  'busy',
  'no_answer',
] as const;

export type CallStatus =
  | (typeof LIVE_CALL_STATUSES)[number]
  | (typeof TERMINAL_CALL_STATUSES)[number];

const KNOWN: readonly string[] = [
  ...LIVE_CALL_STATUSES,
  ...TERMINAL_CALL_STATUSES,
];

/** For inlining into SQL. One definition, quoted the same way every time. */
export const TERMINAL_SQL_LIST = TERMINAL_CALL_STATUSES.map(
  (status) => `'${status}'`,
).join(',');

export function isTerminalCallStatus(value: unknown): boolean {
  return (TERMINAL_CALL_STATUSES as readonly string[]).includes(String(value));
}

/**
 * A carrier's status, in this product's words.
 *
 * Carriers write the same idea several ways — `no-answer`, `no answer`,
 * `NoAnswer`, `NO_ANSWER` — so every run of anything that is not a letter or a
 * digit becomes one underscore, and a camelCase word is split before it is
 * lowercased. Anything still unrecognised is `processing`, which is the honest
 * answer for a word this product does not know: the call is not over as far as
 * anyone here can tell.
 */
export function normaliseCallStatus(input: string | null | undefined): string {
  const text = String(input ?? '').trim();
  if (!text) return 'processing';
  const value = text
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (KNOWN.includes(value)) return value;
  // The few a carrier says differently from the way this product names them.
  const SYNONYMS: Record<string, string> = {
    answered: 'completed',
    complete: 'completed',
    completed_elsewhere: 'completed',
    noanswer: 'no_answer',
    no_answer_timeout: 'no_answer',
    canceled: 'failed',
    cancelled: 'failed',
    rejected: 'failed',
    congestion: 'failed',
    unanswered: 'no_answer',
    missed: 'no_answer',
    ring: 'ringing',
    initiated: 'queued',
  };
  return SYNONYMS[value] ?? 'processing';
}
