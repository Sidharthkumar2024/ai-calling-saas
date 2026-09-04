/**
 * Shift-aware availability (§6).
 *
 * Routing used to look only at `support_agents.availability`, so an agent who
 * forgot to go offline stayed routable at 3am and an agent on a break kept
 * receiving calls. These are pure functions so every boundary is testable.
 *
 * Minutes are minutes-from-midnight in the shift's own timezone. A shift whose
 * end is not after its start is treated as crossing midnight.
 */

export type Shift = {
  /** 0 = Sunday .. 6 = Saturday. */
  days: number[];
  startMinute: number;
  endMinute: number;
  breakStartMinute?: number | null;
  breakEndMinute?: number | null;
  timezone?: string | null;
  status?: string;
};

export type ShiftVerdict = {
  onShift: boolean;
  reason:
    | 'on_shift'
    | 'no_shifts'
    | 'off_day'
    | 'outside_hours'
    | 'on_break'
    | 'shift_inactive';
};

/**
 * Local weekday and minute-of-day for an instant in a named timezone.
 * Intl is used rather than manual offsets so DST and half-hour zones are the
 * platform's problem, not ours.
 */
export function localClock(at: Date, timezone: string) {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(at);
  } catch {
    // An unknown timezone must not make everyone unroutable.
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(at);
  }
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const day = weekdays[get('weekday')] ?? 0;
  // Intl renders midnight as "24" in some environments.
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  return { day, minuteOfDay: hour * 60 + minute };
}

function withinWindow(minute: number, start: number, end: number) {
  if (end > start) return minute >= start && minute < end;
  // Crosses midnight: 22:00 → 06:00.
  return minute >= start || minute < end;
}

/** Whether one shift covers this instant. */
export function shiftCovers(shift: Shift, at: Date): ShiftVerdict {
  if (shift.status && shift.status !== 'active')
    return { onShift: false, reason: 'shift_inactive' };
  const timezone = shift.timezone || 'Asia/Kolkata';
  const { day, minuteOfDay } = localClock(at, timezone);
  // A shift that crosses midnight is owned by the day it started on, so an
  // 22:00-06:00 shift still covers 02:00 on the following morning.
  const crossesMidnight = shift.endMinute <= shift.startMinute;
  const startDay =
    crossesMidnight && minuteOfDay < shift.endMinute ? (day + 6) % 7 : day;
  if (!shift.days.includes(startDay))
    return { onShift: false, reason: 'off_day' };
  if (!withinWindow(minuteOfDay, shift.startMinute, shift.endMinute))
    return { onShift: false, reason: 'outside_hours' };
  const breakStart = shift.breakStartMinute;
  const breakEnd = shift.breakEndMinute;
  if (
    typeof breakStart === 'number' &&
    typeof breakEnd === 'number' &&
    breakEnd !== breakStart &&
    withinWindow(minuteOfDay, breakStart, breakEnd)
  )
    return { onShift: false, reason: 'on_break' };
  return { onShift: true, reason: 'on_shift' };
}

/**
 * Whether an agent is on shift. An agent with no shifts configured is treated
 * as always available — shifts are opt-in, so adding the table must not make
 * every existing workspace unroutable.
 */
export function agentOnShift(shifts: Shift[], at: Date): ShiftVerdict {
  if (!shifts.length) return { onShift: true, reason: 'no_shifts' };
  const verdicts = shifts.map((shift) => shiftCovers(shift, at));
  const covering = verdicts.find((verdict) => verdict.onShift);
  if (covering) return covering;
  // Report the most specific reason: a break is more informative than "off day".
  return (
    verdicts.find((verdict) => verdict.reason === 'on_break') ??
    verdicts.find((verdict) => verdict.reason === 'outside_hours') ??
    verdicts[0]
  );
}

/** "09:30" style helper for building shifts from user input. */
export function minuteOfDay(time: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function formatMinute(minute: number) {
  const safe = ((Math.round(minute) % 1440) + 1440) % 1440;
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(
    safe % 60,
  ).padStart(2, '0')}`;
}
