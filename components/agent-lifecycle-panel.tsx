'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  allowedTransitions,
  describeRollback,
  isAgentState,
  LIVE_STATE,
  STATE_LABEL,
  type AgentState,
} from '@/lib/agent-lifecycle';

/**
 * The agent lifecycle, on screen (Part 2.1).
 *
 * States, versions, rollback and clone existed only in the API — reachable by
 * curl and by nothing a person could click, which is a feature that has not
 * been delivered.
 *
 * Two things this screen refuses to do.
 *
 * It does not grey out "Go live" and leave somebody guessing. When an agent is
 * not ready it lists what is missing, because "a system prompt with something
 * in it — 2 characters is not instructions" is a fixable sentence and a
 * disabled button is not.
 *
 * It does not offer a rollback as a bare version number. Each one says which
 * fields it would move and whether the agent is currently answering calls,
 * because restoring version three is a new edit, not an undo.
 */

type Version = {
  version: number;
  note: string | null;
  createdAt: string;
  changesFromCurrent: string[];
};

type Readiness = { ready: boolean; missing: string[]; warnings: string[] };

const STATE_TONE: Record<string, string> = {
  active: 'text-success-text',
  ready: 'text-primary',
  testing: 'text-warning-text',
  paused: 'text-warning-text',
  draft: 'text-ink-muted',
  archived: 'text-ink-muted',
};

export function AgentLifecyclePanel({
  agentId,
  status,
  onChanged,
}: {
  agentId: string;
  status: string;
  onChanged: () => Promise<void> | void;
}) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!agentId) return;
    const response = await fetch('/api/app/agents', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'versions', agentId }),
    });
    if (!response.ok) return;
    const payload = (await response.json()) as {
      versions: Version[];
      readiness: Readiness;
    };
    setVersions(payload.versions ?? []);
    setReadiness(payload.readiness ?? null);
  }, [agentId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function act(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setNotice(null);
    try {
      const response = await fetch('/api/app/agents', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, agentId }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        reason?: string;
        error?: string;
        changed?: string[];
        name?: string;
        deleted?: boolean;
      };
      if (payload.ok === false || payload.error) {
        setNotice(payload.reason ?? payload.error ?? 'That was refused.');
        return;
      }
      if (payload.changed)
        setNotice(
          payload.changed.length > 0
            ? `Restored. Changed: ${payload.changed.join(', ')}.`
            : 'Restored — nothing differed.',
        );
      else if (payload.deleted) setNotice('Deleted.');
      else if (payload.name)
        setNotice(`Copied as “${payload.name}”, as a draft.`);
      else setNotice('Done.');
      await load();
      await onChanged();
    } finally {
      setBusy('');
    }
  }

  const state: AgentState = isAgentState(status) ? status : 'draft';
  const transitions = allowedTransitions(state);

  return (
    <section className="rounded-2xl border border-hairline bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold">Lifecycle</span>
        <span
          className={`text-[11px] ${STATE_TONE[state] ?? 'text-ink-muted'}`}
        >
          {STATE_LABEL[state]}
        </span>

        <div className="ml-auto flex flex-wrap gap-1.5">
          {transitions.map((next) => (
            <button
              key={next}
              type="button"
              disabled={busy === next}
              title={
                next === LIVE_STATE && readiness && !readiness.ready
                  ? `Still needs ${readiness.missing.join(', ')}`
                  : undefined
              }
              onClick={() =>
                void act({ action: 'set_state', status: next }, next)
              }
              className={`rounded-full border px-2.5 py-1 text-[11px] disabled:opacity-50 ${
                next === LIVE_STATE
                  ? 'border-primary text-primary'
                  : 'border-hairline'
              }`}
            >
              {next === LIVE_STATE ? 'Go live' : STATE_LABEL[next]}
            </button>
          ))}
          <button
            type="button"
            disabled={busy === 'clone'}
            onClick={() => void act({ action: 'clone' }, 'clone')}
            className="rounded-full border border-hairline px-2.5 py-1 text-[11px] disabled:opacity-50"
          >
            Duplicate
          </button>
          {/* Offered always, and refused in words when something points at the
              agent — rather than a greyed-out button nobody can explain. An
              agent created by mistake and never used is just clutter. */}
          <button
            type="button"
            disabled={busy === 'delete'}
            onClick={() => {
              if (
                window.confirm(
                  'Delete this agent? Only an agent nothing points at can be deleted — one that has taken calls is archived instead.',
                )
              )
                void act({ action: 'delete' }, 'delete');
            }}
            className="rounded-full border border-hairline px-2.5 py-1 text-[11px] text-danger-text disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Not a greyed-out button: the missing pieces, by name. */}
      {readiness && !readiness.ready ? (
        <p className="mt-2 text-[11px] text-warning-text">
          Not ready to go live — still needs {readiness.missing.join(', ')}.
        </p>
      ) : null}
      {readiness?.warnings.map((warning) => (
        <p key={warning} className="mt-1 text-[11px] text-ink-muted">
          {warning}
        </p>
      ))}
      {notice ? (
        <output className="mt-2 block text-[11px] text-ink-body">
          {notice}
        </output>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="mt-3 text-[11px] text-ink-muted underline decoration-dotted underline-offset-2"
      >
        {open
          ? 'Hide history'
          : `History (${versions.length} saved ${versions.length === 1 ? 'version' : 'versions'})`}
      </button>

      {open ? (
        <div className="mt-2 space-y-1.5">
          {versions.length === 0 ? (
            <p className="text-[11px] text-ink-muted">
              Nothing saved yet. A version is kept every time you save this
              agent, so the configuration you are replacing is always
              recoverable.
            </p>
          ) : null}
          {versions.map((version) => (
            <div
              key={version.version}
              className="rounded-lg border border-hairline bg-surface-muted px-2.5 py-2"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[11px] font-medium">
                  v{version.version}
                </span>
                <span className="text-[11px] text-ink-muted">
                  {version.note} · {version.createdAt}
                </span>
                <button
                  type="button"
                  disabled={
                    busy === `restore-${version.version}` ||
                    version.changesFromCurrent.length === 0
                  }
                  onClick={() =>
                    void act(
                      { action: 'restore', version: version.version },
                      `restore-${version.version}`,
                    )
                  }
                  className="ml-auto rounded-full border border-hairline px-2.5 py-1 text-[11px] disabled:opacity-45"
                >
                  Restore
                </button>
              </div>
              {/* What it would actually move, and whether the agent is live. */}
              <p className="mt-1 text-[11px] text-ink-muted">
                {describeRollback({
                  version: version.version,
                  changed: version.changesFromCurrent,
                  isLive: state === LIVE_STATE,
                })}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
