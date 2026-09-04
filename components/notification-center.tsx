'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  DEFAULT_SOUND_PREFERENCES,
  NOTIFICATION_SPECS,
  isNotificationEvent,
  motionClass,
  CREDIT_FLOOR,
  creditAlert,
  normalisePreferences,
  shouldPlaySound,
  toneGain,
  type NotificationEvent,
  type SoundPreferences,
} from '@/lib/notifications';

/**
 * The notification surface (§33).
 *
 * The product had none. `components/ui/toast.tsx` existed with no importer in
 * the repository, so nothing that happened during a call — a caller asking for
 * a person, a payment landing, credits running out — reached the operator
 * unless they were already looking at the right screen and refreshed it.
 *
 * Sounds are synthesised through Web Audio rather than loaded as files: nothing
 * to ship, nothing to cache, and no notification that has to finish a network
 * request before it can tell you something.
 */

const STORAGE_KEY = 'vaani.sound-preferences';

export type NotifyInput = {
  event: NotificationEvent;
  title?: string;
  detail?: string;
};

type NotificationContextValue = {
  notify: (input: NotifyInput) => void;
  preferences: SoundPreferences;
  setPreferences: (next: SoundPreferences) => void;
  /**
   * False until a user gesture has unlocked audio. Browsers refuse to start an
   * AudioContext without one, so a "sound on" switch that has never been able
   * to make a sound would otherwise be a lie the settings panel tells.
   */
  soundReady: boolean;
};

const NotificationContext = createContext<NotificationContextValue | null>(
  null,
);

type ActiveToast = NotifyInput & { id: number; motion: string };

export function NotificationCenter({
  children,
}: {
  children: React.ReactNode;
}) {
  const [preferences, setPreferencesState] = useState<SoundPreferences>(
    DEFAULT_SOUND_PREFERENCES,
  );
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [soundReady, setSoundReady] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);
  const nextId = useRef(1);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored)
          setPreferencesState(normalisePreferences(JSON.parse(stored)));
      } catch {
        // A private window, cleared site data, or a value written by an older
        // version. The defaults are correct in all three cases.
      }
      const query = window.matchMedia('(prefers-reduced-motion: reduce)');
      setReducedMotion(query.matches);
      const onChange = () => setReducedMotion(query.matches);
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Audio cannot start without a gesture, so the first one anywhere unlocks it.
  useEffect(() => {
    const unlock = () => {
      try {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctor) return;
        audioRef.current ??= new Ctor();
        void audioRef.current.resume();
        setSoundReady(true);
      } catch {
        // Audio is unavailable in this context. Toasts still work; the settings
        // panel says so rather than showing a switch that does nothing.
      }
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const setPreferences = useCallback((next: SoundPreferences) => {
    const clean = normalisePreferences(next);
    setPreferencesState(clean);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    } catch {
      // Preference is still applied for this session.
    }
  }, []);

  const play = useCallback(
    (event: NotificationEvent) => {
      const context = audioRef.current;
      if (!context || !shouldPlaySound(event, preferences)) return;
      const gain = toneGain(event, preferences);
      const spec = NOTIFICATION_SPECS[event];
      for (const tone of spec.tone) {
        const start = context.currentTime + tone.delay / 1000;
        const end = start + tone.duration / 1000;
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        oscillator.type = tone.wave;
        oscillator.frequency.value = tone.frequency;
        // Ramped rather than switched on: a square-edged start on a sine wave
        // is an audible click, which is the part people find unpleasant.
        envelope.gain.setValueAtTime(0.0001, start);
        envelope.gain.exponentialRampToValueAtTime(gain, start + 0.012);
        envelope.gain.exponentialRampToValueAtTime(0.0001, end);
        oscillator.connect(envelope).connect(context.destination);
        oscillator.start(start);
        oscillator.stop(end + 0.02);
      }
    },
    [preferences],
  );

  const notify = useCallback(
    (input: NotifyInput) => {
      if (!isNotificationEvent(input.event)) return;
      const id = nextId.current++;
      setToasts((current) => [
        ...current.slice(-3),
        {
          ...input,
          id,
          motion: motionClass(input.event, reducedMotion),
        },
      ]);
      play(input.event);
      window.setTimeout(
        () => setToasts((current) => current.filter((t) => t.id !== id)),
        NOTIFICATION_SPECS[input.event].priority >= 85 ? 9000 : 5000,
      );
    },
    [play, reducedMotion],
  );

  const value = useMemo(
    () => ({ notify, preferences, setPreferences, soundReady }),
    [notify, preferences, setPreferences, soundReady],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
      {/* <output> rather than a div with role="status": same semantics, and
          it is the element screen readers are actually tuned for. */}
      <output
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col gap-2 sm:right-4 sm:left-auto sm:w-80"
        aria-live="polite"
      >
        {toasts.map((toast) => {
          const spec = NOTIFICATION_SPECS[toast.event];
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto rounded-xl border px-3.5 py-2.5 shadow-sm ${toast.motion} ${
                spec.severity === 'success'
                  ? 'border-emerald-400/40 bg-emerald-50 text-success-text'
                  : spec.severity === 'warning'
                    ? 'border-amber-400/40 bg-amber-50 text-warning-text'
                    : spec.severity === 'error'
                      ? 'border-red-400/40 bg-red-50 text-danger-text'
                      : 'border-hairline bg-surface text-ink'
              }`}
            >
              <p className="text-[11px] font-semibold">
                {toast.title || spec.title}
              </p>
              {toast.detail ? (
                <p className="mt-0.5 text-[10px] opacity-80">{toast.detail}</p>
              ) : null}
            </div>
          );
        })}
      </output>
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  // A no-op rather than a throw: a component rendered outside the provider
  // should lose its chime, not fail to render.
  return (
    context ?? {
      notify: () => {},
      preferences: DEFAULT_SOUND_PREFERENCES,
      setPreferences: () => {},
      soundReady: false,
    }
  );
}

/** Mute and volume, for the settings screen. */
export function SoundSettings() {
  const { preferences, setPreferences, soundReady, notify } =
    useNotifications();
  return (
    <div className="rounded-xl border border-hairline bg-surface-muted px-3 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[11px]">
          <input
            type="checkbox"
            checked={!preferences.muted}
            onChange={(event) =>
              setPreferences({ ...preferences, muted: !event.target.checked })
            }
          />
          Notification sound
        </label>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(preferences.volume * 100)}
          disabled={preferences.muted}
          aria-label="Notification volume"
          onChange={(event) =>
            setPreferences({
              ...preferences,
              volume: Number(event.target.value) / 100,
            })
          }
          className="h-1 flex-1 min-w-32 accent-[var(--primary)] disabled:opacity-40"
        />
        <button
          type="button"
          className="rounded-lg border border-hairline bg-surface px-2.5 py-1 text-[10px] text-ink-body hover:text-ink"
          onClick={() =>
            notify({
              event: 'payment_success',
              title: 'This is how it sounds',
            })
          }
        >
          Test
        </button>
      </div>
      <p className="mt-2 text-[10px] text-ink-muted">
        {preferences.muted
          ? 'Sound is off. Notifications still appear on screen — muting the chime does not mute the message.'
          : soundReady
            ? 'Plays a short chime for calls, transfers, payments and credit warnings.'
            : 'Sound starts after your first click on the page — browsers require it.'}
      </p>
    </div>
  );
}

/**
 * Watches the wallet and speaks up when it crosses a threshold (§33).
 *
 * A separate component rather than an effect in the portal, because the portal
 * computes the balance outside this provider — and because a balance watcher
 * that re-renders the whole portal on every poll is worse than the problem.
 */
export function CreditWatch({ credits }: { credits: number }) {
  const { notify } = useNotifications();
  const previous = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const event = creditAlert(previous.current, credits);
      previous.current = credits;
      if (!event) return;
      notify({
        event,
        detail:
          event === 'credit_low'
            ? `${Math.round(credits)} credits left. Campaigns pause below ${CREDIT_FLOOR}.`
            : `Balance is now ${Math.round(credits)} credits.`,
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [credits, notify]);

  return null;
}
