'use client';
import { useEffect, useRef } from 'react';
import { useNotifications } from '@/components/notification-center';
import { activityChanges, type ActivitySnapshot } from '@/lib/call-feedback';

/** Metadata-only polling. Never starts a call or fetches recordings. */
export function CallActivityWatch() {
  const { notify } = useNotifications();
  const notifyRef = useRef(notify);
  useEffect(() => { notifyRef.current = notify; }, [notify]);
  useEffect(() => {
    let previous: ActivitySnapshot | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      try {
        if (document.visibilityState === 'visible') {
          const response = await fetch('/api/app/queues?view=events', { cache: 'no-store', signal: controller.signal });
          if (response.status === 401 || response.status === 403) return;
          if (response.ok) {
            const snapshot = await response.json() as ActivitySnapshot;
            if (!stopped && Array.isArray(snapshot.calls) && Array.isArray(snapshot.handoffs)) {
              for (const event of activityChanges(previous, snapshot)) notifyRef.current({ ...event, scope: 'workspace' });
              previous = snapshot;
            }
          }
        }
      } catch { /* Keep the last successful snapshot across transient errors. */ }
      if (!stopped) timer = setTimeout(poll, 5000);
    };
    timer = setTimeout(poll, 0);
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, []);
  return null;
}
