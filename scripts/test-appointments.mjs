import assert from 'node:assert/strict';

import {
  APPOINTMENT_STATUSES,
  REMINDER_LEAD_MINUTES,
  appointmentTiming,
  canMoveAppointment,
  confirmationMessage,
  describeSlot,
  isAppointmentStatus,
  needsReminder,
  nextAppointmentStatuses,
  queueOrder,
  queueSummary,
  reminderMessage,
  slotInstant,
  todayIn,
} from '../lib/appointments.ts';

let checks = 0;
const check = (fn) => {
  fn();
  checks += 1;
};

// --- statuses ----------------------------------------------------------------

check(() => assert.equal(APPOINTMENT_STATUSES.length, 5));
check(() => assert.equal(isAppointmentStatus('no_show'), true));
check(() => assert.equal(isAppointmentStatus('rescheduled'), false));

check(() =>
  assert.deepEqual(nextAppointmentStatuses('booked'), [
    'confirmed',
    'completed',
    'no_show',
    'cancelled',
  ]),
);
// A confirmed appointment cannot be confirmed twice.
check(() =>
  assert.equal(
    nextAppointmentStatuses('confirmed').includes('confirmed'),
    false,
  ),
);
// Terminal means terminal. Somebody who turns up after being marked absent
// gets a new booking, so the record still shows that a person waited.
check(() => assert.deepEqual(nextAppointmentStatuses('no_show'), []));
check(() => assert.deepEqual(nextAppointmentStatuses('completed'), []));
check(() => assert.deepEqual(nextAppointmentStatuses('cancelled'), []));
check(() => assert.equal(canMoveAppointment('booked', 'completed'), true));
check(() => assert.equal(canMoveAppointment('cancelled', 'completed'), false));

// --- time --------------------------------------------------------------------

// THE BUG THIS EXISTS FOR: a slot is a naive wall-clock string, and the hours
// it uses are Indian business hours. Read as UTC — which is what the runtime
// does on a Worker — 3 PM becomes 8:30 PM IST and every reminder fires five
// and a half hours late.
check(() =>
  assert.equal(
    slotInstant('2026-09-06T15:00', 'Asia/Kolkata'),
    Date.parse('2026-09-06T09:30:00.000Z'),
  ),
);
check(() =>
  assert.notEqual(
    slotInstant('2026-09-06T15:00', 'Asia/Kolkata'),
    Date.parse('2026-09-06T15:00:00.000Z'),
  ),
);
// A zone that does observe DST must come out right on both sides of the shift.
check(() =>
  assert.equal(
    slotInstant('2026-01-15T15:00', 'Europe/London'),
    Date.parse('2026-01-15T15:00:00.000Z'),
  ),
);
check(() =>
  assert.equal(
    slotInstant('2026-07-15T15:00', 'Europe/London'),
    Date.parse('2026-07-15T14:00:00.000Z'),
  ),
);
// Malformed input is null, never a silent 1970.
check(() => assert.equal(slotInstant('tomorrow at 3', 'Asia/Kolkata'), null));
check(() => assert.equal(slotInstant('2026-09-06', 'Asia/Kolkata'), null));
check(() => assert.equal(slotInstant('', 'Asia/Kolkata'), null));

// 01:00 IST on the 6th is still the 5th in UTC. `toISOString().slice(0,10)`
// was the old answer, and it made "today" yesterday for five and a half hours
// every night.
check(() =>
  assert.equal(
    todayIn('Asia/Kolkata', new Date('2026-09-05T19:30:00.000Z')),
    '2026-09-06',
  ),
);
check(() =>
  assert.equal(
    todayIn('Asia/Kolkata', new Date('2026-09-05T10:00:00.000Z')),
    '2026-09-05',
  ),
);

check(() =>
  assert.match(describeSlot('2026-09-06T15:00', 'Asia/Kolkata'), /3:00\s*pm/i),
);
check(() =>
  assert.match(describeSlot('2026-09-06T15:00', 'Asia/Kolkata'), /6 Sep/),
);
check(() => assert.equal(describeSlot('nonsense', 'Asia/Kolkata'), 'nonsense'));

// --- timing ------------------------------------------------------------------

const slot = '2026-09-06T15:00'; // 09:30Z
const booked = { slot_start: slot, status: 'booked', timezone: 'Asia/Kolkata' };

check(() =>
  assert.equal(
    appointmentTiming(booked, new Date('2026-09-06T09:25:00.000Z')).phase,
    'now',
  ),
);
check(() =>
  assert.equal(
    appointmentTiming(booked, new Date('2026-09-06T05:00:00.000Z')).phase,
    'soon',
  ),
);
check(() =>
  assert.equal(
    appointmentTiming(booked, new Date('2026-09-04T05:00:00.000Z')).phase,
    'upcoming',
  ),
);
// The row that matters: its time came and went and it still reads "booked".
const late = appointmentTiming(booked, new Date('2026-09-06T12:00:00.000Z'));
check(() => assert.equal(late.phase, 'past_due'));
check(() => assert.match(late.message, /no outcome/));
check(() =>
  assert.equal(
    appointmentTiming(
      { ...booked, status: 'completed' },
      new Date('2026-09-06T12:00:00.000Z'),
    ).phase,
    'closed',
  ),
);
// A slot nothing can read is said so, rather than being treated as 1970 and
// screaming that it is 56 years overdue.
const unreadable = appointmentTiming(
  { slot_start: 'next tuesday', status: 'booked' },
  new Date('2026-09-06T12:00:00.000Z'),
);
check(() => assert.equal(unreadable.phase, 'unknown'));
check(() => assert.equal(unreadable.minutesAway, null));

// --- reminders ---------------------------------------------------------------

const madeEarly = { ...booked, created_at: '2026-09-01 10:00:00' };

check(() =>
  assert.equal(
    needsReminder(madeEarly, new Date('2026-09-05T20:00:00.000Z')),
    true,
  ),
);
// Outside the window yet.
check(() =>
  assert.equal(
    needsReminder(madeEarly, new Date('2026-09-04T09:30:00.000Z')),
    false,
  ),
);
// Already sent.
check(() =>
  assert.equal(
    needsReminder(
      { ...madeEarly, reminded_at: '2026-09-05 20:00:00' },
      new Date('2026-09-05T21:00:00.000Z'),
    ),
    false,
  ),
);
// Already happened.
check(() =>
  assert.equal(
    needsReminder(madeEarly, new Date('2026-09-06T11:00:00.000Z')),
    false,
  ),
);
check(() =>
  assert.equal(
    needsReminder(
      { ...madeEarly, status: 'cancelled' },
      new Date('2026-09-05T20:00:00.000Z'),
    ),
    false,
  ),
);
// Somebody who agreed to a 3 PM visit at 1 PM does not need a message at 2
// telling them about the 3 PM visit.
check(() =>
  assert.equal(
    needsReminder(
      { ...booked, created_at: '2026-09-06T07:30:00' },
      new Date('2026-09-06T08:30:00.000Z'),
    ),
    false,
  ),
);
check(() => assert.equal(REMINDER_LEAD_MINUTES, 20 * 60));

// --- what the customer reads --------------------------------------------------

const confirmation = confirmationMessage({
  customerName: 'Rohit',
  slot,
  service: 'site visit',
  mode: 'in_person',
  business: 'Sunrise Homes',
  timezone: 'Asia/Kolkata',
});
check(() => assert.match(confirmation, /^Hi Rohit,/));
check(() => assert.match(confirmation, /site visit is booked for/));
// The time in the message is the caller's time, not the server's.
check(() => assert.match(confirmation, /3:00\s*pm/i));
check(() => assert.match(confirmation, /— Sunrise Homes$/));
check(() =>
  assert.match(
    confirmationMessage({ slot, mode: 'video', timezone: 'Asia/Kolkata' }),
    /video call/,
  ),
);
check(() =>
  assert.ok(
    !confirmationMessage({ slot, mode: 'in_person' }).includes('video'),
  ),
);
check(() =>
  assert.match(
    reminderMessage({ customerName: 'Rohit', slot, timezone: 'Asia/Kolkata' }),
    /reminder that your appointment is/,
  ),
);

// --- the queue ----------------------------------------------------------------

const now = new Date('2026-09-06T09:00:00.000Z');
const rows = [
  { id: 'far', slot_start: '2026-09-10T11:00', status: 'booked' },
  { id: 'missed', slot_start: '2026-09-06T10:00', status: 'booked' },
  { id: 'soon', slot_start: '2026-09-06T17:00', status: 'booked' },
  { id: 'done', slot_start: '2026-09-05T11:00', status: 'completed' },
];
const ordered = queueOrder(rows, now);
// The one that happened this morning and was never marked is the only row on
// the screen that needs a person, so it goes first.
check(() => assert.equal(ordered[0].id, 'missed'));
check(() => assert.equal(ordered[0].timing.phase, 'past_due'));
check(() => assert.equal(ordered[1].id, 'soon'));
check(() => assert.equal(ordered[2].id, 'far'));
check(() => assert.equal(ordered[3].id, 'done'));
check(() => assert.equal(ordered.length, rows.length));

check(() => assert.match(queueSummary(rows, now), /1 has passed without/));
check(() => assert.match(queueSummary(rows, now), /1 in the next day/));
check(() => assert.equal(queueSummary([], now), 'No appointments booked.'));
check(() =>
  assert.match(
    queueSummary([{ slot_start: '2026-09-20T11:00', status: 'booked' }], now),
    /none in the next day/,
  ),
);

console.log(`appointments: ${checks} assertions passed`);
