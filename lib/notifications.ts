/**
 * Notification events, sound and motion (§33).
 *
 * §33 asks for notification sound with mute and volume, animations for ringing,
 * handoff, transfer-accepted, payment-success and credit events, a distinct
 * "thinking" voice state, and motion that respects the reader.
 *
 * None of it existed. A toast primitive sat in `components/ui/toast.tsx` with
 * no importer anywhere in the repository, so the product had no way to tell an
 * operator that anything had happened; the `thinking` voice state fell through
 * to the same class as `idle`, so an agent deliberating looked like an agent
 * doing nothing; and `prefers-reduced-motion` was honoured by the two custom
 * animations while every Tailwind `animate-spin` and `animate-pulse` in the
 * product kept moving.
 *
 * Pure: the event vocabulary, the tones and the preference rules, so what a
 * workspace hears is decided here and not inside a component.
 */

export const NOTIFICATION_EVENTS = [
  'ringing',
  'call_connected',
  'handoff_requested',
  'transfer_accepted',
  'payment_success',
  'credit_low',
  'credit_added',
  'error',
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export function isNotificationEvent(
  value: unknown,
): value is NotificationEvent {
  return (
    typeof value === 'string' &&
    (NOTIFICATION_EVENTS as readonly string[]).includes(value)
  );
}

/**
 * One step of a synthesised tone.
 *
 * Tones are generated rather than shipped as files: there is nothing to load,
 * nothing to cache, nothing to license, and a notification that has to wait for
 * a network fetch is not a notification. `frequency` is in hertz, `duration` and
 * `delay` in milliseconds.
 */
export type Tone = {
  frequency: number;
  duration: number;
  delay: number;
  /** Sine reads as a chime; triangle carries better through a noisy room. */
  wave: 'sine' | 'triangle';
};

export type NotificationSpec = {
  event: NotificationEvent;
  /** What the toast says by default; callers may override with specifics. */
  title: string;
  tone: Tone[];
  /** Higher wins when two events land at once. */
  priority: number;
  /** The animation class the toast and its icon carry. */
  motion:
    | 'pulse-ring'
    | 'rise'
    | 'settle'
    | 'burst'
    | 'drain'
    | 'shake'
    | 'none';
  severity: 'info' | 'success' | 'warning' | 'error';
  /** Repeats until dismissed or the state ends — only for a live phone. */
  sustained?: boolean;
};

const CHIME = (frequency: number, delay: number, duration = 140): Tone => ({
  frequency,
  duration,
  delay,
  wave: 'sine',
});

/**
 * The event vocabulary.
 *
 * Pitch carries meaning deliberately: rising intervals for things that went
 * well, falling for things that need attention. Somebody hearing these across a
 * working day should be able to tell a payment from a problem without looking.
 */
export const NOTIFICATION_SPECS: Record<NotificationEvent, NotificationSpec> = {
  ringing: {
    event: 'ringing',
    title: 'Calling…',
    // Two even tones at a telephone-like interval, repeated while it rings.
    tone: [CHIME(440, 0, 320), CHIME(480, 400, 320)],
    priority: 40,
    motion: 'pulse-ring',
    severity: 'info',
    sustained: true,
  },
  call_connected: {
    event: 'call_connected',
    title: 'Call connected',
    tone: [CHIME(660, 0), CHIME(880, 110)],
    priority: 50,
    motion: 'rise',
    severity: 'success',
  },
  handoff_requested: {
    event: 'handoff_requested',
    title: 'A caller asked for a person',
    // Insistent without being alarming: someone is waiting on a live call.
    tone: [
      { frequency: 620, duration: 130, delay: 0, wave: 'triangle' },
      { frequency: 620, duration: 130, delay: 200, wave: 'triangle' },
      { frequency: 740, duration: 190, delay: 400, wave: 'triangle' },
    ],
    priority: 90,
    motion: 'shake',
    severity: 'warning',
  },
  transfer_accepted: {
    event: 'transfer_accepted',
    title: 'Transfer accepted',
    tone: [CHIME(700, 0), CHIME(900, 120), CHIME(1100, 240)],
    priority: 70,
    motion: 'settle',
    severity: 'success',
  },
  payment_success: {
    event: 'payment_success',
    title: 'Payment received',
    tone: [CHIME(784, 0), CHIME(988, 110), CHIME(1319, 220, 260)],
    priority: 80,
    motion: 'burst',
    severity: 'success',
  },
  credit_low: {
    event: 'credit_low',
    title: 'Credits are running low',
    // Falling, because it is the one thing here that stops calls happening.
    tone: [CHIME(560, 0, 200), CHIME(420, 220, 320)],
    priority: 85,
    motion: 'drain',
    severity: 'warning',
  },
  credit_added: {
    event: 'credit_added',
    title: 'Credits added',
    tone: [CHIME(600, 0), CHIME(800, 120)],
    priority: 60,
    motion: 'rise',
    severity: 'success',
  },
  error: {
    event: 'error',
    title: 'Something failed',
    tone: [
      { frequency: 380, duration: 200, delay: 0, wave: 'triangle' },
      { frequency: 300, duration: 300, delay: 220, wave: 'triangle' },
    ],
    priority: 95,
    motion: 'shake',
    severity: 'error',
  },
};

export type SoundPreferences = {
  muted: boolean;
  /** 0..1. */
  volume: number;
};

export const DEFAULT_SOUND_PREFERENCES: SoundPreferences = {
  muted: false,
  volume: 0.5,
};

/**
 * Reads stored preferences without trusting them.
 *
 * `localStorage` returns whatever was last written, including from an older
 * version of this code or a hand-edited value, so a volume of `"loud"` or `12`
 * has to become something a gain node will accept rather than silence or a
 * sound loud enough to hurt.
 */
export function normalisePreferences(raw: unknown): SoundPreferences {
  const source = (raw ?? {}) as Partial<SoundPreferences>;
  const volume = Number(source.volume);
  return {
    muted: source.muted === true,
    volume: Number.isFinite(volume)
      ? Math.min(1, Math.max(0, volume))
      : DEFAULT_SOUND_PREFERENCES.volume,
  };
}

/**
 * Whether this event should make a sound right now.
 *
 * A muted workspace still sees the toast. Muting the sound is not muting the
 * information — an operator who turned the chimes off did not ask to stop being
 * told that a caller is waiting for a person.
 */
export function shouldPlaySound(
  event: NotificationEvent,
  preferences: SoundPreferences,
): boolean {
  if (!isNotificationEvent(event)) return false;
  if (preferences.muted) return false;
  return preferences.volume > 0;
}

/**
 * Per-tone gain, from the workspace volume and the event's own weight.
 *
 * Scaled well below 1 because these are synthesised sine waves played straight
 * into a gain node with no mastering: at unity they are genuinely painful in
 * headphones, which is how a notification sound ends up muted forever.
 */
export function toneGain(
  event: NotificationEvent,
  preferences: SoundPreferences,
): number {
  const spec = NOTIFICATION_SPECS[event];
  if (!spec) return 0;
  const weight = spec.priority >= 85 ? 1 : spec.priority >= 70 ? 0.85 : 0.7;
  return Math.min(0.22, preferences.volume * 0.22 * weight);
}

/**
 * Picks between two events arriving together.
 *
 * Playing both means hearing neither, and two overlapping tone sequences read
 * as a fault rather than as two events.
 */
export function winningEvent(
  events: NotificationEvent[],
): NotificationEvent | null {
  const valid = (events ?? []).filter(isNotificationEvent);
  if (!valid.length) return null;
  return valid.reduce((best, candidate) =>
    NOTIFICATION_SPECS[candidate].priority > NOTIFICATION_SPECS[best].priority
      ? candidate
      : best,
  );
}

/**
 * The animation class for an event, honouring a reduced-motion reader.
 *
 * Not simply "no animation": the animation is how a toast distinguishes a
 * payment from a failure at a glance, and removing it removes information. What
 * reduced motion removes is *movement* — the shake, the burst, the travelling
 * ring — leaving a fade that still marks the arrival.
 */
export function motionClass(
  event: NotificationEvent,
  reducedMotion: boolean,
): string {
  const spec = NOTIFICATION_SPECS[event];
  if (!spec || spec.motion === 'none') return '';
  if (reducedMotion) return 'vaani-notify--fade';
  return `vaani-notify--${spec.motion}`;
}

/**
 * Where campaigns stop.
 *
 * `dialCampaign` pauses a campaign outright below 10 credits
 * (`lib/campaign-dialer.ts`). A warning that fires at that same number arrives
 * after the calls have already stopped, which is a report rather than a
 * warning, so the alert sits above the floor.
 */
export const CREDIT_FLOOR = 10;
export const CREDIT_WARNING = 50;

/**
 * Whether a change in wallet balance is worth telling somebody about.
 *
 * Edge-triggered on purpose. The portal repolls the balance continuously; a
 * rule of "warn while low" would chime every few seconds until somebody topped
 * up, and the reliable response to that is to mute all notifications for ever.
 * So it fires on the crossing, and again only if the balance recovered in
 * between.
 */
export function creditAlert(
  previous: number | null,
  current: number,
): NotificationEvent | null {
  const now = Number(current);
  if (!Number.isFinite(now)) return null;
  // Nothing to compare against on the first read: the balance being low is not
  // news when the screen has only just opened.
  if (previous === null || !Number.isFinite(Number(previous))) return null;
  const before = Number(previous);
  if (before === now) return null;
  if (before >= CREDIT_WARNING && now < CREDIT_WARNING) return 'credit_low';
  // A rise big enough to be a top-up rather than a refund of one call.
  if (now > before + CREDIT_FLOOR) return 'credit_added';
  return null;
}

/**
 * What appeared since the last poll.
 *
 * Every live surface in the portal repolls, so "there is a handoff waiting"
 * is true on every tick and would chime for ever. What is worth a sound is the
 * *arrival*. `null` on the first read for the same reason `creditAlert` is
 * silent there: a queue that already had three items in it when the screen
 * opened is a queue, not three new events.
 */
export function newlyArrived(
  previous: ReadonlySet<string> | null,
  current: string[],
): string[] | null {
  if (previous === null) return null;
  return (current ?? []).filter((id) => id && !previous.has(id));
}

/** Total length of an event's tone sequence, for scheduling and for tests. */
export function toneDuration(event: NotificationEvent): number {
  const spec = NOTIFICATION_SPECS[event];
  if (!spec) return 0;
  return spec.tone.reduce(
    (longest, tone) => Math.max(longest, tone.delay + tone.duration),
    0,
  );
}
