/**
 * The callback queue.
 *
 * A callback request is the one thing on this platform that is a **promise
 * made out loud to a person**. The agent said somebody would ring them back.
 * Everything else here can be retried or corrected; this one is already owed.
 *
 * It was created and then abandoned: rows went in from `create_callback` and
 * from the follow-up job, appeared on a list, and nothing else ever happened.
 * No status changed, nobody was notified, and after a week nobody could tell
 * which of two hundred had been called.
 *
 * So two rules shape this module.
 *
 * **A promise with a time on it can be late.** "This evening" that nobody
 * honoured by evening is not an old row, it is a broken promise, and the queue
 * has to show that rather than sorting it quietly downwards.
 *
 * **Dialling is not reaching.** A callback where nobody picked up is not done.
 * `unreachable` is its own outcome so the queue can keep offering it instead
 * of counting it as handled.
 *
 * Pure: the states, the transitions, lateness and the ordering.
 */

export const CALLBACK_STATUSES = [
  'pending',
  'in_progress',
  'completed',
  'unreachable',
  'cancelled',
] as const;
export type CallbackStatus = (typeof CALLBACK_STATUSES)[number];

export function isCallbackStatus(value: unknown): value is CallbackStatus {
  return (
    typeof value === 'string' &&
    (CALLBACK_STATUSES as readonly string[]).includes(value)
  );
}

export const CALLBACK_LABEL: Record<CallbackStatus, string> = {
  pending: 'Waiting',
  in_progress: 'Being called',
  completed: 'Reached',
  unreachable: 'No answer',
  cancelled: 'Cancelled',
};

/**
 * `unreachable` returns to the queue rather than ending there. Somebody who
 * did not pick up at four o'clock is still owed a call, and a status that
 * closed the row would quietly discharge a promise nobody kept.
 */
export function nextCallbackStatuses(from: CallbackStatus): CallbackStatus[] {
  if (from === 'pending') return ['in_progress', 'cancelled'];
  if (from === 'in_progress') return ['completed', 'unreachable', 'cancelled'];
  if (from === 'unreachable') return ['in_progress', 'cancelled'];
  return [];
}

export function canMoveCallback(from: CallbackStatus, to: CallbackStatus) {
  return nextCallbackStatuses(from).includes(to);
}

/** Statuses that still owe the customer a call. */
export const OPEN_STATUSES: CallbackStatus[] = [
  'pending',
  'in_progress',
  'unreachable',
];

export function isOpen(status: CallbackStatus) {
  return OPEN_STATUSES.includes(status);
}

/* ------------------------------------------------------------------ *
 * Lateness
 * ------------------------------------------------------------------ */

/**
 * How long a callback with no stated time may wait before it counts as late.
 * Somebody told "we will call you back" and left for four hours has been let
 * down whether or not a window was named.
 */
export const DEFAULT_WINDOW_HOURS = 4;

export type Lateness = {
  late: boolean;
  /** Hours past the promise. Zero when not late. */
  hoursLate: number;
  /** What the row says on the queue. */
  message: string;
};

/**
 * Whether this callback is overdue.
 *
 * `requestedWindow` is free text the caller said — "this evening", "after 6",
 * "tomorrow morning". It is deliberately not parsed into a time: guessing what
 * "evening" means and then calling a row late on that guess would invent a
 * broken promise. Only a window that states a clear time is used; everything
 * else falls back to the default wait, and the row shows the caller's own
 * words so a person can judge.
 */
export function lateness(input: {
  status: CallbackStatus;
  createdAt: string;
  requestedWindow?: string | null;
  now?: Date;
}): Lateness {
  if (!isOpen(input.status)) return { late: false, hoursLate: 0, message: '' };

  const created = parseTime(input.createdAt);
  if (!created) return { late: false, hoursLate: 0, message: '' };
  const now = input.now ?? new Date();
  const waitedHours = (now.getTime() - created.getTime()) / 3_600_000;

  const stated = statedHours(input.requestedWindow);
  const allowed = stated ?? DEFAULT_WINDOW_HOURS;
  if (waitedHours <= allowed) return { late: false, hoursLate: 0, message: '' };

  const hoursLate = Math.floor(waitedHours - allowed);
  return {
    late: true,
    hoursLate,
    message: stated
      ? `Promised within ${allowed} hours and now ${hoursLate} hours past that.`
      : `Waiting ${Math.floor(waitedHours)} hours with no call back yet.`,
  };
}

/**
 * A number of hours out of a window, only when the caller stated one clearly.
 * "within 2 hours", "in 30 minutes". Anything vaguer is left alone.
 */
function statedHours(window: string | null | undefined): number | null {
  const text = (window ?? '').toLowerCase();
  if (!text.trim()) return null;
  const hours = /(\d+)\s*(hour|hr)/.exec(text);
  if (hours) return Math.max(0.25, Number(hours[1]));
  const minutes = /(\d+)\s*(minute|min)/.exec(text);
  if (minutes) return Math.max(0.25, Number(minutes[1]) / 60);
  return null;
}

function parseTime(value: string): Date | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  const normalised = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(' ', 'T')}Z`
    : text;
  const date = new Date(normalised);
  return Number.isNaN(date.getTime()) ? null : date;
}

/* ------------------------------------------------------------------ *
 * Ordering
 * ------------------------------------------------------------------ */

export type QueueRow = {
  id: string;
  status: CallbackStatus;
  createdAt: string;
  requestedWindow?: string | null;
};

/**
 * The order somebody should work the queue in.
 *
 * Late first, oldest first within that. Not by status, and not newest first:
 * a queue that surfaces the newest request buries the person who has been
 * waiting since this morning, which is exactly the one the business owes most.
 */
export function queueOrder<T extends QueueRow>(rows: T[], now?: Date): T[] {
  return [...rows].sort((a, b) => {
    const aOpen = isOpen(a.status);
    const bOpen = isOpen(b.status);
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    const aLate = lateness({ ...a, requestedWindow: a.requestedWindow, now });
    const bLate = lateness({ ...b, requestedWindow: b.requestedWindow, now });
    if (aLate.late !== bLate.late) return aLate.late ? -1 : 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

/** A one-line summary of the queue, for the screen and the notification. */
export function queueSummary(rows: QueueRow[], now?: Date): string {
  const open = rows.filter((row) => isOpen(row.status));
  if (open.length === 0) return 'Nobody is waiting for a call back.';
  const late = open.filter((row) => lateness({ ...row, now }).late).length;
  const people = `${open.length} ${open.length === 1 ? 'person is' : 'people are'} waiting for a call back`;
  return late > 0 ? `${people}, ${late} past the time promised.` : `${people}.`;
}
