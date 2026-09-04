import {
  agentOnShift,
  formatMinute,
  localClock,
  minuteOfDay,
  shiftCovers,
} from '../lib/shifts.ts';

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) pass++;
  else fail++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
};

// 2026-09-03 is a Thursday (day 4).
const at = (iso) => new Date(iso);
const weekday = { days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1080 }; // 09:00-18:00

console.log('timezone clock:');
ok(
  'UTC 06:00 is 11:30 in Kolkata',
  (() => {
    const c = localClock(at('2026-09-03T06:00:00Z'), 'Asia/Kolkata');
    return c.minuteOfDay === 11 * 60 + 30 && c.day === 4;
  })(),
);
ok(
  'an unknown timezone falls back to UTC instead of throwing',
  localClock(at('2026-09-03T06:00:00Z'), 'Mars/Olympus').minuteOfDay === 360,
);
ok(
  'UTC 19:00 Thursday is already Friday in Kolkata',
  localClock(at('2026-09-03T19:00:00Z'), 'Asia/Kolkata').day === 5,
);

console.log('weekday shift 09:00-18:00 Asia/Kolkata:');
ok(
  'Thursday 11:30 local is on shift',
  shiftCovers(weekday, at('2026-09-03T06:00:00Z')).onShift,
);
ok(
  'Thursday 03:30 local is outside hours',
  (() => {
    const v = shiftCovers(weekday, at('2026-09-02T22:00:00Z'));
    return !v.onShift && v.reason === 'outside_hours';
  })(),
);
ok(
  'start boundary 09:00 is inside',
  shiftCovers(weekday, at('2026-09-03T03:30:00Z')).onShift,
);
ok(
  'end boundary 18:00 is outside',
  !shiftCovers(weekday, at('2026-09-03T12:30:00Z')).onShift,
);
ok(
  'Sunday is an off day',
  (() => {
    const v = shiftCovers(weekday, at('2026-09-06T06:00:00Z'));
    return !v.onShift && v.reason === 'off_day';
  })(),
);
ok(
  'a paused shift never covers',
  (() => {
    const v = shiftCovers(
      { ...weekday, status: 'paused' },
      at('2026-09-03T06:00:00Z'),
    );
    return !v.onShift && v.reason === 'shift_inactive';
  })(),
);

console.log('breaks:');
const withBreak = {
  ...weekday,
  breakStartMinute: 810,
  breakEndMinute: 870,
}; // 13:30-14:30
ok(
  '14:00 local falls in the break',
  (() => {
    const v = shiftCovers(withBreak, at('2026-09-03T08:30:00Z'));
    return !v.onShift && v.reason === 'on_break';
  })(),
);
ok(
  '14:30 local is back on shift',
  shiftCovers(withBreak, at('2026-09-03T09:00:00Z')).onShift,
);
ok(
  'a zero-length break is ignored',
  shiftCovers(
    { ...weekday, breakStartMinute: 810, breakEndMinute: 810 },
    at('2026-09-03T08:30:00Z'),
  ).onShift,
);

console.log('overnight shift 22:00-06:00:');
const night = { days: [4], startMinute: 1320, endMinute: 360 };
ok(
  'Thursday 23:00 local is on shift',
  shiftCovers(night, at('2026-09-03T17:30:00Z')).onShift,
);
ok(
  'Friday 02:00 local still belongs to the Thursday shift',
  shiftCovers(night, at('2026-09-03T20:30:00Z')).onShift,
);
ok(
  'Friday 07:00 local is outside the overnight shift',
  !shiftCovers(night, at('2026-09-04T01:30:00Z')).onShift,
);

console.log('agent-level availability:');
ok(
  'no shifts configured means always available',
  (() => {
    const v = agentOnShift([], at('2026-09-06T20:00:00Z'));
    return v.onShift && v.reason === 'no_shifts';
  })(),
);
ok(
  'any covering shift wins',
  agentOnShift(
    [{ days: [1], startMinute: 540, endMinute: 1080 }, weekday],
    at('2026-09-03T06:00:00Z'),
  ).onShift,
);
ok(
  'a break is reported ahead of an off day',
  agentOnShift(
    [{ days: [1], startMinute: 540, endMinute: 1080 }, withBreak],
    at('2026-09-03T08:30:00Z'),
  ).reason === 'on_break',
);

console.log('time parsing:');
ok('09:30 parses to 570', minuteOfDay('09:30') === 570);
ok('24:00 is rejected', minuteOfDay('24:00') === null);
ok('9:5 is rejected', minuteOfDay('9:5') === null);
ok('570 formats as 09:30', formatMinute(570) === '09:30');
ok('1440 wraps to 00:00', formatMinute(1440) === '00:00');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
