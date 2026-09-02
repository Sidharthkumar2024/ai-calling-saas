'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, PhoneIncoming, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';

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
      <div className="flex items-center gap-2 text-[11px] text-white/45">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading queues…
      </div>
    );
  if (error && !data)
    return <p className="text-[11px] text-rose-300">{error}</p>;
  const view_ = data!;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[9px] uppercase tracking-wider text-white/28">
            {view === 'desk' ? 'Human handoff' : 'Operations'}
          </p>
          <h1 className="mt-1 text-lg font-semibold">
            {view === 'desk' ? 'Agent desk' : 'Supervisor wallboard'}
          </h1>
          <p className="mt-1 text-[11px] text-white/40">
            {view === 'desk'
              ? 'Conversations the AI escalated to a human, with the AI summary attached.'
              : 'Queues, staffing and SLA pressure across the workspace.'}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-white/32">
          <RefreshCw className="h-3 w-3" />
          Refreshes every {POLL_MS / 1000}s
        </div>
      </div>
      {notice ? (
        <p className="rounded-lg border border-amber-400/25 bg-amber-400/8 px-3 py-2 text-[11px] text-amber-100">
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
    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3.5">
      <p className="text-[9px] uppercase tracking-wider text-white/28">
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
  const me = data.me;
  const myId = str(me?.id);
  const [wrapUp, setWrapUp] = useState<{
    handoffId: string;
    disposition: string;
    notes: string;
  } | null>(null);

  if (!me)
    return (
      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-6">
        <p className="text-sm font-medium">You are not on the support bench</p>
        <p className="mt-2 text-[11px] leading-relaxed text-white/45">
          The Agent Desk shows conversations assigned to you. Your workspace
          account is not linked to a support agent record yet, so there is
          nothing to take. A workspace admin can add you to the bench and to a
          queue.
        </p>
      </div>
    );

  const mine = data.activeHandoffs.filter(
    (row) => str(row.assigned_agent_id) === myId,
  );
  const availability = str(me.availability, 'offline');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-white/8 bg-white/[0.02] p-4">
        <div className="mr-auto">
          <p className="text-[11px] font-medium">{str(me.name)}</p>
          <p className="mt-0.5 text-[10px] text-white/40">
            {str(me.active_calls, '0')} of {str(me.max_concurrent_calls, '1')}{' '}
            slots in use
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
                ? 'border-emerald-400/40 bg-emerald-400/12 text-emerald-100'
                : 'border-white/10 bg-white/4 text-white/55 hover:text-white/85'
            }`}
          >
            {state}
          </button>
        ))}
      </div>

      <section>
        <h2 className="text-[11px] font-semibold text-white/70">
          Waiting in your queues ({data.waiting.length})
        </h2>
        <div className="mt-3 space-y-2.5">
          {data.waiting.length === 0 ? (
            <p className="text-[11px] text-white/35">Nothing is waiting.</p>
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
                    : 'border-white/8 bg-white/[0.02]'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 text-[10px] text-white/40">
                  <PhoneIncoming className="h-3 w-3" />
                  <span className="rounded-md bg-white/6 px-2 py-0.5 uppercase tracking-wide">
                    {str(row.queue_slug, 'unrouted')}
                  </span>
                  <span>{str(row.reason).replaceAll('_', ' ')}</span>
                  <span className={waited > sla ? 'text-rose-200' : ''}>
                    waiting {waited}s{waited > sla ? ` · SLA ${sla}s breached` : ''}
                  </span>
                </div>
                {str(row.ai_summary) ? (
                  <p className="mt-2 text-[12px] leading-relaxed text-white/75">
                    {str(row.ai_summary)}
                  </p>
                ) : (
                  <p className="mt-2 text-[11px] text-white/35">
                    No AI summary was attached to this handoff.
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
                    Accept
                  </Button>
                  {availability !== 'online' ? (
                    <span className="self-center text-[10px] text-white/32">
                      Go online to accept
                    </span>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="text-[11px] font-semibold text-white/70">
          Your active conversations ({mine.length})
        </h2>
        <div className="mt-3 space-y-2.5">
          {mine.length === 0 ? (
            <p className="text-[11px] text-white/35">
              You have no active conversations.
            </p>
          ) : null}
          {mine.map((row) => (
            <article
              key={str(row.id)}
              className="rounded-xl border border-white/8 bg-white/[0.02] p-4"
            >
              <div className="flex flex-wrap items-center gap-2 text-[10px] text-white/40">
                <span className="rounded-md bg-white/6 px-2 py-0.5 uppercase tracking-wide">
                  {str(row.queue_slug, 'unrouted')}
                </span>
                <span>{str(row.status)}</span>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-white/75">
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
                    <option value="">Choose a disposition…</option>
                    {data.dispositions.map((item) => (
                      <option key={item} value={item}>
                        {item.replaceAll('_', ' ')}
                      </option>
                    ))}
                  </select>
                  <textarea
                    rows={3}
                    value={wrapUp.notes}
                    placeholder="What happened, and what did you promise the customer?"
                    onChange={(event) =>
                      setWrapUp({ ...wrapUp, notes: event.target.value })
                    }
                    className="w-full rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-[11px]"
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
                      Save wrap-up
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
                    Wrap up
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
                    Return to queue
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

      <section className="overflow-hidden rounded-2xl border border-white/8 bg-[#0c1422]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="border-b border-white/8 bg-white/[0.02] text-[9px] uppercase tracking-wider text-white/28">
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
                    <p className="mt-0.5 font-mono text-[9px] text-white/28">
                      {str(queue.slug)}
                    </p>
                  </td>
                  <td className="px-4 py-3.5 text-white/55">
                    {str(queue.strategy).replaceAll('_', ' ')}
                  </td>
                  <td className="px-4 py-3.5 text-white/55">
                    {str(queue.required_skill, '—')}
                  </td>
                  <td className="px-4 py-3.5">{str(queue.member_count)}</td>
                  <td className="px-4 py-3.5">
                    <span
                      className={
                        Number(queue.online_count ?? 0) > 0
                          ? 'text-emerald-200'
                          : 'text-rose-200'
                      }
                    >
                      {str(queue.online_count)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">{str(queue.waiting_count)}</td>
                  <td className="px-4 py-3.5 text-white/55">
                    {str(queue.sla_seconds)}s
                  </td>
                  <td className="px-4 py-3.5 text-white/55">
                    {str(queue.overflow_action).replaceAll('_', ' ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-white/8 bg-white/[0.02] p-5">
          <h2 className="text-[11px] font-semibold text-white/70">
            Support bench
          </h2>
          <div className="mt-3 space-y-2">
            {data.agents.length === 0 ? (
              <p className="text-[11px] text-white/35">
                No support agents exist yet, so every escalation will queue.
              </p>
            ) : null}
            {data.agents.map((agent) => (
              <div
                key={str(agent.id)}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5"
              >
                <div className="mr-auto">
                  <p className="text-[11px] font-medium">{str(agent.name)}</p>
                  <p className="mt-0.5 text-[9px] text-white/32">
                    {str(agent.role).replaceAll('_', ' ')} ·{' '}
                    {str(agent.active_calls)}/
                    {str(agent.max_concurrent_calls)} slots
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
                    className={`rounded-md border px-2 py-1 text-[9px] capitalize transition ${
                      str(agent.availability) === state
                        ? 'border-emerald-400/40 bg-emerald-400/12 text-emerald-100'
                        : 'border-white/10 text-white/45 hover:text-white/75'
                    }`}
                  >
                    {state}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-white/8 bg-white/[0.02] p-5">
          <h2 className="text-[11px] font-semibold text-white/70">
            Routing rules
          </h2>
          <p className="mt-1 text-[10px] text-white/32">
            First match by priority decides the queue.
          </p>
          <div className="mt-3 space-y-2">
            {data.rules.length === 0 ? (
              <p className="text-[11px] text-white/35">
                No routing rules, so handoffs use the queue named by the caller
                only.
              </p>
            ) : null}
            {data.rules.map((rule) => (
              <div
                key={str(rule.id)}
                className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 text-[11px]"
              >
                <span className="font-mono text-[9px] text-white/32">
                  {str(rule.priority)}
                </span>
                <span className="text-white/70">
                  {str(rule.match_type)} = {str(rule.match_value)}
                </span>
                <span className="ml-auto rounded-md bg-white/6 px-2 py-0.5 text-[9px] uppercase tracking-wide text-white/55">
                  {str(rule.queue_slug, 'missing queue')}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-white/8 bg-white/[0.02] p-5">
        <h2 className="text-[11px] font-semibold text-white/70">
          Recently wrapped up
        </h2>
        <div className="mt-3 space-y-2">
          {data.recentHandoffs.length === 0 ? (
            <p className="text-[11px] text-white/35">
              No conversations have been wrapped up yet.
            </p>
          ) : null}
          {data.recentHandoffs.map((row) => (
            <div
              key={str(row.id)}
              className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5"
            >
              <div className="flex flex-wrap items-center gap-2 text-[10px] text-white/40">
                <span className="rounded-md bg-white/6 px-2 py-0.5 uppercase tracking-wide">
                  {str(row.disposition, 'no disposition').replaceAll('_', ' ')}
                </span>
                <span>{str(row.agent_name, 'unassigned')}</span>
                <span>{str(row.queue_slug, '—')}</span>
              </div>
              {str(row.disposition_notes) ? (
                <p className="mt-1.5 text-[11px] text-white/60">
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
        <p className="text-[9px] uppercase tracking-wider text-sky-200/70">
          AI co-pilot
          {data?.turnCount ? ` · ${data.turnCount} turns read` : ''}
        </p>
        <button
          type="button"
          disabled={loading}
          onClick={() => void fetchCopilot()}
          className="rounded-md border border-white/12 px-2 py-1 text-[9px] text-white/60 transition hover:text-white/90"
        >
          {loading ? 'Reading…' : 'Refresh'}
        </button>
      </div>

      {!data && loading ? (
        <p className="mt-2 text-[11px] text-white/40">Reading the conversation…</p>
      ) : null}

      {data && !data.available ? (
        <p className="mt-2 text-[11px] leading-relaxed text-white/45">
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
            <p className="text-[11px] leading-relaxed text-white/75">
              <span className="text-white/40">What they want: </span>
              {data.goal}
            </p>
          ) : null}
          {data.risks.length ? (
            <ul className="space-y-1">
              {data.risks.map((risk, index) => (
                <li
                  key={`risk-${index}`}
                  className="rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-2.5 py-1.5 text-[10px] text-amber-100"
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
                  className="block w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 text-left text-[11px] leading-relaxed text-white/80 transition hover:border-white/25"
                >
                  {line}
                  <span className="mt-1 block text-[9px] text-white/28">
                    {copied === index ? 'copied' : 'click to copy'}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {data.facts.length ? (
            <p className="text-[10px] leading-relaxed text-white/45">
              <span className="text-white/30">Given so far: </span>
              {data.facts.join(' · ')}
            </p>
          ) : null}
          {data.nextAction ? (
            <p className="text-[10px] leading-relaxed text-white/45">
              <span className="text-white/30">Recommended: </span>
              {data.nextAction}
            </p>
          ) : null}
          <p className="text-[9px] text-white/25">
            {data.cached ? 'Cached for this transcript length' : 'Freshly generated'}
            {data.model ? ` · ${data.model}` : ''}
          </p>
        </div>
      ) : null}
    </div>
  );
}
