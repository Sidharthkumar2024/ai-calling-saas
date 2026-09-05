/**
 * Appointments as something the business can actually see and work.
 *
 * What was there before: `book_appointment` inserted a row and returned
 * `ok: true`. Nothing else in the codebase touched the table — no screen read
 * it, no message reached the customer, and there was no `UPDATE appointments`
 * anywhere, so `status` was permanently `'booked'` and the clash check's
 * `status != 'cancelled'` could never once be false. An appointment agreed on
 * a call was invisible to everyone except the caller, who had been told it was
 * confirmed.
 *
 * Two things this module is careful about.
 *
 * **Time.** A slot is stored as `YYYY-MM-DDTHH:00` with no zone, and the hours
 * it uses are plainly Indian business hours. `Date.parse` on a naive string
 * reads it as the *runtime's* local time, which on a Worker is UTC — so a 3 PM
 * appointment would have been treated as 8:30 PM IST, and every reminder would
 * have fired five and a half hours late. Nothing here parses a slot without
 * being told which zone it belongs to.
 *
 * **What was promised.** Confirming and reminding are separate from the
 * booking's own status, because "we booked it" and "we told them" are
 * different facts and the second one used to be assumed.
 */

export const APPOINTMENT_STATUSES = [
  'booked',
  'confirmed',
  'completed',
  'no_show',
  'cancelled',
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export function isAppointmentStatus(
  value: unknown,
): value is AppointmentStatus {
  return (APPOINTMENT_STATUSES as readonly string[]).includes(String(value));
}

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/**
 * What may follow what.
 *
 * `completed`, `no_show` and `cancelled` are terminal. A customer who turns up
 * late after being marked absent does not get the old row edited — they get a
 * new booking, so the record still says somebody once waited for them.
 */
export function nextAppointmentStatuses(current: string): AppointmentStatus[] {
  switch (current) {
    case 'booked':
      return ['confirmed', 'completed', 'no_show', 'cancelled'];
    case 'confirmed':
      return ['completed', 'no_show', 'cancelled'];
    default:
      return [];
  }
}

export function canMoveAppointment(from: string, to: string) {
  return nextAppointmentStatuses(from).includes(to as AppointmentStatus);
}

/** Statuses where the slot is still expected to happen. */
export function isOpenStatus(status: string) {
  return status === 'booked' || status === 'confirmed';
}

// --- time --------------------------------------------------------------------

const SLOT_SHAPE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** The wall clock an instant shows in a zone, as a UTC-based epoch. */
function wallClockAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(instant));
  const read = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  // `hour12: false` still renders midnight as 24 in some environments.
  const hour = read('hour') % 24;
  return Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    hour,
    read('minute'),
    read('second'),
  );
}

/**
 * When a naive slot string actually happens.
 *
 * Two passes, because the offset itself depends on the instant: the first
 * guess lands somewhere near the right time, and the second corrects for a
 * zone whose offset changed across that guess. India has no DST, but a
 * function that silently only works for one country is a trap for whoever
 * adds the next one.
 *
 * Returns null rather than NaN so a malformed slot cannot become "1970".
 */
export function slotInstant(
  slot: string,
  timeZone: string = DEFAULT_TIMEZONE,
): number | null {
  if (!SLOT_SHAPE.test(String(slot ?? ''))) return null;
  const naive = Date.parse(`${slot}:00Z`);
  if (!Number.isFinite(naive)) return null;
  let guess = naive - (wallClockAt(naive, timeZone) - naive);
  const drift = wallClockAt(guess, timeZone) - naive;
  if (drift !== 0) guess -= drift;
  return guess;
}

/** Today's date in the workspace's own zone, not the runtime's. */
export function todayIn(
  timeZone: string = DEFAULT_TIMEZONE,
  now: Date = new Date(),
): string {
  return new Date(wallClockAt(now.getTime(), timeZone))
    .toISOString()
    .slice(0, 10);
}

/** "Fri 6 Sep, 3:00 PM" — for a message a customer reads. */
export function describeSlot(
  slot: string,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const instant = slotInstant(slot, timeZone);
  if (instant === null) return slot;
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(instant));
}

export type Timing = {
  phase: 'past_due' | 'now' | 'soon' | 'upcoming' | 'closed' | 'unknown';
  /** Minutes until the slot. Negative once it has passed. */
  minutesAway: number | null;
  message: string;
};

/** How near a slot is, and whether somebody needs to do something about it. */
export function appointmentTiming(
  row: { slot_start: string; status: string; timezone?: string | null },
  now: Date = new Date(),
): Timing {
  const instant = slotInstant(row.slot_start, row.timezone || DEFAULT_TIMEZONE);
  if (instant === null)
    return {
      phase: 'unknown',
      minutesAway: null,
      message: `“${row.slot_start}” is not a time this system can read, so nothing was scheduled around it.`,
    };

  const minutes = Math.round((instant - now.getTime()) / 60_000);
  if (!isOpenStatus(row.status))
    return {
      phase: 'closed',
      minutesAway: minutes,
      message: `Closed as ${row.status.replace('_', ' ')}.`,
    };

  // The one that matters: an appointment whose time came and went while still
  // reading "booked" is not history, it is somebody's unanswered question.
  if (minutes < -15)
    return {
      phase: 'past_due',
      minutesAway: minutes,
      message: `This time passed ${humanGap(-minutes)} ago and still has no outcome.`,
    };
  if (minutes <= 15)
    return { phase: 'now', minutesAway: minutes, message: 'Happening now.' };
  if (minutes <= 24 * 60)
    return {
      phase: 'soon',
      minutesAway: minutes,
      message: `In ${humanGap(minutes)}.`,
    };
  return {
    phase: 'upcoming',
    minutesAway: minutes,
    message: `In ${humanGap(minutes)}.`,
  };
}

function humanGap(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, minutes)} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return hours === 1 ? '1 hour' : `${hours} hours`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 day' : `${days} days`;
}

// --- telling the customer -----------------------------------------------------

/** How long before the slot a reminder goes out. */
export const REMINDER_LEAD_MINUTES = 20 * 60;

/**
 * A booking made this close to its own slot gets no reminder.
 *
 * Somebody who agreed to a 3 PM visit at 1 PM does not need a message at 2
 * telling them about the 3 PM visit. Reminding them anyway is not a service,
 * it is the system talking to itself.
 */
export const REMINDER_MIN_NOTICE_MINUTES = 4 * 60;

export function needsReminder(
  row: {
    slot_start: string;
    status: string;
    timezone?: string | null;
    reminded_at?: string | null;
    created_at?: string | null;
  },
  now: Date = new Date(),
): boolean {
  if (!isOpenStatus(row.status)) return false;
  if (row.reminded_at) return false;
  const instant = slotInstant(row.slot_start, row.timezone || DEFAULT_TIMEZONE);
  if (instant === null) return false;

  const minutesAway = (instant - now.getTime()) / 60_000;
  // Past, or not yet inside the window.
  if (minutesAway <= 0 || minutesAway > REMINDER_LEAD_MINUTES) return false;

  const booked = row.created_at ? Date.parse(`${row.created_at}Z`) : Number.NaN;
  if (Number.isFinite(booked)) {
    const noticeGiven = (instant - booked) / 60_000;
    if (noticeGiven < REMINDER_MIN_NOTICE_MINUTES) return false;
  }
  return true;
}

export function confirmationMessage(input: {
  customerName?: string | null;
  slot: string;
  service?: string | null;
  mode?: string | null;
  business?: string | null;
  timezone?: string | null;
}): string {
  const zone = input.timezone || DEFAULT_TIMEZONE;
  const who = String(input.customerName ?? '').trim();
  const service = String(input.service ?? '').trim();
  const from = String(input.business ?? '').trim();
  return [
    who ? `Hi ${who},` : 'Hi,',
    `your ${service || 'appointment'} is booked for ${describeSlot(input.slot, zone)}.`,
    modeLine(input.mode),
    from ? `— ${from}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function reminderMessage(input: {
  customerName?: string | null;
  slot: string;
  service?: string | null;
  mode?: string | null;
  business?: string | null;
  timezone?: string | null;
}): string {
  const zone = input.timezone || DEFAULT_TIMEZONE;
  const who = String(input.customerName ?? '').trim();
  const service = String(input.service ?? '').trim();
  const from = String(input.business ?? '').trim();
  return [
    who ? `Hi ${who},` : 'Hi,',
    `a reminder that your ${service || 'appointment'} is ${describeSlot(input.slot, zone)}.`,
    modeLine(input.mode),
    from ? `— ${from}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function modeLine(mode?: string | null): string {
  if (mode === 'video') return 'It is a video call.';
  if (mode === 'phone') return 'We will call you.';
  return '';
}

// --- the queue ----------------------------------------------------------------

const PHASE_RANK: Record<Timing['phase'], number> = {
  past_due: 0,
  now: 1,
  soon: 2,
  upcoming: 3,
  unknown: 4,
  closed: 5,
};

/**
 * Overdue first, then by how near the slot is.
 *
 * The default ordering — newest booking first — buried the appointment that
 * happened this morning and was never marked, which is the only row on the
 * screen that actually needs a person.
 */
export function queueOrder<
  T extends { slot_start: string; status: string; timezone?: string | null },
>(rows: T[], now: Date = new Date()): Array<T & { timing: Timing }> {
  return rows
    .map((row) => ({ ...row, timing: appointmentTiming(row, now) }))
    .sort((left, right) => {
      const byPhase =
        PHASE_RANK[left.timing.phase] - PHASE_RANK[right.timing.phase];
      if (byPhase !== 0) return byPhase;
      return (left.timing.minutesAway ?? 0) - (right.timing.minutesAway ?? 0);
    });
}

export function queueSummary(
  rows: Array<{ slot_start: string; status: string; timezone?: string | null }>,
  now: Date = new Date(),
): string {
  const timed = rows.map((row) => appointmentTiming(row, now));
  const overdue = timed.filter((entry) => entry.phase === 'past_due').length;
  const ahead = timed.filter(
    (entry) => entry.phase === 'now' || entry.phase === 'soon',
  ).length;
  if (rows.length === 0) return 'No appointments booked.';
  const parts: string[] = [];
  if (overdue > 0)
    parts.push(
      overdue === 1
        ? '1 has passed without an outcome'
        : `${overdue} have passed without an outcome`,
    );
  if (ahead > 0) parts.push(`${ahead} in the next day`);
  if (parts.length === 0) return `${rows.length} booked, none in the next day.`;
  return `${parts.join(', ')}.`;
}
