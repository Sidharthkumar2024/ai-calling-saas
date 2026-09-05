'use client';

import { useCallback, useEffect, useState } from 'react';

import { WIDGET_MODES, type WidgetMode } from '@/lib/web-widget';

/**
 * The web voice widget's settings (§8).
 *
 * The screen is arranged around the fact that this is the only part of the
 * product reachable by strangers. The list of websites is not a field halfway
 * down a form — it is the thing that decides whether anybody on the internet
 * can spend this workspace's credits, so it sits at the top and a widget
 * cannot go live without it.
 *
 * Refusals from the last week are shown with their reasons. A widget that
 * quietly stopped answering is the thing people actually need to diagnose, and
 * "38 refused: origin_not_allowed" answers it in one line.
 */

type Widget = {
  id: string;
  publicKey: string;
  name: string;
  status: string;
  agentId: string | null;
  allowedOrigins: string[];
  modes: WidgetMode[];
  branding: {
    name: string;
    greeting: string;
    accent: string;
    logoUrl: string | null;
    position: 'bottom_right' | 'bottom_left';
  };
  dailyCap: number;
  hourlyCap: number;
  embedCode: string;
  activity: Array<{ outcome: string; reason: string | null; count: number }>;
};

const MODE_HELP: Record<WidgetMode, string> = {
  voice: 'Visitors talk to the agent in the browser. Costs credits per call.',
  text: 'A typed conversation with the same agent.',
  callback:
    'They leave a number and become a lead. Costs nothing, and it is the fallback whenever voice cannot start.',
};

export function CustomerWebWidget() {
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [draft, setDraft] = useState<Widget | null>(null);
  const [originText, setOriginText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/app/web-widget');
    if (!response.ok) return;
    const payload = (await response.json()) as {
      widgets: Widget[];
      agents: Array<{ id: string; name: string }>;
    };
    setWidgets(payload.widgets);
    setAgents(payload.agents);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function post(body: Record<string, unknown>) {
    const response = await fetch('/api/app/web-widget', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return {
      ok: response.ok,
      payload: (await response.json()) as Record<string, unknown>,
    };
  }

  function edit(widget: Widget) {
    setDraft(widget);
    setOriginText(widget.allowedOrigins.join('\n'));
    setNotice(null);
  }

  async function save(status: 'active' | 'paused') {
    if (!draft) return;
    setBusy(true);
    const { ok, payload } = await post({
      action: 'save',
      widgetId: draft.id,
      name: draft.name,
      agentId: draft.agentId,
      status,
      allowedOrigins: originText
        .split('\n')
        .map((entry) => entry.trim())
        .filter(Boolean),
      modes: draft.modes,
      branding: draft.branding,
      dailyCap: draft.dailyCap,
      hourlyCap: draft.hourlyCap,
    });
    setBusy(false);
    if (!ok) {
      setNotice(
        typeof payload.error === 'string' ? payload.error : 'Could not save.',
      );
      return;
    }
    setNotice(
      status === 'active'
        ? 'Live on the sites you listed.'
        : 'Saved and paused.',
    );
    await load();
    setDraft(null);
  }

  return (
    <div className="space-y-6">
      <section className="portal-panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Website voice assistant</h2>
            <p className="mt-1 max-w-2xl text-[10px] text-ink-muted">
              One script tag on your site and visitors talk to the same agent
              that answers your calls — same knowledge, same tools, same CRM. It
              cannot answer anybody until you list the websites it may run on.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await post({ action: 'create', name: 'Website assistant' });
              setBusy(false);
              await load();
            }}
            className="portal-primary rounded-lg px-4 py-2 text-[11px] disabled:opacity-60"
          >
            New widget
          </button>
        </div>
        {notice ? (
          <p className="mt-3 text-[10px] text-ink-muted">{notice}</p>
        ) : null}
      </section>

      {widgets.map((widget) => (
        <section key={widget.id} className="portal-panel p-5">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[11px] font-medium">{widget.name}</span>
            <span
              className={`text-[9px] ${widget.status === 'active' ? 'text-success-text' : 'text-ink-muted'}`}
            >
              {widget.status === 'active' ? 'live' : 'paused'}
            </span>
            <button
              type="button"
              onClick={() => edit(widget)}
              className="ml-auto rounded-lg border border-hairline px-3 py-1.5 text-[10px]"
            >
              {draft?.id === widget.id ? 'Editing' : 'Settings'}
            </button>
          </div>

          <p className="mt-2 text-[10px] text-ink-muted">
            {widget.allowedOrigins.length === 0
              ? 'No websites listed, so it cannot run anywhere yet.'
              : `Runs on: ${widget.allowedOrigins.join(', ')}`}
          </p>

          <label className="mt-3 block">
            <span className="text-[10px] font-medium">
              Paste this into your site
            </span>
            <textarea
              readOnly
              rows={2}
              value={widget.embedCode}
              onFocus={(event) => event.currentTarget.select()}
              className="mt-1 w-full rounded-lg border border-hairline bg-surface-muted px-3 py-2 font-mono text-[10px]"
            />
          </label>

          {widget.activity.length > 0 ? (
            <div className="mt-3 border-t border-hairline pt-3">
              <p className="text-[10px] font-medium">Last 7 days</p>
              <ul className="mt-1 space-y-0.5">
                {widget.activity.map((entry) => (
                  <li
                    key={`${entry.outcome}-${entry.reason ?? ''}`}
                    className={`text-[10px] ${entry.outcome === 'refused' ? 'text-warning-text' : 'text-ink-muted'}`}
                  >
                    {entry.count} × {entry.outcome.replaceAll('_', ' ')}
                    {/* The reason is the whole value of this line. */}
                    {entry.reason
                      ? ` — ${entry.reason.replaceAll('_', ' ')}`
                      : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {draft?.id === widget.id ? (
            <div className="mt-4 space-y-3 border-t border-hairline pt-4">
              <label className="block">
                <span className="text-[10px] font-medium">
                  Websites this may run on
                </span>
                <span className="mt-0.5 block text-[9px] text-ink-muted">
                  One per line. `example.com` means https only; `*.example.com`
                  covers one level of subdomain and not the bare domain.
                  Anything not listed is refused.
                </span>
                <textarea
                  rows={3}
                  value={originText}
                  onChange={(event) => setOriginText(event.target.value)}
                  placeholder={'https://yourcompany.com\n*.yourcompany.com'}
                  className="mt-1 w-full rounded-lg border border-hairline bg-surface px-3 py-2 font-mono text-[10px]"
                />
              </label>

              <div>
                <span className="text-[10px] font-medium">
                  What visitors can do
                </span>
                <div className="mt-1 space-y-1">
                  {WIDGET_MODES.map((mode) => (
                    <label
                      key={mode}
                      aria-label={mode}
                      className="flex items-start gap-2"
                    >
                      <input
                        type="checkbox"
                        checked={draft.modes.includes(mode)}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            modes: event.target.checked
                              ? [...draft.modes, mode]
                              : draft.modes.filter((entry) => entry !== mode),
                          })
                        }
                        className="mt-0.5"
                      />
                      <span className="text-[10px]">
                        <span className="font-medium capitalize">{mode}</span>
                        <span className="text-ink-muted">
                          {' '}
                          — {MODE_HELP[mode]}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[10px] font-medium">Agent</span>
                  <select
                    value={draft.agentId ?? ''}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        agentId: event.target.value || null,
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[11px]"
                  >
                    <option value="">First active agent</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[10px] font-medium">Button text</span>
                  <input
                    value={draft.branding.greeting}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        branding: {
                          ...draft.branding,
                          greeting: event.target.value,
                        },
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[11px]"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-medium">Accent colour</span>
                  <input
                    value={draft.branding.accent}
                    placeholder="#2563EB"
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        branding: {
                          ...draft.branding,
                          accent: event.target.value,
                        },
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[11px]"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-medium">
                    Logo URL (https)
                  </span>
                  <input
                    value={draft.branding.logoUrl ?? ''}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        branding: {
                          ...draft.branding,
                          logoUrl: event.target.value,
                        },
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[11px]"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-medium">
                    Calls per hour
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={draft.hourlyCap}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        hourlyCap: Number(event.target.value),
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[11px]"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-medium">Calls per day</span>
                  <input
                    type="number"
                    min={1}
                    value={draft.dailyCap}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        dailyCap: Number(event.target.value),
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[11px]"
                  />
                </label>
              </div>
              <p className="text-[9px] text-ink-muted">
                {/* Said plainly, because the number is a spending limit. */}
                Past either cap the widget stops starting calls and offers the
                callback form instead. Visitors are never told which limit they
                hit.
              </p>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save('active')}
                  className="portal-primary rounded-lg px-4 py-2 text-[11px] disabled:opacity-60"
                >
                  Save and go live
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save('paused')}
                  className="rounded-lg border border-hairline px-4 py-2 text-[11px] disabled:opacity-60"
                >
                  Save as paused
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await post({ action: 'delete', widgetId: draft.id });
                    setDraft(null);
                    await load();
                  }}
                  className="ml-auto rounded-lg border border-hairline px-3 py-2 text-[10px]"
                >
                  Delete
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}
