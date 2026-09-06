'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, PhoneIncoming, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useT } from '@/components/locale-provider';

/**
 * Agent Desk and Supervisor wallboard (§8-9).
 *
 * The runtime has no Durable Objects, no queue consumers and no WebSocket
 * binding, so "live" here means a short polling interval, not a socket. The
 * interval is visible in the UI rather than implied.
 */

type Row = Record<string, unknown>;
type QueueData = {
  queues: Row[];
  agents: Row[];
  rules: Row[];
  waiting: Row[];
  activeHandoffs: Row[];
  recentHandoffs: Row[];
  me: Row | null;
  strategies: string[];
  dispositions: string[];
  wallboard: Record<string, number>;
};

const POLL_MS = 5000;
function str(value: unknown, fallback = '') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  )
    return value.toString();
  return fallback;
}

async function act(payload: Record<string, unknown>) {
  const response = await fetch('/api/app/queues', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(str(body.error, 'Action failed.'));
  return body;
}

export function CustomerAgentDesk({ view }: { view: 'desk' | 'wallboard' }) {
  const t = useT();
  const [data, setData] = useState<QueueData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const loadedOnce = useRef(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/app/queues');
      const body = (await response.json()) as QueueData & { error?: string };
      if (!response.ok) {
        setError(str(body.error, 'Could not load queues.'));
        return;
      }
      setData(body);
      setError(null);
      loadedOnce.current = true;
    } catch {
      setError('Could not load queues.');
    }
  }, []);

  useEffect(() => {
    // Deferred so the first fetch does not setState inside the effect body.
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [load]);

  async function run(label: string, payload: Record<string, unknown>) {
    setBusy(label);
    setNotice(null);
    try {
      await act(payload);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  }

  if (!data && !error)
    return (
      <div className="flex items-center gap-2 text-[11px] text-ink-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading queues…
      </div>
    );
  if (error && !data)
    return <p className="text-[11px] text-danger-text">{error}</p>;
  const view_ = data!;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-ink-muted">
            {view === 'desk'
              ? t('screen.agent_desk.eyebrow')
              : t('screen.wallboard.eyebrow')}
          </p>
          <h1 className="mt-1 text-lg font-semibold">
            {view === 'desk'
              ? t('screen.agent_desk.title')
              : t('screen.wallboard.title')}
          </h1>
          <p className="mt-1 text-[11px] text-ink-muted">
            {view === 'desk'
              ? t('screen.agent_desk.description')
              : t('screen.wallboard.description')}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-ink-muted">
          <RefreshCw className="h-3 w-3" />
          {t('desk.refreshInterval', { seconds: POLL_MS / 1000 })}
        </div>
      </div>
      {notice ? (
        <p className="rounded-lg border border-amber-400/25 bg-amber-400/8 px-3 py-2 text-[11px] text-warning-text">
          {notice}
        </p>
      ) : null}

      {view === 'desk' ? (
        <AgentDeskView data={view_} run={run} busy={busy} />
      ) : (
        <WallboardView data={view_} run={run} busy={busy} />
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface-muted p-3.5">
      <p className="text-[11px] uppercase tracking-wider text-ink-muted">
        {label}
      </p>
      <p className="mt-1.5 text-lg font-semibold">{value}</p>
    </div>
  );
}

function AgentDeskView({
  data,
  run,
  busy,
}: {
  data: QueueData;
  run: (label: string, payload: Record<string, unknown>) => Promise<void>;
  busy: string | null;
}) {
  const t = useT();
  const me = data.me;
  const myId = str(me?.id);
  const [wrapUp, setWrapUp] = useState<{
    handoffId: string;
    disposition: string;
    notes: string;
  } | null>(null);

  if (!me)
    return (
      <div className="rounded-2xl border border-hairline bg-surface-muted p-6">
        <p className="text-sm font-medium">{t('desk.notOnBench')}</p>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
          {t('desk.notOnBenchHint')}
        </p>
      </div>
    );

  const mine = data.activeHandoffs.filter(
    (row) => str(row.assigned_agent_id) === myId,
  );
  const availability = str(me.availability, 'offline');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-hairline bg-surface-muted p-4">
        <div className="mr-auto">
          <p className="text-[11px] font-medium">{str(me.name)}</p>
          <p className="mt-0.5 text-[11px] text-ink-muted">
            {str(me.active_calls, '0')} of {str(me.max_concurrent_calls, '1')}{' '}
            {t('desk.slotsInUse')}
          </p>
        </div>
        {(['online', 'break', 'offline'] as const).map((state) => (
          <button
            key={state}
            type="button"
            disabled={busy === `presence-${state}`}
            onClick={() =>
              void run(`presence-${state}`, {
                action: 'set_presence',
                supportAgentId: myId,
                availability: state,
              })
            }
            className={`rounded-lg border px-3 py-1.5 text-[11px] capitalize transition ${
              availability === state
                ? 'border-emerald-400/40 bg-emerald-400/12 text-success-text'
                : 'border-hairline bg-surface-strong text-ink-body hover:text-ink'
            }`}
          >
            {state}
          </button>
        ))}
      </div>

      <section>
        <h2 className="text-[11px] font-semibold text-ink">
          Waiting in your queues ({data.waiting.length})
        </h2>
        <div className="mt-3 space-y-2.5">
          {data.waiting.length === 0 ? (
            <p className="text-[11px] text-ink-muted">
              {t('desk.nothingWaiting')}
            </p>
          ) : null}
          {data.waiting.map((row) => {
            const waited = Number(row.waiting_seconds ?? 0);
            const sla = Number(row.sla_seconds ?? 60);
            return (
              <article
                key={str(row.id)}
                className={`rounded-xl border p-4 ${
                  waited > sla
                    ? 'border-rose-400/30 bg-rose-400/[0.06]'
                    : 'border-hairline bg-surface-muted'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
                  <PhoneIncoming className="h-3 w-3" />
                  <span className="rounded-md bg-surface-strong px-2 py-0.5 uppercase tracking-wide">
                    {str(row.queue_slug, 'unrouted')}
                  </span>
                  <span>{str(row.reason).replaceAll('_', ' ')}</span>
                  <span className={waited > sla ? 'text-danger-text' : ''}>
                    waiting {waited}s
                    {waited > sla ? ` · SLA ${sla}s breached` : ''}
                  </span>
                </div>
                {str(row.ai_summary) ? (
                  <p className="mt-2 text-[12px] leading-relaxed text-ink">
                    {str(row.ai_summary)}
                  </p>
                ) : (
                  <p className="mt-2 text-[11px] text-ink-muted">
                    {t('desk.noSummary')}
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  <Button
                    className="portal-primary"
                    disabled={
                      busy === `accept-${str(row.id)}` ||
                      availability !== 'online'
                    }
                    onClick={() =>
                      void run(`accept-${str(row.id)}`, {
                        action: 'accept_handoff',
                        handoffId: str(row.id),
                        supportAgentId: myId,
                      })
                    }
                  >
                    {t('desk.accept')}
                  </Button>
                  {availability !== 'online' ? (
                    <span className="self-center text-[11px] text-ink-muted">
                      {t('desk.goOnlineToAccept')}
                    </span>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="text-[11px] font-semibold text-ink">
          Your active conversations ({mine.length})
        </h2>
        <div className="mt-3 space-y-2.5">
          {mine.length === 0 ? (
            <p className="text-[11px] text-ink-muted">{t('desk.noActive')}</p>
          ) : null}
          {mine.map((row) => (
            <article
              key={str(row.id)}
              className="rounded-xl border border-hairline bg-surface-muted p-4"
            >
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
                <span className="rounded-md bg-surface-strong px-2 py-0.5 uppercase tracking-wide">
                  {str(row.queue_slug, 'unrouted')}
                </span>
                <span>{str(row.status)}</span>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-ink">
                {str(row.ai_summary, 'No AI summary was attached.')}
              </p>
              <CopilotCard handoffId={str(row.id)} />
              {wrapUp?.handoffId === str(row.id) ? (
                <div className="mt-3 space-y-2.5">
                  <select
                    value={wrapUp.disposition}
                    onChange={(event) =>
                      setWrapUp({ ...wrapUp, disposition: event.target.value })
                    }
                  >
                    <option value="">{t('desk.chooseDisposition')}</option>
                    {data.dispositions.map((item) => (
                      <option key={item} value={item}>
                        {item.replaceAll('_', ' ')}
                      </option>
                    ))}
                  </select>
                  <textarea
                    rows={3}
                    value={wrapUp.notes}
                    placeholder={t('desk.notesPlaceholder')}
                    onChange={(event) =>
                      setWrapUp({ ...wrapUp, notes: event.target.value })
                    }
                    className="w-full rounded-lg border border-hairline bg-surface-strong px-3 py-2 text-[11px]"
                  />
                  <div className="flex gap-2">
                    <Button
                      className="portal-primary"
                      disabled={
                        !wrapUp.disposition || busy === `wrap-${str(row.id)}`
                      }
                      onClick={async () => {
                        await run(`wrap-${str(row.id)}`, {
                          action: 'wrap_up',
                          handoffId: str(row.id),
                          disposition: wrapUp.disposition,
                          notes: wrapUp.notes,
                        });
                        setWrapUp(null);
                      }}
                    >
                      {t('desk.saveWrapUp')}
                    </Button>
                    <Button onClick={() => setWrapUp(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex gap-2">
                  <Button
                    onClick={() =>
                      setWrapUp({
                        handoffId: str(row.id),
                        disposition: '',
                        notes: '',
                      })
                    }
                  >
                    {t('desk.wrapUp')}
                  </Button>
                  <Button
                    disabled={busy === `reject-${str(row.id)}`}
                    onClick={() =>
                      void run(`reject-${str(row.id)}`, {
                        action: 'reject_handoff',
                        handoffId: str(row.id),
                      })
                    }
                  >
                    {t('desk.returnToQueue')}
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function WallboardView({
  data,
  run,
  busy,
}: {
  data: QueueData;
  run: (label: string, payload: Record<string, unknown>) => Promise<void>;
  busy: string | null;
}) {
  const t = useT();
  const board = data.wallboard ?? {};
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Tile label="Waiting" value={Number(board.waiting ?? 0)} />
        <Tile label="SLA breaching" value={Number(board.slaBreaching ?? 0)} />
        <Tile
          label="Longest wait"
          value={`${Number(board.longestWaitSeconds ?? 0)}s`}
        />
        <Tile label="With humans" value={Number(board.humanActive ?? 0)} />
        <Tile label="Agents online" value={Number(board.agentsOnline ?? 0)} />
        <Tile label="Free capacity" value={Number(board.capacityFree ?? 0)} />
      </div>

      <section className="overflow-hidden rounded-2xl border border-hairline bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="border-b border-hairline bg-surface-muted text-[11px] uppercase tracking-wider text-ink-muted">
              <tr>
                {[
                  'Queue',
                  'Strategy',
                  'Skill',
                  'Members',
                  'Online',
                  'Waiting',
                  'SLA',
                  'Overflow',
                ].map((item) => (
                  <th key={item} className="px-4 py-3 font-medium">
                    {item}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/7">
              {data.queues.map((queue) => (
                <tr key={str(queue.id)}>
                  <td className="px-4 py-3.5">
                    <p className="font-medium">{str(queue.name)}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-ink-muted">
                      {str(queue.slug)}
                    </p>
                  </td>
                  <td className="px-4 py-3.5 text-ink-body">
                    {str(queue.strategy).replaceAll('_', ' ')}
                  </td>
                  <td className="px-4 py-3.5 text-ink-body">
                    {str(queue.required_skill, '—')}
                  </td>
                  <td className="px-4 py-3.5">{str(queue.member_count)}</td>
                  <td className="px-4 py-3.5">
                    <span
                      className={
                        Number(queue.online_count ?? 0) > 0
                          ? 'text-success-text'
                          : 'text-danger-text'
                      }
                    >
                      {str(queue.online_count)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">{str(queue.waiting_count)}</td>
                  <td className="px-4 py-3.5 text-ink-body">
                    {str(queue.sla_seconds)}s
                  </td>
                  <td className="px-4 py-3.5 text-ink-body">
                    {str(queue.overflow_action).replaceAll('_', ' ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <QueueEditor
        queues={data.queues}
        strategies={data.strategies}
        run={run}
        busy={busy}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-hairline bg-surface-muted p-5">
          <h2 className="text-[11px] font-semibold text-ink">
            {t('desk.supportBench')}
          </h2>
          <div className="mt-3 space-y-2">
            {data.agents.length === 0 ? (
              <p className="text-[11px] text-ink-muted">
                {t('desk.noSupportAgents')}
              </p>
            ) : null}
            {data.agents.map((agent) => (
              <div
                key={str(agent.id)}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-surface-muted px-3 py-2.5"
              >
                <div className="mr-auto">
                  <p className="text-[11px] font-medium">{str(agent.name)}</p>
                  <p className="mt-0.5 text-[11px] text-ink-muted">
                    {str(agent.role).replaceAll('_', ' ')} ·{' '}
                    {str(agent.active_calls)}/{str(agent.max_concurrent_calls)}{' '}
                    slots
                  </p>
                </div>
                {(['online', 'break', 'offline'] as const).map((state) => (
                  <button
                    key={state}
                    type="button"
                    disabled={busy === `${str(agent.id)}-${state}`}
                    onClick={() =>
                      void run(`${str(agent.id)}-${state}`, {
                        action: 'set_presence',
                        supportAgentId: str(agent.id),
                        availability: state,
                      })
                    }
                    className={`rounded-md border px-2 py-1 text-[11px] capitalize transition ${
                      str(agent.availability) === state
                        ? 'border-emerald-400/40 bg-emerald-400/12 text-success-text'
                        : 'border-hairline text-ink-muted hover:text-ink'
                    }`}
                  >
                    {state}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-hairline bg-surface-muted p-5">
          <h2 className="text-[11px] font-semibold text-ink">
            {t('desk.routingRules')}
          </h2>
          <p className="mt-1 text-[11px] text-ink-muted">
            {t('desk.routingRulesHint')}
          </p>
          <RuleEditor queues={data.queues} run={run} busy={busy} />
          <div className="mt-3 space-y-2">
            {data.rules.length === 0 ? (
              <p className="text-[11px] text-ink-muted">
                No routing rules, so handoffs use the queue named by the caller
                only.
              </p>
            ) : null}
            {data.rules.map((rule) => (
              <div
                key={str(rule.id)}
                className="flex items-center gap-2 rounded-xl border border-hairline bg-surface-muted px-3 py-2.5 text-[11px]"
              >
                <span className="font-mono text-[11px] text-ink-muted">
                  {str(rule.priority)}
                </span>
                <span
                  className={
                    str(rule.status) === 'archived'
                      ? 'text-ink-muted line-through'
                      : 'text-ink'
                  }
                >
                  {str(rule.match_type)} = {str(rule.match_value)}
                </span>
                <span className="ml-auto rounded-md bg-surface-strong px-2 py-0.5 text-[11px] uppercase tracking-wide text-ink-body">
                  {str(rule.queue_slug, 'missing queue')}
                </span>
                <button
                  type="button"
                  disabled={busy === 'rule'}
                  onClick={() =>
                    void run('rule', {
                      action:
                        str(rule.status) === 'archived'
                          ? 'restore_rule'
                          : 'archive_rule',
                      ruleId: str(rule.id),
                    })
                  }
                  className="text-[11px] text-ink-muted hover:text-ink"
                >
                  {str(rule.status) === 'archived' ? 'Restore' : 'Archive'}
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-hairline bg-surface-muted p-5">
        <h2 className="text-[11px] font-semibold text-ink">
          {t('desk.recentlyWrapped')}
        </h2>
        <div className="mt-3 space-y-2">
          {data.recentHandoffs.length === 0 ? (
            <p className="text-[11px] text-ink-muted">
              {t('desk.noneWrapped')}
            </p>
          ) : null}
          {data.recentHandoffs.map((row) => (
            <div
              key={str(row.id)}
              className="rounded-xl border border-hairline bg-surface-muted px-3 py-2.5"
            >
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
                <span className="rounded-md bg-surface-strong px-2 py-0.5 uppercase tracking-wide">
                  {str(row.disposition, 'no disposition').replaceAll('_', ' ')}
                </span>
                <span>{str(row.agent_name, 'unassigned')}</span>
                <span>{str(row.queue_slug, '—')}</span>
              </div>
              {str(row.disposition_notes) ? (
                <p className="mt-1.5 text-[11px] text-ink-body">
                  {str(row.disposition_notes)}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

type CopilotPayload = {
  goal: string;
  facts: string[];
  suggestions: string[];
  risks: string[];
  nextAction: string;
  turnCount: number;
  model: string | null;
  cached: boolean;
  available: boolean;
  reason?: string;
};

/**
 * AI co-pilot (§4). Reads the actual conversation and suggests what to say
 * next. Suggestions are cached server-side per transcript length, so the
 * refresh button costs a model call only when the conversation has moved on.
 */
function CopilotCard({ handoffId }: { handoffId: string }) {
  const t = useT();
  const [data, setData] = useState<CopilotPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);

  const fetchCopilot = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/app/queues', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'copilot', handoffId }),
      });
      const body = (await response.json()) as CopilotPayload;
      setData(body);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [handoffId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchCopilot(), 0);
    return () => window.clearTimeout(timer);
  }, [fetchCopilot]);

  return (
    <div className="mt-3 rounded-xl border border-sky-400/18 bg-sky-400/[0.05] p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wider text-sky-700">
          {t('desk.copilot')}
          {data?.turnCount ? ` · ${data.turnCount}` : ''}
        </p>
        <button
          type="button"
          disabled={loading}
          onClick={() => void fetchCopilot()}
          className="rounded-md border border-hairline px-2 py-1 text-[11px] text-ink-body transition hover:text-ink"
        >
          {loading ? t('import.reading') : t('desk.refresh')}
        </button>
      </div>

      {!data && loading ? (
        <p className="mt-2 text-[11px] text-ink-muted">
          {t('desk.copilotReading')}
        </p>
      ) : null}

      {data && !data.available ? (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
          {data.reason === 'no_transcript_yet'
            ? 'Nothing has been said on this conversation yet.'
            : data.reason === 'no_conversation_linked'
              ? 'This handoff is not linked to a recorded conversation, so there is nothing to read.'
              : data.reason?.startsWith('provider_unavailable')
                ? 'No reasoning provider is reachable, so no suggestions were generated.'
                : 'No suggestions could be generated for this conversation.'}
        </p>
      ) : null}

      {data?.available ? (
        <div className="mt-2.5 space-y-2.5">
          {data.goal ? (
            <p className="text-[11px] leading-relaxed text-ink">
              <span className="text-ink-muted">{t('desk.copilotGoal')} </span>
              {data.goal}
            </p>
          ) : null}
          {data.risks.length ? (
            <ul className="space-y-1">
              {data.risks.map((risk, index) => (
                <li
                  key={`risk-${index}`}
                  className="rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-2.5 py-1.5 text-[11px] text-warning-text"
                >
                  {risk}
                </li>
              ))}
            </ul>
          ) : null}
          {data.suggestions.length ? (
            <div className="space-y-1.5">
              {data.suggestions.map((line, index) => (
                <button
                  key={`suggestion-${index}`}
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(line);
                    setCopied(index);
                  }}
                  className="block w-full rounded-lg border border-hairline bg-surface-muted px-2.5 py-2 text-left text-[11px] leading-relaxed text-ink transition hover:border-hairline"
                >
                  {line}
                  <span className="mt-1 block text-[11px] text-ink-muted">
                    {copied === index ? 'copied' : 'click to copy'}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {data.facts.length ? (
            <p className="text-[11px] leading-relaxed text-ink-muted">
              <span className="text-ink-muted">{t('desk.copilotFacts')} </span>
              {data.facts.join(' · ')}
            </p>
          ) : null}
          {data.nextAction ? (
            <p className="text-[11px] leading-relaxed text-ink-muted">
              <span className="text-ink-muted">{t('desk.copilotNext')} </span>
              {data.nextAction}
            </p>
          ) : null}
          <p className="text-[11px] text-ink-muted">
            {data.cached
              ? 'Cached for this transcript length'
              : 'Freshly generated'}
            {data.model ? ` · ${data.model}` : ''}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Making and changing a queue.
 *
 * The desk has always listed queues and never let anyone create one — the API
 * has taken `create_queue`, `update_queue` and `delete_queue` since it was
 * written and no screen sent any of them, so a workspace's queues were whatever
 * the seed happened to leave behind.
 *
 * Removal goes through the same button as everything else and the server
 * decides: a queue nothing points at is deleted, one with conversations, rules,
 * numbers or members behind it is archived, and the reason comes back in words
 * rather than as a silent difference.
 */
function QueueEditor({
  queues,
  strategies,
  run,
  busy,
}: {
  queues: Row[];
  strategies: string[];
  run: (label: string, payload: Record<string, unknown>) => Promise<void>;
  busy: string | null;
}) {
  const empty = {
    queueId: '',
    name: '',
    slug: '',
    strategy: strategies[0] ?? 'skill_first',
    requiredSkill: '',
    language: '',
    slaSeconds: '60',
    priority: '100',
    overflowAction: 'callback',
    overflowQueueId: '',
  };
  const [form, setForm] = useState(empty);
  const editing = Boolean(form.queueId);

  const set = (patch: Partial<typeof empty>) =>
    setForm((current) => ({ ...current, ...patch }));

  return (
    <section className="rounded-2xl border border-hairline bg-surface-muted p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-semibold text-ink">
          {editing ? 'Edit queue' : 'New queue'}
        </h2>
        {editing ? (
          <button
            type="button"
            onClick={() => setForm(empty)}
            className="text-[11px] text-ink-muted hover:text-ink"
          >
            Cancel
          </button>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <label className="text-[11px] text-ink-muted">
          Name
          <input
            value={form.name}
            onChange={(event) => set({ name: event.target.value })}
            placeholder="Sales — Gurgaon"
            className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-2 text-[11px] text-ink"
          />
        </label>
        <label className="text-[11px] text-ink-muted">
          Strategy
          <select
            value={form.strategy}
            onChange={(event) => set({ strategy: event.target.value })}
            className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-2 text-[11px] text-ink"
          >
            {strategies.map((strategy) => (
              <option key={strategy} value={strategy}>
                {strategy.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] text-ink-muted">
          Required skill
          <input
            value={form.requiredSkill}
            onChange={(event) => set({ requiredSkill: event.target.value })}
            placeholder="optional"
            className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-2 text-[11px] text-ink"
          />
        </label>
        <label className="text-[11px] text-ink-muted">
          Answer within (seconds)
          <input
            type="number"
            min={5}
            max={3600}
            value={form.slaSeconds}
            onChange={(event) => set({ slaSeconds: event.target.value })}
            className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-2 text-[11px] text-ink"
          />
        </label>
        <label className="text-[11px] text-ink-muted">
          Priority
          <input
            type="number"
            min={1}
            max={1000}
            value={form.priority}
            onChange={(event) => set({ priority: event.target.value })}
            className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-2 text-[11px] text-ink"
          />
        </label>
        <label className="text-[11px] text-ink-muted">
          When nobody answers
          <select
            value={form.overflowAction}
            onChange={(event) => set({ overflowAction: event.target.value })}
            className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-2 text-[11px] text-ink"
          >
            <option value="callback">offer a callback</option>
            <option value="ticket">raise a ticket</option>
            <option value="ai_continue">let the AI carry on</option>
            <option value="overflow_queue">send to another queue</option>
          </select>
        </label>
        {/* Only asked for when it means something. The server refuses an
            overflow queue that does not exist, because overflow that
            dead-ends at routing time is worse than no overflow. */}
        {form.overflowAction === 'overflow_queue' ? (
          <label className="text-[11px] text-ink-muted">
            Overflow into
            <select
              value={form.overflowQueueId}
              onChange={(event) => set({ overflowQueueId: event.target.value })}
              className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-2 text-[11px] text-ink"
            >
              <option value="">Choose a queue…</option>
              {queues
                .filter((queue) => str(queue.id) !== form.queueId)
                .map((queue) => (
                  <option key={str(queue.id)} value={str(queue.id)}>
                    {str(queue.name)}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
      </div>

      <button
        type="button"
        disabled={!form.name.trim() || busy === 'queue'}
        onClick={() =>
          void run('queue', {
            action: editing ? 'update_queue' : 'create_queue',
            ...form,
          }).then(() => setForm(empty))
        }
        className="portal-primary mt-3 rounded-lg px-4 py-2 text-[11px] disabled:opacity-50"
      >
        {editing ? 'Save queue' : 'Create queue'}
      </button>

      <div className="mt-4 space-y-2">
        {queues.map((queue) => (
          <div
            key={str(queue.id)}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-surface px-3 py-2.5 text-[11px]"
          >
            <span
              className={
                str(queue.status) === 'archived'
                  ? 'font-medium text-ink-muted line-through'
                  : 'font-medium'
              }
            >
              {str(queue.name)}
            </span>
            <span className="font-mono text-ink-muted">{str(queue.slug)}</span>
            <span className="ml-auto text-ink-muted">
              {str(queue.member_count, '0')} on it
            </span>
            <button
              type="button"
              disabled={busy === 'queue'}
              onClick={() =>
                setForm({
                  queueId: str(queue.id),
                  name: str(queue.name),
                  slug: str(queue.slug),
                  strategy: str(queue.strategy, 'skill_first'),
                  requiredSkill: str(queue.required_skill),
                  language: str(queue.language),
                  slaSeconds: str(queue.sla_seconds, '60'),
                  priority: str(queue.priority, '100'),
                  overflowAction: str(queue.overflow_action, 'callback'),
                  overflowQueueId: str(queue.overflow_queue_id),
                })
              }
              className="rounded-md border border-hairline px-2 py-1 text-ink-body hover:bg-surface-strong"
            >
              Edit
            </button>
            <button
              type="button"
              disabled={busy === 'queue'}
              onClick={() =>
                void run('queue', {
                  action: 'delete_queue',
                  queueId: str(queue.id),
                })
              }
              className="rounded-md px-2 py-1 text-ink-muted hover:bg-surface-strong hover:text-ink"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Routing rules: what sends a conversation to which queue.
 *
 * Listed since the desk was built, never editable. Archived rather than
 * deleted, on the API's own reasoning — a rule that decided how calls were
 * routed last month is part of why they went where they went — so this offers
 * Archive and Restore, and shows archived rules struck through rather than
 * hiding them.
 */
function RuleEditor({
  queues,
  run,
  busy,
}: {
  queues: Row[];
  run: (label: string, payload: Record<string, unknown>) => Promise<void>;
  busy: string | null;
}) {
  const [form, setForm] = useState({
    matchType: 'skill',
    matchValue: '',
    queueId: '',
    priority: '100',
  });
  const live = queues.filter((queue) => str(queue.status) !== 'archived');

  return (
    <div className="mt-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="text-[11px] text-ink-muted">
          When
          <select
            value={form.matchType}
            onChange={(event) =>
              setForm({ ...form, matchType: event.target.value })
            }
            className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-2 text-[11px] text-ink"
          >
            {['skill', 'language', 'number', 'use_case', 'reason'].map(
              (type) => (
                <option key={type} value={type}>
                  {type.replaceAll('_', ' ')}
                </option>
              ),
            )}
          </select>
        </label>
        <label className="text-[11px] text-ink-muted">
          is
          <input
            value={form.matchValue}
            onChange={(event) =>
              setForm({ ...form, matchValue: event.target.value })
            }
            placeholder="hindi"
            className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-2 text-[11px] text-ink"
          />
        </label>
        <label className="text-[11px] text-ink-muted">
          send to
          <select
            value={form.queueId}
            onChange={(event) =>
              setForm({ ...form, queueId: event.target.value })
            }
            className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-2 text-[11px] text-ink"
          >
            <option value="">Choose a queue…</option>
            {live.map((queue) => (
              <option key={str(queue.id)} value={str(queue.id)}>
                {str(queue.name)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] text-ink-muted">
          Priority
          <input
            type="number"
            min={1}
            max={1000}
            value={form.priority}
            onChange={(event) =>
              setForm({ ...form, priority: event.target.value })
            }
            className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-2 text-[11px] text-ink"
          />
        </label>
      </div>
      <button
        type="button"
        disabled={!form.matchValue.trim() || !form.queueId || busy === 'rule'}
        onClick={() =>
          void run('rule', { action: 'create_rule', ...form }).then(() =>
            setForm({ ...form, matchValue: '' }),
          )
        }
        className="portal-primary mt-2.5 rounded-lg px-4 py-2 text-[11px] disabled:opacity-50"
      >
        Add rule
      </button>
    </div>
  );
}
