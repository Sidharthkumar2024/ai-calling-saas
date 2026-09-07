import assert from 'node:assert/strict';

import {
  CREDIT_FLOOR,
  TOAST_LIFETIME_MS,
  dedupeKey,
  inboxSummary,
  requiresAcknowledgement,
  toastLifetime,
  CREDIT_WARNING,
  DEFAULT_SOUND_PREFERENCES,
  NOTIFICATION_EVENTS,
  NOTIFICATION_SPECS,
  creditAlert,
  isNotificationEvent,
  motionClass,
  newlyArrived,
  normalisePreferences,
  shouldPlaySound,
  toneDuration,
  toneGain,
  winningEvent,
} from '../lib/notifications.ts';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

console.log('event vocabulary');

check('every event has a complete spec', () => {
  for (const event of NOTIFICATION_EVENTS) {
    const spec = NOTIFICATION_SPECS[event];
    assert.ok(spec, `${event} has no spec`);
    assert.equal(spec.event, event);
    assert.ok(spec.title, `${event} has no title`);
    assert.ok(spec.tone.length > 0, `${event} makes no sound`);
    assert.ok(spec.motion, `${event} has no motion`);
  }
});

check('§33 names all five event animations', () => {
  for (const event of [
    'ringing',
    'handoff_requested',
    'transfer_accepted',
    'payment_success',
    'credit_low',
  ])
    assert.ok(isNotificationEvent(event), `${event} missing`);
});

check('only ringing sustains, because only a phone keeps ringing', () => {
  const sustained = NOTIFICATION_EVENTS.filter(
    (event) => NOTIFICATION_SPECS[event].sustained,
  );
  assert.deepEqual(sustained, ['ringing']);
});

check('tones are short enough to be notifications', () => {
  for (const event of NOTIFICATION_EVENTS)
    assert.ok(
      toneDuration(event) <= 800,
      `${event} runs ${toneDuration(event)}ms`,
    );
});

check('good news rises in pitch and bad news falls', () => {
  const direction = (event) => {
    const tones = NOTIFICATION_SPECS[event].tone;
    return tones[tones.length - 1].frequency - tones[0].frequency;
  };
  // Somebody hearing these across a working day should be able to tell a
  // payment from a problem without looking at the screen.
  assert.ok(direction('payment_success') > 0);
  assert.ok(direction('transfer_accepted') > 0);
  assert.ok(direction('credit_added') > 0);
  assert.ok(direction('credit_low') < 0);
  assert.ok(direction('error') < 0);
});

check('an unknown event is not an event', () => {
  assert.equal(isNotificationEvent('celebration'), false);
  assert.equal(isNotificationEvent(null), false);
  assert.equal(isNotificationEvent(7), false);
});

console.log('preferences');

check('stored rubbish becomes something a gain node accepts', () => {
  // localStorage returns whatever was last written, including by hand or by an
  // older version of this code.
  assert.deepEqual(normalisePreferences({ volume: 'loud' }), {
    muted: true,
    volume: DEFAULT_SOUND_PREFERENCES.volume,
  });
  assert.equal(normalisePreferences({ volume: 12 }).volume, 1);
  assert.equal(normalisePreferences({ volume: -3 }).volume, 0);
  assert.equal(normalisePreferences(null).muted, true);
  assert.equal(normalisePreferences({ muted: 'yes' }).muted, true);
  assert.equal(normalisePreferences({ muted: true }).muted, true);
});

check('muting silences sound', () => {
  assert.equal(
    shouldPlaySound('payment_success', { muted: true, volume: 1 }),
    false,
  );
  assert.equal(
    shouldPlaySound('payment_success', { muted: false, volume: 0 }),
    false,
  );
  assert.equal(
    shouldPlaySound('payment_success', { muted: false, volume: 0.3 }),
    true,
  );
});

check('muting does not silence the message', () => {
  // The toast still renders; only the chime is suppressed. Someone who turned
  // the sounds off did not ask to stop being told a caller wants a person.
  assert.notEqual(motionClass('handoff_requested', false), '');
});

check('gain never reaches a level that hurts in headphones', () => {
  for (const event of NOTIFICATION_EVENTS) {
    const gain = toneGain(event, { muted: false, volume: 1 });
    assert.ok(gain > 0, `${event} is inaudible`);
    assert.ok(gain <= 0.22, `${event} is too loud at ${gain}`);
  }
});

check('gain follows the volume setting', () => {
  const loud = toneGain('error', { muted: false, volume: 1 });
  const quiet = toneGain('error', { muted: false, volume: 0.25 });
  assert.ok(quiet < loud);
  assert.equal(toneGain('error', { muted: false, volume: 0 }), 0);
});

check('an urgent event is louder than a routine one at the same volume', () => {
  const at = (event) => toneGain(event, { muted: false, volume: 0.5 });
  assert.ok(at('error') > at('call_connected'));
  assert.ok(at('handoff_requested') > at('credit_added'));
});

console.log('winningEvent');

check('two events at once produce one sound, not two', () => {
  // Playing both means hearing neither.
  assert.equal(winningEvent(['call_connected', 'error']), 'error');
  assert.equal(
    winningEvent(['credit_added', 'handoff_requested']),
    'handoff_requested',
  );
});

check('nothing to play returns nothing', () => {
  assert.equal(winningEvent([]), null);
  assert.equal(winningEvent(['nonsense']), null);
  assert.equal(winningEvent(undefined), null);
});

console.log('motionClass');

check('each event moves in its own way', () => {
  const classes = NOTIFICATION_EVENTS.map((event) => motionClass(event, false));
  assert.ok(new Set(classes).size > 4, 'events must be distinguishable');
  assert.match(motionClass('payment_success', false), /burst/);
  assert.match(motionClass('credit_low', false), /drain/);
  assert.match(motionClass('ringing', false), /pulse-ring/);
});

check('reduced motion keeps the notification and removes the movement', () => {
  // Not "no animation": the arrival is information, and a toast that appears
  // with no transition at all is easy to miss entirely.
  for (const event of NOTIFICATION_EVENTS) {
    const reduced = motionClass(event, true);
    assert.equal(reduced, 'vaani-notify--fade', event);
  }
});

console.log('newlyArrived');

check('the first poll is never an arrival', () => {
  // A queue that already had three callers in it when the screen opened is a
  // queue, not three new events.
  assert.equal(newlyArrived(null, ['a', 'b', 'c']), null);
});

check('only what is new counts', () => {
  assert.deepEqual(newlyArrived(new Set(['a']), ['a', 'b']), ['b']);
  assert.deepEqual(newlyArrived(new Set(['a', 'b']), ['a', 'b']), []);
});

check('something leaving the queue is not an arrival', () => {
  assert.deepEqual(newlyArrived(new Set(['a', 'b']), ['a']), []);
});

check('an id returning after it left counts again', () => {
  assert.deepEqual(newlyArrived(new Set(['a']), ['a', 'b']), ['b']);
  assert.deepEqual(newlyArrived(new Set(['b']), ['a']), ['a']);
});

check('empty and malformed input is survivable', () => {
  assert.deepEqual(newlyArrived(new Set(), []), []);
  assert.deepEqual(newlyArrived(new Set(), undefined), []);
  assert.deepEqual(newlyArrived(new Set(), ['', 'a']), ['a']);
});

console.log('creditAlert');

check('the first reading never warns', () => {
  // A low balance is not news the moment a screen opens.
  assert.equal(creditAlert(null, 3), null);
});

check('crossing the warning line warns once', () => {
  assert.equal(
    creditAlert(CREDIT_WARNING + 5, CREDIT_WARNING - 1),
    'credit_low',
  );
  // Still low on the next poll, and the poll after that: silent. A chime every
  // few seconds until somebody tops up teaches people to mute everything.
  assert.equal(creditAlert(CREDIT_WARNING - 1, CREDIT_WARNING - 2), null);
  assert.equal(creditAlert(20, 19), null);
});

check('it warns above the floor, not at it', () => {
  // Campaigns pause below CREDIT_FLOOR; a warning that fires there arrives
  // after the calls have already stopped.
  assert.ok(CREDIT_WARNING > CREDIT_FLOOR);
});

check('recovering re-arms the warning', () => {
  assert.equal(creditAlert(5, 500), 'credit_added');
  assert.equal(creditAlert(500, 10), 'credit_low');
});

check('a top-up is distinguished from a refunded call', () => {
  assert.equal(creditAlert(200, 201), null);
  assert.equal(creditAlert(200, 205), null);
  assert.equal(creditAlert(200, 400), 'credit_added');
});

check('an unchanged or unreadable balance says nothing', () => {
  assert.equal(creditAlert(100, 100), null);
  assert.equal(creditAlert(100, Number.NaN), null);
  assert.equal(creditAlert(Number.NaN, 5), null);
});

console.log('§3.2 acknowledgement and toast lifetime');

check('the three events §3.2 names must be acknowledged', () => {
  for (const event of ['payment_failed', 'transfer_failed', 'security_alert'])
    assert.equal(requiresAcknowledgement(event), true, event);
});

check('a generic error is not one of them', () => {
  // Most errors are a failed fetch that succeeds on retry. Demanding
  // acknowledgement for every one teaches people to dismiss without reading,
  // which is how the important ones get missed.
  assert.equal(requiresAcknowledgement('error'), false);
  assert.equal(requiresAcknowledgement('credit_low'), false);
});

check('a normal toast goes in about five seconds', () => {
  // §3.2 says "~4-6 seconds".
  assert.ok(TOAST_LIFETIME_MS >= 4000 && TOAST_LIFETIME_MS <= 6000);
  assert.equal(toastLifetime('call_connected'), TOAST_LIFETIME_MS);
  assert.equal(toastLifetime('credit_low'), TOAST_LIFETIME_MS);
});

check('an event needing acknowledgement never times out', () => {
  // It used to get nine seconds and then vanish: long enough to annoy, short
  // enough to miss, and wrong for exactly the events that matter.
  assert.equal(toastLifetime('payment_failed'), null);
  assert.equal(toastLifetime('transfer_failed'), null);
  assert.equal(toastLifetime('security_alert'), null);
});

check('an unknown event still gets a finite lifetime', () => {
  assert.equal(toastLifetime('nonsense'), TOAST_LIFETIME_MS);
});

console.log('dedupeKey');

check('the same happening produces the same key from anywhere', () => {
  // §3.2's "single event ID": two tabs, or a laptop and a phone, reporting one
  // real event must collapse to one row and one toast.
  assert.equal(
    dedupeKey({ event: 'payment_success', subject: 'VAI-2026-0007' }),
    dedupeKey({ event: 'payment_success', subject: 'VAI-2026-0007' }),
  );
});

check('different subjects stay different events', () => {
  assert.notEqual(
    dedupeKey({ event: 'handoff_requested', subject: 'h1' }),
    dedupeKey({ event: 'handoff_requested', subject: 'h2' }),
  );
});

check('the same subject under different events stays distinct', () => {
  assert.notEqual(
    dedupeKey({ event: 'transfer_accepted', subject: 'h1' }),
    dedupeKey({ event: 'transfer_failed', subject: 'h1' }),
  );
});

check('an event with no subject still dedupes across tabs', () => {
  // Nothing better is possible for a happening with no identity, and
  // second-granularity is still enough to stop two tabs double-toasting.
  const now = 1_788_000_000_000;
  assert.equal(
    dedupeKey({ event: 'call_connected', now }),
    dedupeKey({ event: 'call_connected', now: now + 400 }),
  );
  assert.notEqual(
    dedupeKey({ event: 'call_connected', now }),
    dedupeKey({ event: 'call_connected', now: now + 3000 }),
  );
});

check('a blank subject is treated as no subject', () => {
  const now = 1_788_000_000_000;
  assert.equal(
    dedupeKey({ event: 'error', subject: '   ', now }),
    dedupeKey({ event: 'error', subject: null, now }),
  );
});

console.log('inboxSummary');

const row = (over = {}) => ({
  id: 'n1',
  event: 'credit_low',
  title: 'Credits low',
  severity: 'warning',
  requiresAck: false,
  readAt: null,
  acknowledgedAt: null,
  createdAt: 't',
  ...over,
});

check('the dot is dark when there is nothing to see', () => {
  // It used to be a hardcoded span, lit whatever was happening — furniture
  // rather than information.
  assert.equal(inboxSummary([]).dot, 'none');
  assert.equal(inboxSummary([row({ readAt: 't' })]).dot, 'none');
});

check('unread lights it', () => {
  const summary = inboxSummary([row(), row({ id: 'n2', readAt: 't' })]);
  assert.equal(summary.unread, 1);
  assert.equal(summary.total, 2);
  assert.equal(summary.dot, 'unread');
});

check('something waiting on a person outranks merely unread', () => {
  const summary = inboxSummary([
    row(),
    row({ id: 'n2', event: 'payment_failed', requiresAck: true }),
  ]);
  assert.equal(summary.needsAcknowledgement, 1);
  assert.equal(summary.dot, 'urgent');
});

check('an acknowledged critical event stops being urgent', () => {
  const summary = inboxSummary([
    row({
      event: 'payment_failed',
      requiresAck: true,
      acknowledgedAt: 't',
      readAt: 't',
    }),
  ]);
  assert.equal(summary.needsAcknowledgement, 0);
  assert.equal(summary.dot, 'none');
});

check('a missing list is empty, not a throw', () => {
  assert.equal(inboxSummary(undefined).total, 0);
});

console.log(`\n${passed} assertions passed.`);
