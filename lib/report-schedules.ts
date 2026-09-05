/**
 * Report cadences and delivery recipients (§6, Reports).
 *
 * The bug this exists to fix: the scheduler asked for every active report
 * whose `last_generated_at` was older than one day, regardless of what its
 * schedule actually said. So a report a workspace set to *monthly* ran every
 * day, and a report set to *weekly* ran every day, and the schedule column was
 * decoration. Nothing surfaced this because the runs all succeed — you only
 * notice by counting them.
 *
 * `schedule` was also a free string clipped to forty characters, so
 * "fortnightly" saved happily and then ran daily like everything else. It is a
 * closed set here, and anything else is rejected at the API rather than stored
 * and quietly reinterpreted.
 *
 * Pure: the cadences, whether one is due, when it next runs, and who a report
 * may be sent to.
 */

export const REPORT_SCHEDULES = [
  'manual',
  'daily',
  'weekly',
  'monthly',
] as const;
export type ReportSchedule = (typeof REPORT_SCHEDULES)[number];

export function isReportSchedule(value: unknown): value is ReportSchedule {
  return (
    typeof value === 'string' &&
    (REPORT_SCHEDULES as readonly string[]).includes(value)
  );
}

/** Days between runs. `manual` has no cadence and never becomes due on its own. */
const CADENCE_DAYS: Record<ReportSchedule, number | null> = {
  manual: null,
  daily: 1,
  weekly: 7,
  monthly: 30,
};

export function describeSchedule(schedule: ReportSchedule): string {
  if (schedule === 'manual') return 'Only when you ask for it';
  if (schedule === 'daily') return 'Every day';
  if (schedule === 'weekly') return 'Every 7 days';
  return 'Every 30 days';
}

/**
 * Whether a report should run now.
 *
 * A report that has never run is due immediately — otherwise a weekly report
 * created today would sit doing nothing for a week and look broken.
 */
export function isDue(input: {
  schedule: ReportSchedule;
  lastGeneratedAt: string | null;
  now?: Date;
}): boolean {
  const days = CADENCE_DAYS[input.schedule];
  if (days === null) return false;
  if (!input.lastGeneratedAt) return true;
  const last = parseTimestamp(input.lastGeneratedAt);
  if (!last) return true;
  const now = input.now ?? new Date();
  return now.getTime() - last.getTime() >= days * 86_400_000;
}

/** When it will next run, so the screen can say so instead of "scheduled". */
export function nextRunAt(input: {
  schedule: ReportSchedule;
  lastGeneratedAt: string | null;
  now?: Date;
}): Date | null {
  const days = CADENCE_DAYS[input.schedule];
  if (days === null) return null;
  const now = input.now ?? new Date();
  const last = input.lastGeneratedAt
    ? parseTimestamp(input.lastGeneratedAt)
    : null;
  if (!last) return now;
  const due = new Date(last.getTime() + days * 86_400_000);
  return due.getTime() <= now.getTime() ? now : due;
}

/**
 * SQLite writes `CURRENT_TIMESTAMP` as "YYYY-MM-DD HH:MM:SS" in UTC with no
 * zone marker, and `new Date()` on that string is parsed as *local* time —
 * which has already caused a session to look expired in this codebase. Both
 * shapes are handled here so nothing downstream has to remember.
 */
function parseTimestamp(value: string): Date | null {
  const text = value.trim();
  if (!text) return null;
  const normalised = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(' ', 'T')}Z`
    : text;
  const date = new Date(normalised);
  return Number.isNaN(date.getTime()) ? null : date;
}

export type RecipientCheck = {
  /** Addresses that will actually be written to. */
  valid: string[];
  /** Entries that were dropped, with the reason. Never silently discarded. */
  rejected: Array<{ value: string; reason: string }>;
};

export const MAX_RECIPIENTS = 10;

/** Recipients arrive as JSON from a form, so only a string is an address. */
function onlyText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Checks who a scheduled report may be sent to.
 *
 * Rejections are returned rather than filtered away: a person who typed one
 * address wrongly out of four should be told which one, not left to wonder
 * why three people get the report.
 */
export function checkRecipients(input: unknown): RecipientCheck {
  const entries = Array.isArray(input)
    ? input.map((entry: unknown) => onlyText(entry))
    : onlyText(input)
        .split(/[\n,;]/)
        .map((entry) => entry.trim());
  const valid: string[] = [];
  const rejected: RecipientCheck['rejected'] = [];
  for (const raw of entries) {
    const value = raw.trim();
    if (!value) continue;
    if (valid.length >= MAX_RECIPIENTS) {
      rejected.push({
        value,
        reason: `Only ${MAX_RECIPIENTS} recipients per report.`,
      });
      continue;
    }
    const lower = value.toLowerCase();
    if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(lower)) {
      rejected.push({ value, reason: 'Not an email address.' });
      continue;
    }
    if (valid.includes(lower)) {
      rejected.push({ value, reason: 'Listed twice.' });
      continue;
    }
    valid.push(lower);
  }
  return { valid, rejected };
}

/**
 * What a delivery actually achieved.
 *
 * `sandbox` is a real state, not a failure and not a success: no email
 * provider is connected, so nothing left the building. It has to be
 * distinguishable from `sent` on the screen, or a workspace will believe its
 * Monday report is landing in an inbox somewhere.
 */
export type DeliveryState = 'sent' | 'sandbox' | 'failed' | 'no_recipients';

export function describeDelivery(state: DeliveryState, count: number): string {
  if (state === 'no_recipients')
    return 'Generated. Nobody is listed to receive it, so it was not sent anywhere.';
  if (state === 'sandbox')
    return `Generated. No email provider is connected, so the ${count === 1 ? 'recipient was' : `${count} recipients were`} not written to.`;
  if (state === 'failed')
    return 'Generated, but the email provider refused it. The report is still here to download.';
  return `Generated and emailed to ${count} recipient${count === 1 ? '' : 's'}.`;
}
