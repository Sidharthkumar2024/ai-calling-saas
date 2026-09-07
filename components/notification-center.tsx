'use client';

import { Bell, PhoneCall, ArrowRightLeft, Coins } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  inboxSummary,
  normalisePreferences,
  requiresAcknowledgement,
  shouldPlaySound,
  toastLifetime,
  toneGain,
  type InboxRow,
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

const STORAGE_KEY = 'vaani.sound-preferences.v2';

export type NotifyInput = {
  event: NotificationEvent;
  title?: string;
  detail?: string;
  /**
   * What the event is about — a call id, invoice number, handoff id.
   *
   * This becomes §3.2's "single event ID": the same happening reported from two
   * tabs produces the same key, the store keeps one row, and only the reporter
   * that created it shows a toast.
   */
  subject?: string;
  /** 'workspace' when everybody should see it, otherwise just this person. */
  scope?: 'workspace' | 'user';
};

type NotificationContextValue = {
  notify: (input: NotifyInput) => void;
  /** The stored inbox behind the bell. */
  inbox: InboxRow[];
  summary: ReturnType<typeof inboxSummary>;
  refreshInbox: () => Promise<void>;
  markRead: (notificationId?: string) => Promise<void>;
  acknowledge: (notificationId: string) => Promise<void>;
  preferences: SoundPreferences;
  setPreferences: (next: SoundPreferences) => void;
  /**
   * False until a user gesture has unlocked audio. Browsers refuse to start an
   * AudioContext without one, so a "sound on" switch that has never been able
   * to make a sound would otherwise be a lie the settings panel tells.
   */
  soundReady: boolean;
  previewSound: (event: NotificationEvent) => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(
  null,
);

type ActiveToast = NotifyInput & {
  id: number;
  motion: string;
  /** Set when the event was stored, so it can be acknowledged from the toast. */
  notificationId: string | null;
};

export function NotificationCenter({
  children,
  section,
}: {
  children: React.ReactNode;
  /** The visible portal section; changing it clears non-critical toasts. */
  section?: string;
}) {
  const [preferences, setPreferencesState] = useState<SoundPreferences>(
    DEFAULT_SOUND_PREFERENCES,
  );
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  const [inbox, setInbox] = useState<InboxRow[]>([]);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [soundReady, setSoundReady] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);
  const nextId = useRef(1);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReducedMotion(query.matches);
    query.addEventListener('change', onChange);
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored)
          setPreferencesState(normalisePreferences(JSON.parse(stored)));
      } catch {
        // A private window, cleared site data, or a value written by an older
        // version. The defaults are correct in all three cases.
      }
      setReducedMotion(query.matches);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      query.removeEventListener('change', onChange);
    };
  }, []);

  /**
   * Makes sure there is a *running* AudioContext, and returns it.
   *
   * The unlock listener creates one on the first click and resumes it once,
   * which was treated as the end of the story. It is not: a browser suspends a
   * context again when the tab goes to the background, and Chrome suspends one
   * that has been silent for a while. A suspended context's `currentTime` is
   * frozen, so `oscillator.start(currentTime + delay)` schedules a tone for a
   * moment that never arrives — no sound, no error, nothing in the console.
   * That is exactly what a dead Test button looks like.
   */
  const readyContext = useCallback(async () => {
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      audioRef.current ??= new Ctor();
      const context = audioRef.current;
      if (context.state === 'suspended') await context.resume();
      const running = context.state === 'running';
      setSoundReady(running);
      return running ? context : null;
    } catch {
      return null;
    }
  }, []);

  // Audio cannot start without a gesture, so the first one anywhere unlocks it.
  // Not `once`: a context can be suspended again later, and the next gesture
  // should bring it back rather than leaving the rest of the session silent.
  useEffect(() => {
    const unlock = () => void readyContext();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [readyContext]);

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
      if (!shouldPlaySound(event, preferences)) return;
      void readyContext().then((context) => {
        if (!context) return;
        const gain = toneGain(event, preferences);
        const spec = NOTIFICATION_SPECS[event];
        // Read after the resume resolves: on a context that was suspended,
        // the value from before is a clock that had stopped.
        const now = context.currentTime;
        for (const tone of spec.tone) {
          const start = now + tone.delay / 1000;
          const end = start + tone.duration / 1000;
          const oscillator = context.createOscillator();
          const envelope = context.createGain();
          oscillator.type = tone.wave;
          oscillator.frequency.value = tone.frequency;
          // Ramped rather than switched on: a square-edged start on a sine
          // wave is an audible click, which is the part people find
          // unpleasant.
          envelope.gain.setValueAtTime(0.0001, start);
          envelope.gain.exponentialRampToValueAtTime(gain, start + 0.012);
          envelope.gain.exponentialRampToValueAtTime(0.0001, end);
          oscillator.connect(envelope).connect(context.destination);
          oscillator.start(start);
          oscillator.stop(end + 0.02);
        }
      });
    },
    [preferences, readyContext],
  );

  const refreshInbox = useCallback(async () => {
    try {
      const response = await fetch('/api/app/notifications', {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const body = (await response.json()) as { notifications?: InboxRow[] };
      setInbox(body.notifications ?? []);
    } catch {
      // The bell falling behind must never break the page it sits on.
    }
  }, []);

  /**
   * §19: "Notifications do not duplicate or remain stale across tabs."
   *
   * Read state is server-owned and every tab polls, so a notification read in
   * one tab already disappears from the others — but only at the next poll,
   * which is up to 45 seconds of a tab showing something the person has
   * already dealt with. This closes that window: a tab that changes read state
   * tells the others, and they refetch at once.
   *
   * Deliberately a nudge, not the data itself. Nothing is copied between tabs,
   * so the server stays the only source of truth and two tabs cannot disagree
   * about what is unread.
   */
  const channelRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('vaani.notifications');
    channelRef.current = channel;
    channel.onmessage = () => void refreshInbox();
    return () => {
      channelRef.current = null;
      channel.close();
    };
  }, [refreshInbox]);

  const announceChange = useCallback(() => {
    try {
      channelRef.current?.postMessage('changed');
    } catch {
      /* an older browser without BroadcastChannel simply waits for the poll */
    }
  }, []);

  const show = useCallback(
    (input: NotifyInput, notificationId: string | null) => {
      const id = nextId.current++;
      setToasts((current) => [
        ...current.slice(-3),
        {
          ...input,
          id,
          notificationId,
          motion: motionClass(input.event, reducedMotion),
        },
      ]);
      play(input.event);
      // §3.2: a normal toast goes after about five seconds; a payment failure,
      // a failed transfer or a security event stays until somebody
      // acknowledges it. Previously everything timed out — the important ones
      // after nine seconds, which is long enough to annoy and short enough to
      // miss.
      const lifetime = toastLifetime(input.event);
      if (lifetime !== null)
        window.setTimeout(
          () => setToasts((current) => current.filter((t) => t.id !== id)),
          lifetime,
        );
    },
    [play, reducedMotion],
  );

  const notify = useCallback(
    (input: NotifyInput) => {
      if (!isNotificationEvent(input.event)) return;
      void (async () => {
        try {
          const response = await fetch('/api/app/notifications', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'record', ...input }),
          });
          const body = (await response.json()) as {
            created?: boolean;
            id?: string;
          };
          // Only the reporter that actually created the row toasts. A second
          // tab — or the same account on a phone — gets created:false and
          // stays quiet, which is §3.2's duplicate rule decided by the unique
          // index rather than by tabs trying to agree.
          if (body.created) show(input, body.id ?? null);
          await refreshInbox();
        } catch {
          // Offline, or the workspace session has gone. Still tell the person
          // what happened: a toast with no stored copy beats silence.
          show(input, null);
        }
      })();
    },
    [refreshInbox, show],
  );

  const markRead = useCallback(
    async (notificationId?: string) => {
      try {
        await fetch('/api/app/notifications', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'mark_read', notificationId }),
        });
        await refreshInbox();
        announceChange();
      } catch {
        /* read state is server-owned; a failed write simply stays unread */
      }
    },
    [refreshInbox, announceChange],
  );

  const acknowledge = useCallback(
    async (notificationId: string) => {
      setToasts((current) =>
        current.filter((toast) => toast.notificationId !== notificationId),
      );
      try {
        await fetch('/api/app/notifications', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'acknowledge', notificationId }),
        });
        await refreshInbox();
        // An acknowledgement matters most across tabs: a payment failure the
        // person has already dealt with must stop shouting everywhere at once.
        announceChange();
      } catch {
        /* the row stays unacknowledged, which is the safe direction */
      }
    },
    [refreshInbox, announceChange],
  );

  const summary = useMemo(() => inboxSummary(inbox), [inbox]);

  /**
   * §3.2: "Do not keep stale floating toast visible indefinitely when moving
   * to another app section."
   *
   * A toast is about the screen a person was on. Carrying it into Billing is
   * noise, and it was previously carried until its timer ran out wherever they
   * had navigated to. Events that must be acknowledged deliberately survive —
   * a failed payment does not stop mattering because somebody changed tab.
   */
  useEffect(() => {
    if (!section) return;
    // Deferred a tick for the same reason as the loads above: setting state
    // synchronously in an effect body cascades renders.
    const timer = window.setTimeout(
      () =>
        setToasts((current) =>
          current.filter((toast) => requiresAcknowledgement(toast.event)),
        ),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [section]);

  const value = useMemo(
    () => ({
      notify,
      inbox,
      summary,
      refreshInbox,
      markRead,
      acknowledge,
      preferences,
      setPreferences,
      soundReady,
      previewSound: play,
    }),
    [
      notify,
      inbox,
      summary,
      refreshInbox,
      markRead,
      acknowledge,
      preferences,
      setPreferences,
      soundReady,
      play,
    ],
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
              <div className="mb-2 flex items-center gap-2" aria-hidden="true">
                {toast.event === 'ringing' ||
                toast.event === 'call_connected' ? (
                  <PhoneCall className="size-5 vani-call-pulse" />
                ) : toast.event.startsWith('transfer') ||
                  toast.event === 'handoff_requested' ? (
                  <ArrowRightLeft className="size-5 vani-call-pulse" />
                ) : toast.event === 'payment_success' ||
                  toast.event === 'credit_added' ? (
                  <Coins className="size-5" />
                ) : (
                  <Bell className="size-4" />
                )}
              </div>
              <p className="text-sm font-semibold">
                {toast.title || spec.title}
              </p>
              {toast.detail ? (
                <p className="mt-1 text-sm opacity-80">{toast.detail}</p>
              ) : null}
              {/* §3.2: these do not time out, so there has to be a way to
                  clear them — and acknowledging records who saw it. */}
              {requiresAcknowledgement(toast.event) ? (
                <button
                  type="button"
                  onClick={() =>
                    toast.notificationId
                      ? void acknowledge(toast.notificationId)
                      : setToasts((current) =>
                          current.filter((t) => t.id !== toast.id),
                        )
                  }
                  className="mt-2 rounded-lg border border-current px-2 py-1 text-[11px] font-semibold"
                >
                  Acknowledge
                </button>
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
  const fallback: NotificationContextValue = {
    notify: () => {},
    inbox: [],
    summary: inboxSummary([]),
    refreshInbox: async () => {},
    markRead: async () => {},
    acknowledge: async () => {},
    preferences: DEFAULT_SOUND_PREFERENCES,
    setPreferences: () => {},
    soundReady: false,
    previewSound: () => {},
  };
  return context ?? fallback;
}

/** Mute and volume, for the settings screen. */
export function SoundSettings() {
  const { preferences, setPreferences, soundReady, previewSound } =
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
          disabled={preferences.muted}
          className="rounded-lg border border-hairline bg-surface px-2.5 py-1 text-[11px] text-ink-body hover:text-ink"
          onClick={() => previewSound('payment_success')}
        >
          Test
        </button>
      </div>
      <p className="mt-2 text-[11px] text-ink-muted">
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
export function CreditWatch({ credits }: { credits: number | null }) {
  const { notify } = useNotifications();
  const previous = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (credits === null) return;
      const event = creditAlert(previous.current, credits);
      previous.current = credits;
      if (!event || event === 'credit_added') return;
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

/**
 * The bell and its inbox (§3.2).
 *
 * Replaces a dropdown that read "Workspace systems are healthy" whatever was
 * happening, under a dot that was lit whatever was happening, above a button
 * labelled "Open notification center" that navigated to the alerts screen.
 * None of those three things told anybody anything.
 */
export function NotificationBell() {
  const { inbox, summary, refreshInbox, markRead, acknowledge } =
    useNotifications();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshInbox(), 0);
    // Polled because this worker has no socket to push down. Slow on purpose:
    // the bell is not a live feed, and every event that matters right now has
    // already arrived as a toast.
    const poll = window.setInterval(() => void refreshInbox(), 45_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
    };
  }, [refreshInbox]);

  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="relative"
        aria-label={
          summary.unread > 0
            ? `Notifications, ${summary.unread} unread`
            : 'Notifications'
        }
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Bell />
        {/* Lit only when there is something to see. */}
        {summary.dot !== 'none' ? (
          <span
            className={`absolute right-1 top-1 size-1.5 rounded-full ${
              summary.dot === 'urgent' ? 'bg-red-500' : 'bg-primary'
            }`}
          />
        ) : null}
      </Button>
      {open ? (
        <div className="absolute right-0 top-11 z-50 w-80 rounded-xl border border-hairline bg-surface/98 p-3 shadow-2xl backdrop-blur-xl">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-semibold">Notifications</p>
            {summary.unread > 0 ? (
              <button
                type="button"
                onClick={() => void markRead()}
                className="text-[11px] text-ink-body underline-offset-2 hover:underline"
              >
                Mark all read
              </button>
            ) : null}
          </div>
          <div className="mt-3 max-h-80 space-y-1.5 overflow-y-auto">
            {inbox.length === 0 ? (
              <p className="text-[11px] text-ink-muted">
                Nothing yet. Calls, transfers, payments and credit warnings
                appear here.
              </p>
            ) : null}
            {inbox.map((row) => {
              const needsAck = row.requiresAck && !row.acknowledgedAt;
              return (
                <div
                  key={row.id}
                  className={`rounded-lg border px-2.5 py-2 ${
                    needsAck
                      ? 'border-red-400/40 bg-red-50'
                      : row.readAt
                        ? 'border-hairline bg-surface-muted'
                        : 'border-hairline bg-surface-strong'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!row.readAt ? (
                      <span
                        aria-label="Unread"
                        className="mt-1 size-1.5 shrink-0 rounded-full bg-primary"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium">{row.title}</p>
                      {row.detail ? (
                        <p className="mt-0.5 text-[11px] text-ink-muted">
                          {row.detail}
                        </p>
                      ) : null}
                      <p className="mt-1 text-[11px] text-ink-muted">
                        {row.createdAt}
                        {row.acknowledgedAt ? ' · acknowledged' : ''}
                      </p>
                    </div>
                    {needsAck ? (
                      <button
                        type="button"
                        onClick={() => void acknowledge(row.id)}
                        className="shrink-0 rounded-lg border border-danger-text px-2 py-0.5 text-[11px] font-semibold text-danger-text"
                      >
                        Acknowledge
                      </button>
                    ) : !row.readAt ? (
                      <button
                        type="button"
                        onClick={() => void markRead(row.id)}
                        className="shrink-0 text-[11px] text-ink-muted underline-offset-2 hover:underline"
                      >
                        Read
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
