'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  RefreshCw,
  Radio,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProviderLogo } from '@/components/provider-logo';
import {
  STATUS_LABEL,
  PUBLIC_COMPONENTS,
  INCIDENT_STATES,
  type StatusUpdate,
} from '@/lib/public-status';
import type { HealthState } from '@/lib/service-health';

type Report = {
  overall: HealthState;
  measuredAt: string;
  windowMinutes: number;
  components: Array<{
    id: string;
    label: string;
    group: string;
    state: HealthState;
  }>;
  updates: StatusUpdate[];
};
const tone: Record<HealthState, string> = {
  healthy: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  unhealthy: 'bg-red-500',
  unknown: 'bg-slate-400',
  maintenance: 'bg-blue-500',
};
const dateLabel = (v: string) =>
  new Date(v).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
export function ServiceStatus({ admin = false }: { admin?: boolean }) {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('all');
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/status', { cache: 'no-store' });
      const body = (await response.json()) as Report & { error?: string };
      if (!response.ok)
        throw new Error(body.error || 'Unable to refresh status.');
      setReport(body);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to refresh status.');
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 60000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);
  const groups = [...new Set(report?.components.map((c) => c.group) ?? [])];
  const updates = (report?.updates ?? []).filter(
    (u) =>
      tab === 'all' ||
      (tab === 'maintenance'
        ? ['scheduled', 'maintenance'].includes(u.state)
        : u.state === 'resolved'),
  );
  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[.18em] text-ink-muted">
            Call Vani reliability
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            API & service status
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-muted">
            Platform availability, voice providers and incident updates in one
            place.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}{' '}
            Refresh
          </Button>
          {admin && (
            <a
              href="/status"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-hairline px-3 text-sm"
            >
              Public page <ArrowUpRight className="size-4" />
            </a>
          )}
        </div>
      </header>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          {error}{' '}
          {report
            ? 'Showing the last successful measurement; it may be out of date.'
            : ''}
        </p>
      )}
      <section className="rounded-3xl border border-hairline bg-surface p-6 sm:p-8">
        <div className="flex items-center gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-surface-muted">
            <Activity className="size-6 text-primary" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`size-2.5 rounded-full ${tone[report?.overall ?? 'unknown']}`}
              />
              <h2 className="text-xl font-semibold">
                {report ? STATUS_LABEL[report.overall] : 'Loading measurements'}
              </h2>
            </div>
            <p className="mt-2 text-xs text-ink-muted">
              {report
                ? `Last checked ${dateLabel(report.measuredAt)} · refreshes every minute`
                : 'Checking available telemetry…'}
            </p>
          </div>
        </div>
        <p className="mt-5 border-t border-hairline pt-4 text-xs leading-5 text-ink-muted">
          Status reflects Call Vani observations over the last{' '}
          {report?.windowMinutes ?? 60} minutes. “Not measured” means there is
          insufficient traffic or the provider has not been configured.
          Historical uptime is shown only when monitoring data is available.
        </p>
      </section>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        {groups.map((group) => (
          <section
            key={group}
            className="overflow-hidden rounded-2xl border border-hairline bg-surface"
          >
            <h2 className="border-b border-hairline bg-surface-muted/50 px-5 py-4 text-sm font-semibold">
              {group}
            </h2>
            <div className="divide-y divide-hairline">
              {report!.components
                .filter((c) => c.group === group)
                .map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                  >
                    <span className="flex items-center gap-3 text-sm">
                      {group === 'Platform' ? (
                        <Activity className="size-5 text-ink-muted" />
                      ) : (
                        <ProviderLogo provider={c.id} size={22} />
                      )}{' '}
                      {c.label}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-ink-muted">
                      <span
                        className={`size-2 rounded-full ${tone[c.state]}`}
                      />
                      {STATUS_LABEL[c.state]}
                    </span>
                  </div>
                ))}
            </div>
          </section>
        ))}
      </div>
      {admin && <StatusEditor updates={report?.updates ?? []} onSaved={load} />}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">
            Incident & maintenance history
          </h2>
          <div
            className="flex flex-wrap gap-1 rounded-xl bg-surface-muted p-1"
            aria-label="Status history filters"
          >
            {[
              ['all', 'All updates'],
              ['maintenance', 'Maintenance'],
              ['resolved', 'Resolved'],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                aria-pressed={tab === id}
                className={`rounded-lg px-3 py-2 text-xs ${tab === id ? 'bg-surface shadow-sm' : 'text-ink-muted'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {updates.length ? (
            updates.map((u) => (
              <article
                key={u.id}
                className="rounded-2xl border border-hairline bg-surface p-5"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-full bg-surface-muted px-3 py-1 text-xs capitalize">
                    {u.state}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {u.component === 'platform'
                      ? 'Platform'
                      : PUBLIC_COMPONENTS.find((c) => c.id === u.component)
                          ?.label}
                  </span>
                  <span className="text-xs text-ink-muted">
                    Updated{' '}
                    {dateLabel(
                      u.updated_at.endsWith('Z')
                        ? u.updated_at
                        : u.updated_at.replace(' ', 'T') + 'Z',
                    )}
                  </span>
                </div>
                <h3 className="mt-3 font-semibold">{u.title}</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-muted">
                  {u.message}
                </p>
                {['scheduled', 'maintenance'].includes(u.state) && (
                  <p className="mt-3 flex items-center gap-2 text-xs text-ink-muted">
                    <Clock3 className="size-4" />
                    {dateLabel(u.starts_at)}
                    {u.ends_at ? ` – ${dateLabel(u.ends_at)}` : ''}
                  </p>
                )}
              </article>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-hairline p-8 text-center">
              <CheckCircle2 className="mx-auto size-7 text-ink-muted" />
              <p className="mt-3 text-sm text-ink-muted">
                No published updates in this view.
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                This is a publication history, not a guarantee of uninterrupted
                service.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function StatusEditor({
  updates,
  onSaved,
}: {
  updates: StatusUpdate[];
  onSaved: () => Promise<void>;
}) {
  const blank = {
    id: '',
    component: 'platform',
    title: '',
    message: '',
    state: 'investigating',
    startsAt: '',
    endsAt: '',
  };
  const [draft, setDraft] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const localDate = (v: string) => {
    const d = new Date(v);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  };
  async function save() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await fetch('/api/admin/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...draft,
          id: draft.id || undefined,
          startsAt: draft.startsAt
            ? new Date(draft.startsAt).toISOString()
            : undefined,
          endsAt: draft.endsAt
            ? new Date(draft.endsAt).toISOString()
            : undefined,
        }),
      });
      const b = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(b.error || 'Could not publish update.');
      setDraft(blank);
      setNotice('Status update published.');
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not publish update.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="space-y-4 rounded-2xl border border-hairline bg-surface p-5 sm:p-6"
    >
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <Radio className="size-5 text-primary" /> Publish a status update
        </h2>
        <p className="mt-2 text-xs text-ink-muted">
          Updates are public. Provider-management permission is required to
          publish.
        </p>
      </div>
      <label className="block space-y-2 text-sm">
        <span>Update an existing incident</span>
        <select
          className="h-10 w-full rounded-lg border border-hairline bg-surface px-3"
          value={draft.id}
          onChange={(e) => {
            const u = updates.find((x) => x.id === e.target.value);
            setDraft(
              u
                ? {
                    id: u.id,
                    component: u.component,
                    title: u.title,
                    message: u.message,
                    state: u.state,
                    startsAt: localDate(u.starts_at),
                    endsAt: u.ends_at ? localDate(u.ends_at) : '',
                  }
                : blank,
            );
          }}
        >
          <option value="">New update</option>
          {updates.map((u) => (
            <option key={u.id} value={u.id}>
              {u.title} · {u.state}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span>Component</span>
          <select
            className="h-10 w-full rounded-lg border border-hairline bg-surface px-3"
            value={draft.component}
            onChange={(e) => setDraft({ ...draft, component: e.target.value })}
          >
            <option value="platform">Entire platform</option>
            {PUBLIC_COMPONENTS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span>Status</span>
          <select
            className="h-10 w-full rounded-lg border border-hairline bg-surface px-3"
            value={draft.state}
            onChange={(e) => setDraft({ ...draft, state: e.target.value })}
          >
            {INCIDENT_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="space-y-2 text-sm">
        <label htmlFor="status-update-title">Title</label>
        <Input
          id="status-update-title"
          required
          maxLength={160}
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="Describe the customer impact"
        />
      </div>
      <label className="block space-y-2 text-sm">
        <span>Public update</span>
        <textarea
          required
          maxLength={2000}
          rows={3}
          className="w-full rounded-lg border border-hairline bg-surface p-3"
          value={draft.message}
          onChange={(e) => setDraft({ ...draft, message: e.target.value })}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 text-sm">
          <label htmlFor="status-update-starts-at">
            Starts at (local time; blank = now)
          </label>
          <Input
            id="status-update-starts-at"
            type="datetime-local"
            value={draft.startsAt}
            onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })}
          />
        </div>
        <div className="space-y-2 text-sm">
          <label htmlFor="status-update-ends-at">
            Ends at (required for maintenance)
          </label>
          <Input
            id="status-update-ends-at"
            type="datetime-local"
            required={['scheduled', 'maintenance'].includes(draft.state)}
            value={draft.endsAt}
            onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })}
          />
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      )}
      {notice && (
        <output className="text-sm text-success-text">
          {notice}
        </output>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <Radio />} Publish update
      </Button>
    </form>
  );
}
