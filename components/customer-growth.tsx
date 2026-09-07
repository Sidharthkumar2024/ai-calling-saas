'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, RefreshCw, Send, Square, ArrowUpRight, Leaf, MessageCircle, Database, ShieldCheck, ChevronDown } from 'lucide-react';

import { type Block, type Inline, parseBlocks } from '@/lib/chat-markdown';
import { DISCOVERY_QUESTIONS, type Confidence } from '@/lib/growth-manager';
import {
  actionSummary,
  type ExecutedAction,
  type ExecutionOffer,
} from '@/lib/growth-execution';

/**
 * The AI Business Manager (§6).
 *
 * Two halves. The discovery interview, which is §3's front door — the platform
 * asks the business about itself instead of presenting thirty configuration
 * screens. And the evidence board, which is the half that has to earn trust:
 * every observation shows the number, where it came from and how much data is
 * behind it, and every recommendation shows the observations it rests on.
 *
 * A recommendation with no evidence is never rendered because it is never
 * constructed — see `recommend` in `lib/growth-manager.ts`.
 */

type Observation = {
  id: string;
  statement: string;
  source: string;
  metric: { label: string; value: number; unit?: string };
  sampleSize: number;
  confidence: Confidence;
};

type Finding = {
  id: string;
  page: string;
  title: string;
  doThis: string;
  why: string;
  evidence: string;
  severity: 'high' | 'medium' | 'low';
  area: string;
};

type ScanRun = {
  id: string;
  siteUrl: string;
  host?: string | null;
  status: string;
  failureReason?: string | null;
  steps?: Array<{ label: string; detail?: string; ms: number; ok: boolean }>;
  pages?: Array<{ path: string; title: string; wordCount: number }>;
  findings?: Finding[];
  high: number;
  medium: number;
  low: number;
  totalMs: number;
  createdAt: string;
};

type ChatThread = {
  id: string;
  title: string;
  updatedAt: string;
  messages: number;
};

type Board = {
  runs?: ScanRun[];
  chats?: ChatThread[];
  chips?: Array<{ id: string; label: string; value: string }>;
  suggestedGoal?: string;
  discovery: {
    answers: Record<string, string>;
    progress: number;
    complete: boolean;
    missingRequired: string[];
  };
  observations: Observation[];
  recommendations: Array<{
    id: string;
    title: string;
    action: string;
    area: string;
    evidence: string[];
    confidence: Confidence;
  }>;
  offers?: ExecutionOffer[];
  actions?: ExecutedAction[];
  done?: string[];
  sources: {
    connected: string[];
    pending: Array<{ id: string; label: string; reason?: string | null }>;
  };
  notEnoughData: string | null;
  measuredAt: string;
};

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  high: 'text-success-text',
  medium: 'text-ink-body',
  low: 'text-warning-text',
};

export function CustomerGrowth() {
  const [board, setBoard] = useState<Board | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/app/growth', { cache: 'no-store' });
      const body = (await response.json()) as Board & { error?: string };
      if (!response.ok) {
        setError(body.error ?? 'Could not load the business manager.');
        return;
      }
      setBoard(body);
      setAnswers(body.discovery.answers ?? {});
      setError('');
    } catch {
      setError('Could not load the business manager.');
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function saveDiscovery() {
    setSaving(true);
    try {
      const response = await fetch('/api/app/growth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'save_discovery', answers }),
      });
      if (!response.ok) { const payload = await response.json() as { error?: string }; throw new Error(payload.error ?? 'Could not save business context.'); }
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save business context.');
    } finally {
      setSaving(false);
    }
  }

  if (error && !board)
    return (
      <p role="alert" className="text-[11px] text-danger-text">
        {error}
      </p>
    );
  if (!board) return <output className="portal-panel block p-8 text-sm text-ink-muted">Loading your business workspace…</output>;

  const byId = new Map(board.observations.map((item) => [item.id, item]));

  return (
    <div className="vani-growth space-y-6">
      <header className="vani-growth-heading"><div><span className="vani-growth-kicker"><Leaf className="size-4" /> YOUR BUSINESS, IN FOCUS</span><h1>AI Business Manager</h1><p>Understand what happened. Decide what comes next.</p></div><span className="vani-growth-permission"><ShieldCheck className="size-4" /> Actions stay permission-controlled</span></header>
      {error ? <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-danger-text">{error}</p> : null}
      <div className="vani-growth-summary">
        <div><Database /><span>Connected sources</span><strong>{board.sources.connected.length}</strong></div>
        <div><MessageCircle /><span>Saved conversations</span><strong>{board.chats?.length ?? 0}</strong></div>
        <div><ArrowUpRight /><span>Recommended next steps</span><strong>{board.recommendations.length}</strong></div>
      </div>
      <GrowthChat chips={board.chips ?? []} suggestedGoal={board.suggestedGoal ?? ''} chats={board.chats ?? []} onDone={load} />
      <details className="portal-panel p-5">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3"><span className="font-semibold">Business context <span className="ml-2 text-sm font-normal text-ink-muted">{Math.round(board.discovery.progress * 100)}% complete</span></span><ChevronDown className="size-4" /></summary>
        <section className="mt-5">
        <h2 className="text-sm font-semibold">Tell me about your business</h2>
        <p className="mt-1 text-[11px] text-ink-muted">
          Every answer changes something: the agent’s opening, what it qualifies
          for, and how this board ranks its advice.
        </p>
        {/* The answers as chips, so a person can see at a glance what the
            product is working from without re-reading six textareas. */}
        {Object.keys(board.discovery.answers ?? {}).length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {DISCOVERY_QUESTIONS.filter((q) =>
              (board.discovery.answers?.[q.id] ?? '').trim(),
            ).map((q) => (
              <span
                key={q.id}
                className="rounded-full border border-hairline bg-surface-muted px-2.5 py-1 text-[11px]"
              >
                <span className="text-ink-muted">{q.chip} </span>
                <span className="font-medium">
                  {(board.discovery.answers[q.id] ?? '').slice(0, 40)}
                </span>
              </span>
            ))}
          </div>
        ) : null}
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-surface-strong">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${Math.round(board.discovery.progress * 100)}%` }}
          />
        </div>
        <div className="mt-4 space-y-3">
          {DISCOVERY_QUESTIONS.map((question) => (
            <label key={question.id} className="block">
              <span className="text-[11px] font-medium">
                {question.question}
                {question.required ? null : (
                  <span className="ml-1 text-[11px] text-ink-muted">
                    optional
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-[11px] text-ink-muted">
                {question.purpose}
              </span>
              <textarea
                rows={2}
                value={answers[question.id] ?? ''}
                onChange={(event) =>
                  setAnswers({ ...answers, [question.id]: event.target.value })
                }
                className="mt-1.5 w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[11px]"
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => void saveDiscovery()}
          className="portal-primary mt-3 rounded-lg px-4 py-2 text-[11px] disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        </section>
      </details>

      <SiteScan runs={board.runs ?? []} onDone={load} />

      <section className="portal-panel p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Evidence board</h2>
          <span className="text-[11px] text-ink-muted">
            measured {board.measuredAt.slice(0, 16).replace('T', ' ')}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-ink-muted">
          Every line is measured from your own calls and leads. Nothing here is
          an opinion, and anything with too little data behind it is left out
          rather than shown faintly.
        </p>

        {board.notEnoughData ? (
          <p className="mt-4 rounded-xl border border-hairline bg-surface-muted px-3 py-3 text-[11px] text-ink-body">
            {board.notEnoughData}
          </p>
        ) : null}

        <div className="mt-4 space-y-2">
          {board.observations.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-surface-muted px-3 py-2.5 text-[11px]"
            >
              <span className="font-mono text-[12px] font-semibold">
                {item.metric.value}
                {item.metric.unit ?? ''}
              </span>
              <span className="flex-1">{item.statement}</span>
              <span className="text-[11px] text-ink-muted">
                from {item.source} · {item.sampleSize} records
              </span>
              <span
                className={`text-[11px] font-semibold ${CONFIDENCE_STYLE[item.confidence]}`}
              >
                {item.confidence} confidence
              </span>
            </div>
          ))}
        </div>

        {/* Which evidence this board has and which it does not. Saying so is
            the difference between an empty board and a complete one — silence
            here would read as "nothing to report". */}
        <p className="mt-4 text-[11px] text-ink-muted">
          Reading from: {board.sources.connected.join(', ')}. Not yet connected:{' '}
          {board.sources.pending
            .map((item) =>
              item.reason ? `${item.label} (${item.reason})` : item.label,
            )
            .join(', ')}{' '}
          — nothing on this board claims to come from them.
        </p>
      </section>

      <Connectors />

      <section className="portal-panel p-5">
        <h2 className="text-sm font-semibold">Growth plan</h2>
        <p className="mt-1 text-[11px] text-ink-muted">
          Ordered by how much evidence is behind each one, not by how important
          it sounds.
        </p>
        {board.recommendations.length === 0 ? (
          <p className="mt-4 text-[11px] text-ink-muted">
            Nothing to recommend yet. A recommendation here has to cite
            something measured, so this fills up as you run calls.
          </p>
        ) : null}
        <div className="mt-4 space-y-2">
          {board.recommendations.map((item) => (
            <div
              key={item.id}
              className="rounded-xl border border-hairline bg-surface-muted px-3 py-2.5"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[11px] font-medium">{item.title}</span>
                <span className="text-[11px] text-ink-muted">{item.area}</span>
                <span
                  className={`ml-auto text-[11px] font-semibold ${CONFIDENCE_STYLE[item.confidence]}`}
                >
                  {item.confidence} confidence
                </span>
              </div>
              <p className="mt-1 text-[11px] text-ink-body">{item.action}</p>
              <ul className="mt-2 space-y-0.5">
                {item.evidence.map((id) => (
                  <li key={id} className="text-[11px] text-ink-muted">
                    ↳ {byId.get(id)?.statement ?? id}
                  </li>
                ))}
              </ul>
              <Execution
                recommendationId={item.id}
                offers={(board.offers ?? []).filter(
                  (offer) => offer.recommendationId === item.id,
                )}
                actions={(board.actions ?? []).filter(
                  (action) => action.recommendationId === item.id,
                )}
                onDone={load}
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

type ConnectorStatusView = {
  id: string;
  label: string;
  state: string;
  message: string;
  canConnect: boolean;
  selection: string | null;
  lastSyncedAt: string | null;
};

/**
 * §6's three connections: Google Analytics, Search Console and HubSpot.
 *
 * Two states here are doing the real work.
 *
 * `platform_not_configured` names whose problem it is. The OAuth app belongs
 * to the platform, not the customer, so a workspace that cannot connect is
 * told to ask its administrator rather than sent hunting for a setting it does
 * not have.
 *
 * `needs_selection` exists because authorised is not connected. A Google token
 * can read *some* property; which one is a separate question, and a connector
 * that quietly picks the first would report a different business's numbers.
 */
function Connectors() {
  const [connectors, setConnectors] = useState<ConnectorStatusView[]>([]);
  const [choices, setChoices] = useState<
    Record<string, Array<{ id: string; label: string }>>
  >({});
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/app/growth/connect');
    if (!response.ok) return;
    const payload = (await response.json()) as {
      connectors?: ConnectorStatusView[];
    };
    setConnectors(payload.connectors ?? []);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function post(body: Record<string, unknown>) {
    const response = await fetch('/api/app/growth/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await response.json()) as Record<string, unknown>;
  }

  async function connect(id: string) {
    setBusy(id);
    setProblem(null);
    const payload = await post({ action: 'start', connector: id });
    setBusy('');
    if (payload.ok && typeof payload.url === 'string')
      window.location.assign(payload.url);
    else
      setProblem(
        typeof payload.reason === 'string'
          ? payload.reason
          : 'Could not start.',
      );
  }

  async function loadChoices(id: string) {
    setBusy(id);
    const response = await fetch(
      `/api/app/growth/connect?choices=${encodeURIComponent(id)}`,
    );
    const payload = (await response.json()) as {
      ok?: boolean;
      choices?: Array<{ id: string; label: string }>;
      reason?: string;
    };
    setBusy('');
    if (payload.ok) setChoices({ ...choices, [id]: payload.choices ?? [] });
    else
      setProblem(
        payload.reason ?? 'Could not list what this account can read.',
      );
  }

  if (connectors.length === 0) return null;

  return (
    <section className="portal-panel p-5">
      <h2 className="text-sm font-semibold">Connect your other numbers</h2>
      <p className="mt-1 text-[11px] text-ink-muted">
        Each one adds evidence to the board above, with its source shown like
        everything else. Until then the manager will keep saying it does not
        have these numbers rather than estimating them.
      </p>
      <div className="mt-4 space-y-2">
        {connectors.map((connector) => (
          <div
            key={connector.id}
            className="rounded-xl border border-hairline bg-surface px-3 py-2.5"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-[11px] font-medium">{connector.label}</span>
              <span
                className={`ml-auto text-[11px] ${
                  connector.state === 'connected'
                    ? 'text-success-text'
                    : connector.state === 'platform_not_configured'
                      ? 'text-ink-muted'
                      : 'text-warning-text'
                }`}
              >
                {connector.state.replaceAll('_', ' ')}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-ink-muted">
              {connector.message}
            </p>
            {connector.selection ? (
              <p className="mt-0.5 text-[11px] text-ink-muted">
                Reading: {connector.selection}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {connector.canConnect ? (
                <button
                  type="button"
                  disabled={busy === connector.id}
                  onClick={() => void connect(connector.id)}
                  className="rounded-full border border-hairline px-2.5 py-1 text-[11px] disabled:opacity-50"
                >
                  {connector.state === 'needs_selection'
                    ? 'Re-authorise'
                    : 'Connect'}
                </button>
              ) : null}
              {connector.state === 'needs_selection' ||
              connector.state === 'connected' ? (
                <button
                  type="button"
                  disabled={busy === connector.id}
                  onClick={() => void loadChoices(connector.id)}
                  className="rounded-full border border-hairline px-2.5 py-1 text-[11px] disabled:opacity-50"
                >
                  Choose what to read
                </button>
              ) : null}
              {connector.state !== 'not_connected' &&
              connector.state !== 'platform_not_configured' ? (
                <button
                  type="button"
                  onClick={async () => {
                    await post({
                      action: 'disconnect',
                      connector: connector.id,
                    });
                    await load();
                  }}
                  className="rounded-full border border-hairline px-2.5 py-1 text-[11px]"
                >
                  Disconnect
                </button>
              ) : null}
            </div>
            {choices[connector.id] ? (
              <div className="mt-2">
                {choices[connector.id].length === 0 ? (
                  <p className="text-[11px] text-warning-text">
                    This account has nothing this connector can read.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {choices[connector.id].map((choice) => (
                      <button
                        key={choice.id}
                        type="button"
                        onClick={async () => {
                          await post({
                            action: 'choose',
                            connector: connector.id,
                            selection: choice.id,
                          });
                          setChoices({ ...choices, [connector.id]: [] });
                          await load();
                        }}
                        className="rounded-full border border-hairline px-2.5 py-1 text-[11px]"
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {problem ? (
        <p role="alert" className="mt-2 text-[11px] text-danger-text">
          {problem}
        </p>
      ) : null}
    </section>
  );
}

/**
 * §6's Execution row: turning a recommendation into work.
 *
 * Two rules make this more than a button that files a to-do.
 *
 * An offer says exactly what it will do, in this workspace's numbers — "a
 * draft campaign holding the 12 leads scoring 75 or above" — so nobody has to
 * click it to find out.
 *
 * An offer that cannot be done is shown greyed with the reason rather than
 * hidden. A missing button never answers "why can't I do this?".
 *
 * Acting on advice does not delete the advice: the recommendation stays until
 * the numbers behind it move, with a line saying what was already done.
 */
function Execution({
  recommendationId,
  offers,
  actions,
  onDone,
}: {
  recommendationId: string;
  offers: ExecutionOffer[];
  actions: ExecutedAction[];
  onDone: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  if (offers.length === 0 && actions.length === 0) return null;
  const live = new Set(
    actions
      .filter((action) => action.status !== 'dropped')
      .map((action) => action.kind),
  );

  /**
   * Moves an action to done or dropped.
   *
   * The API has taken `open | done | dropped` since the board was built and no
   * screen ever sent it, so every action ever created read "Still open" for
   * ever — a status nobody could change, which is decoration rather than a
   * lifecycle. Dropping is reversible for the same reason archiving is: a
   * one-way door on advice is a reason not to touch the button at all.
   */
  async function move(actionId: string, status: 'open' | 'done' | 'dropped') {
    setBusy(actionId);
    setProblem(null);
    try {
      const response = await fetch('/api/app/growth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'update_action', actionId, status }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setProblem(payload.error ?? 'That did not go through.');
        return;
      }
      await onDone();
    } catch {
      setProblem('That did not go through.');
    } finally {
      setBusy('');
    }
  }

  async function run(kind: string) {
    setBusy(kind);
    setProblem(null);
    try {
      const response = await fetch('/api/app/growth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'execute', recommendationId, kind }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        reason?: string;
      };
      if (!payload.ok) setProblem(payload.reason ?? 'That could not be done.');
      else await onDone();
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="mt-2.5 border-t border-hairline pt-2.5">
      <div className="flex flex-wrap gap-1.5">
        {offers.map((offer) => (
          <button
            key={offer.id}
            type="button"
            disabled={
              Boolean(offer.blockedBy) ||
              busy === offer.kind ||
              live.has(offer.kind)
            }
            title={offer.blockedBy ?? offer.effect}
            onClick={() => void run(offer.kind)}
            className="rounded-full border border-hairline bg-surface px-2.5 py-1 text-[11px] disabled:opacity-45"
          >
            {busy === offer.kind
              ? 'Working…'
              : live.has(offer.kind)
                ? `${offer.label} ✓`
                : offer.label}
          </button>
        ))}
      </div>
      {/* The effect of each offer is spelled out rather than left to a tooltip:
          a person deciding whether to create a campaign should not have to
          hover to learn how many leads go into it. */}
      {offers.map((offer) => (
        <p
          key={`${offer.id}-effect`}
          className={`mt-1 text-[11px] ${offer.blockedBy ? 'text-warning-text' : 'text-ink-muted'}`}
        >
          {offer.blockedBy ?? offer.effect}
        </p>
      ))}
      {actions.map((action) => (
        <div
          key={action.id}
          className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-muted"
        >
          <span className="flex-1">
            {actionSummary(action)} {action.detail}
          </span>
          {action.status === 'open' ? (
            <>
              <button
                type="button"
                disabled={busy === action.id}
                onClick={() => void move(action.id, 'done')}
                className="rounded-md border border-hairline px-2 py-1 text-ink-body hover:bg-surface-strong disabled:opacity-50"
              >
                Mark done
              </button>
              <button
                type="button"
                disabled={busy === action.id}
                onClick={() => void move(action.id, 'dropped')}
                className="rounded-md px-2 py-1 hover:bg-surface-strong disabled:opacity-50"
              >
                Drop
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={busy === action.id}
              onClick={() => void move(action.id, 'open')}
              className="rounded-md px-2 py-1 hover:bg-surface-strong disabled:opacity-50"
            >
              Reopen
            </button>
          )}
        </div>
      ))}
      {problem ? (
        <p role="alert" className="mt-1 text-[11px] text-danger-text">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

const SEVERITY_STYLE: Record<string, string> = {
  high: 'text-danger-text',
  medium: 'text-warning-text',
  low: 'text-ink-muted',
};

/**
 * The website scan, its trace, and the report (§6).
 *
 * The trace is shown rather than summarised. A scan that reports "5 pages
 * analysed" and nothing else asks to be trusted; one that lists each URL with
 * the milliseconds it took can be checked — and when a site is slow, blocked or
 * unreachable, the trace is the difference between a diagnosis and a shrug.
 */
function SiteScan({
  runs,
  onDone,
}: {
  runs: ScanRun[];
  onDone: () => Promise<void>;
}) {
  const [site, setSite] = useState('');
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<ScanRun | null>(null);
  const [openRun, setOpenRun] = useState<ScanRun | null>(null);
  const [message, setMessage] = useState('');

  async function scan() {
    setRunning(true);
    setMessage('');
    setCurrent(null);
    try {
      const response = await fetch('/api/app/growth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'scan_site', siteUrl: site }),
      });
      const body = (await response.json()) as ScanRun & {
        ok?: boolean;
        reason?: string;
        error?: string;
        counts?: { high: number; medium: number; low: number };
      };
      if (!response.ok) {
        setMessage(body.error ?? 'The scan could not run.');
        return;
      }
      setCurrent({
        ...body,
        high: body.counts?.high ?? 0,
        medium: body.counts?.medium ?? 0,
        low: body.counts?.low ?? 0,
      });
      // A refused or unreachable site still produced a run; the reason is the
      // useful part and it is shown, not swallowed.
      if (body.ok === false)
        setMessage(body.reason ?? 'Nothing could be read.');
      setOpenRun(null);
      await onDone();
    } catch {
      setMessage('The scan could not run.');
    } finally {
      setRunning(false);
    }
  }

  async function openReport(id: string) {
    const response = await fetch(
      `/api/app/growth?run=${encodeURIComponent(id)}`,
      {
        cache: 'no-store',
      },
    );
    const body = (await response.json()) as { run?: ScanRun };
    if (body.run) setOpenRun(body.run);
  }

  const shown = openRun ?? current;

  return (
    <section className="portal-panel p-5">
      <h2 className="text-sm font-semibold">Read my website</h2>
      <p className="mt-1 text-[11px] text-ink-muted">
        Fetches your own pages and reports what is measurably wrong with each
        one — the title, the heading, the amount of copy, whether the page asks
        the visitor to do anything.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={site}
          onChange={(event) => setSite(event.target.value)}
          placeholder="yourbusiness.com"
          aria-label="Your website address"
          className="h-9 flex-1 min-w-56 rounded-lg border border-hairline bg-surface px-3 text-[11px]"
        />
        <button
          type="button"
          disabled={running || !site.trim()}
          onClick={() => void scan()}
          className="portal-primary rounded-lg px-4 py-2 text-[11px] disabled:opacity-60"
        >
          {running ? 'Reading…' : 'Scan'}
        </button>
      </div>
      {message ? (
        <p className="mt-2 text-[11px] text-warning-text">{message}</p>
      ) : null}

      {shown?.steps?.length ? (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            What it actually did
          </p>
          <div className="mt-2 space-y-0.5 font-mono text-[11px]">
            {shown.steps.map((step, index) => (
              <div
                key={`${step.label}-${index}`}
                className="flex flex-wrap gap-2"
              >
                <span
                  className={step.ok ? 'text-success-text' : 'text-danger-text'}
                >
                  {step.ok ? '✓' : '✕'}
                </span>
                <span>{step.label}</span>
                <span className="text-ink-muted">{step.detail}</span>
                <span className="ml-auto text-ink-muted">{step.ms}ms</span>
              </div>
            ))}
            <div className="pt-1 text-ink-muted">
              total {shown.totalMs}ms · run {shown.id}
            </div>
          </div>
        </div>
      ) : null}

      {shown?.findings?.length ? (
        <div className="mt-5">
          <div className="flex flex-wrap items-baseline gap-2">
            <p className="text-[11px] font-semibold">
              Report — {shown.findings.length} action
              {shown.findings.length === 1 ? '' : 's'} for {shown.host}
            </p>
            <span className="text-[11px] text-danger-text">
              {shown.high} high
            </span>
            <span className="text-[11px] text-warning-text">
              {shown.medium} medium
            </span>
            <span className="text-[11px] text-ink-muted">{shown.low} low</span>
          </div>
          <div className="mt-3 space-y-2">
            {shown.findings.map((finding, index) => (
              <div
                key={finding.id}
                className="rounded-xl border border-hairline bg-surface-muted px-3 py-2.5"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[11px] text-ink-muted">
                    {index + 1}
                  </span>
                  <span className="text-[11px] font-medium">
                    {finding.title}
                  </span>
                  <code className="rounded bg-surface-strong px-1.5 py-0.5 text-[11px]">
                    {finding.page}
                  </code>
                  <span
                    className={`ml-auto text-[11px] font-semibold ${SEVERITY_STYLE[finding.severity]}`}
                  >
                    {finding.severity}
                  </span>
                </div>
                <p className="mt-1.5 text-[11px]">
                  <span className="font-semibold text-ink-muted">DO THIS </span>
                  {finding.doThis}
                </p>
                <p className="mt-1 text-[11px] text-ink-muted">
                  <span className="font-semibold">WHY </span>
                  {finding.why}
                </p>
                <p className="mt-1 text-[11px] text-ink-muted">
                  ↳ measured: {finding.evidence}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {runs.length ? (
        <div className="mt-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Previous runs
          </p>
          <div className="mt-2 space-y-1">
            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => void openReport(run.id)}
                className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-left text-[11px] hover:bg-surface-strong"
              >
                <span className="font-medium">{run.host ?? run.siteUrl}</span>
                <span className="text-ink-muted">
                  {run.createdAt.slice(0, 16).replace('T', ' ')}
                </span>
                {run.status === 'failed' ? (
                  <span className="text-danger-text">
                    failed — {run.failureReason}
                  </span>
                ) : (
                  <span className="text-ink-muted">
                    {run.high} high · {run.medium} medium · {run.low} low
                  </span>
                )}
                <span className="ml-auto font-mono text-[11px] text-ink-muted">
                  {run.id}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The growth manager's chat (§6) — the front door.
 *
 * Opens with the request already composed from what the workspace has told us,
 * rather than an empty box: a person should not retype their own business
 * every time they want a plan.
 *
 * The answer is grounded in the workspace's measured facts, and what it was
 * grounded on is shown under the reply. That line is the difference between a
 * business manager and a chatbot with a nice header — it says which numbers
 * were available and which sources were not connected, so an answer that
 * declines to guess reads as correct rather than as broken.
 */
function GrowthChat({
  chips,
  suggestedGoal,
  chats,
  onDone,
}: {
  chips: Array<{ id: string; label: string; value: string }>;
  suggestedGoal: string;
  chats: ChatThread[];
  onDone: () => Promise<void>;
}) {
  const [question, setQuestion] = useState('');
  const [chatId, setChatId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  // Off by default: the deep run costs four extra model calls, so it is asked
  // for rather than assumed.
  const [deep, setDeep] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const lastAskedRef = useRef('');

  // Follow the answer as it arrives, the way a conversation does. Only when
  // the reader is already at the bottom: yanking the view down while somebody
  // is reading an earlier answer is worse than not following at all.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const distance = box.scrollHeight - box.scrollTop - box.clientHeight;
    if (distance < 140) box.scrollTop = box.scrollHeight;
  }, [turns]);

  function grow(element: HTMLTextAreaElement | null) {
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(160, element.scrollHeight)}px`;
  }

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
  }

  /**
   * Streams one answer.
   *
   * The stream is the path; the plain JSON `ask` action is the fallback, used
   * when the browser has no `ReadableStream` on responses or the stream never
   * opens. Both write the same turn to the same thread — the fallback is a
   * slower answer, not a different one.
   */
  async function ask(text: string) {
    const asked = text.trim();
    if (!asked || busy) return;
    lastAskedRef.current = asked;
    setBusy(true);
    setQuestion('');
    grow(composerRef.current);
    setTurns((current) => [
      ...current,
      { role: 'user', content: asked },
      { role: 'assistant', content: '', streaming: true },
    ]);
    const controller = new AbortController();
    abortRef.current = controller;

    const writeAssistant = (update: (turn: Turn) => Turn) =>
      setTurns((current) => {
        const next = [...current];
        for (let index = next.length - 1; index >= 0; index -= 1)
          if (next[index].role === 'assistant') {
            next[index] = update(next[index]);
            break;
          }
        return next;
      });

    try {
      const response = await fetch('/api/app/growth/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question: asked,
          chatId,
          mode: deep ? 'deep' : 'quick',
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error('no stream');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let reading = true;
      while (reading) {
        const { done, value } = await reader.read();
        if (done) {
          reading = false;
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const line = buffer.slice(0, boundary).replace(/^data: ?/, '');
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf('\n\n');
          if (!line) continue;
          const event = JSON.parse(line) as {
            type: string;
            text?: string;
            chatId?: string;
            message?: string;
            id?: string;
            label?: string;
            ms?: number;
            status?: string;
            note?: string;
            summary?: string;
            findings?: LaneFinding[];
            groundedOn?: {
              observations: number;
              scanRun: string | null;
              missingSources: string[];
            };
          };
          if (event.type === 'start') {
            if (event.chatId) setChatId(event.chatId);
            const grounded = describeGrounding(event.groundedOn);
            writeAssistant((turn) => ({ ...turn, grounded }));
          } else if (event.type === 'step' || event.type === 'lane') {
            const step: TraceStep = {
              id: String(event.id ?? ''),
              label: String(event.label ?? ''),
              ms: event.ms,
              status: String(event.status ?? 'done'),
              note: event.note,
              findings: event.findings,
            };
            writeAssistant((turn) => ({
              ...turn,
              steps: [...(turn.steps ?? []), step],
            }));
          } else if (event.type === 'lanes_done') {
            writeAssistant((turn) => ({ ...turn, laneSummary: event.summary }));
          } else if (event.type === 'delta' && event.text) {
            writeAssistant((turn) => ({
              ...turn,
              content: turn.content + event.text,
            }));
          } else if (event.type === 'error') {
            writeAssistant((turn) => ({
              ...turn,
              error: event.message ?? 'The answer stopped early.',
            }));
          } else if (event.type === 'done') {
            writeAssistant((turn) => ({ ...turn, streaming: false }));
          }
        }
      }
      writeAssistant((turn) => ({ ...turn, streaming: false }));
      await onDone();
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') {
        // Stopped on purpose. Whatever arrived stays; the server keeps it too.
        writeAssistant((turn) => ({
          ...turn,
          streaming: false,
          stopped: true,
        }));
        await onDone();
        return;
      }
      await askWithoutStreaming(asked, writeAssistant);
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  async function askWithoutStreaming(
    asked: string,
    writeAssistant: (update: (turn: Turn) => Turn) => void,
  ) {
    try {
      const response = await fetch('/api/app/growth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'ask', question: asked, chatId }),
      });
      const body = (await response.json()) as {
        chatId?: string;
        answer?: string;
        error?: string;
        groundedOn?: {
          observations: number;
          scanRun: string | null;
          missingSources: string[];
        };
      };
      if (!response.ok) {
        writeAssistant((turn) => ({
          ...turn,
          streaming: false,
          error: body.error ?? 'That did not go through.',
        }));
        return;
      }
      if (body.chatId) setChatId(body.chatId);
      writeAssistant((turn) => ({
        ...turn,
        streaming: false,
        content: body.answer ?? '',
        grounded: describeGrounding(body.groundedOn),
      }));
      await onDone();
    } catch {
      writeAssistant((turn) => ({
        ...turn,
        streaming: false,
        error: 'That did not go through.',
      }));
    }
  }

  async function openChat(id: string) {
    stop();
    const response = await fetch(
      `/api/app/growth?chat=${encodeURIComponent(id)}`,
      { cache: 'no-store' },
    );
    const body = (await response.json()) as {
      messages?: Array<{ role: string; content: string }>;
    };
    setChatId(id);
    setTurns(
      (body.messages ?? []).map((message) => ({
        role: message.role === 'user' ? 'user' : 'assistant',
        content: message.content,
      })),
    );
  }

  async function copy(index: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(index);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      // A browser that refuses the clipboard is not an error worth a banner;
      // the text is on screen and selectable.
    }
  }

  const starters = [
    suggestedGoal,
    'Which leads should I call first this week, and why?',
    'What is losing me the most bookings right now?',
    'Draft the opening line my agent should use on new site-visit enquiries.',
  ].filter(Boolean);

  return (
    <section className="vani-growth-chat portal-panel flex flex-col p-5 sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold">What would you like to work on?</h2>
        <div className="flex items-center gap-3">
          {turns.length ? (
            <button
              type="button"
              onClick={() => {
                stop();
                setChatId(null);
                setTurns([]);
              }}
              className="text-[11px] text-ink-body underline-offset-2 hover:underline"
            >
              New chat
            </button>
          ) : null}
        </div>
      </div>

      {chips.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip.id}
              className="rounded-full border border-hairline bg-surface-muted px-2.5 py-1 text-[11px]"
            >
              <span className="text-ink-muted">{chip.label} </span>
              <span className="font-medium">{chip.value}</span>
            </span>
          ))}
          <span className="text-[11px] text-ink-muted">
            — I use this on every answer, so you never repeat it.
          </span>
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-ink-muted">
          Answer the discovery questions below and I will use them to direct
          every answer.
        </p>
      )}

      <div
        ref={scrollRef}
        className="vani-growth-messages mt-4 max-h-[32rem] min-h-[15rem] overflow-y-auto rounded-xl bg-surface-muted/40 p-4 sm:p-6"
      >
        {turns.length === 0 ? (
          <div className="flex h-full flex-col justify-center gap-2 py-4">
            <p className="text-[12px] text-ink-body">
              Ask about your calls, leads, website or what to do next. Answers
              come from this workspace&rsquo;s own numbers.
            </p>
            <div className="vani-growth-starters mt-3 grid gap-3 sm:grid-cols-2">
              {starters.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  onClick={() => void ask(starter)}
                  className="flex items-start gap-3 rounded-xl border border-hairline bg-surface p-4 text-left text-sm text-ink-body transition hover:border-primary/40 hover:bg-surface-strong"
                >
                  {starter}
                  <ArrowUpRight className="ml-auto size-4 shrink-0 text-primary" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {turns.map((turn, index) => (
              <div
                key={`${turn.role}-${index}`}
                className={
                  turn.role === 'user'
                    ? 'ml-auto max-w-[80%] rounded-xl rounded-br-sm bg-primary px-3 py-2 text-[12px] text-primary-foreground'
                    : 'max-w-[92%] rounded-xl rounded-bl-sm border border-hairline bg-surface px-3 py-2 text-[12px]'
                }
              >
                {turn.role === 'user' ? (
                  <p className="whitespace-pre-wrap">{turn.content}</p>
                ) : (
                  <>
                    {turn.steps?.length ? (
                      <RunTrace steps={turn.steps} summary={turn.laneSummary} />
                    ) : null}
                    <Markdown text={turn.content} />
                    {turn.streaming && !turn.content && !turn.steps?.length ? (
                      <p className="text-[12px] text-ink-muted">Thinking…</p>
                    ) : null}
                    {turn.streaming && turn.content ? (
                      <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-ink-muted align-middle" />
                    ) : null}
                    {turn.stopped ? (
                      <p className="mt-1.5 text-[11px] text-ink-muted">
                        Stopped. What arrived is saved.
                      </p>
                    ) : null}
                    {turn.error ? (
                      <p className="mt-1.5 text-[11px] text-warning-text">
                        {turn.error}
                      </p>
                    ) : null}
                    {turn.grounded?.length ? (
                      <p className="mt-1.5 text-[11px] text-ink-muted">
                        ↳ answered from {turn.grounded.join(' · ')}
                      </p>
                    ) : null}
                    {!turn.streaming && turn.content ? (
                      <div className="mt-2 flex gap-1">
                        <button
                          type="button"
                          onClick={() => void copy(index, turn.content)}
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-ink-muted hover:bg-surface-strong hover:text-ink"
                        >
                          {copied === index ? (
                            <Check className="size-3" />
                          ) : (
                            <Copy className="size-3" />
                          )}
                          {copied === index ? 'Copied' : 'Copy'}
                        </button>
                        {index === turns.length - 1 ? (
                          <button
                            type="button"
                            onClick={() => {
                              setTurns((current) => current.slice(0, -2));
                              void ask(lastAskedRef.current);
                            }}
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-ink-muted hover:bg-surface-strong hover:text-ink"
                          >
                            <RefreshCw className="size-3" /> Again
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-end gap-2 rounded-xl border border-hairline bg-surface p-2">
        <textarea
          ref={composerRef}
          value={question}
          rows={1}
          onChange={(event) => {
            setQuestion(event.target.value);
            grow(event.target);
          }}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter is a new line — the convention every
            // chat uses, and the old single-line input could not do the second.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void ask(question);
            }
          }}
          placeholder="Ask anything about this workspace…"
          aria-label="Ask the growth manager"
          className="max-h-40 flex-1 resize-none bg-transparent px-1.5 py-1.5 text-[12px] outline-none"
        />
        <button
          type="button"
          onClick={() => setDeep((value) => !value)}
          aria-pressed={deep}
          title="Read the calls, pipeline, website and what is not connected in four separate passes, and show the work"
          className={`rounded-lg border px-2.5 py-2 text-[11px] ${
            deep
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-hairline text-ink-muted hover:bg-surface-strong'
          }`}
        >
          Deep run
        </button>
        {busy ? (
          <button
            type="button"
            onClick={stop}
            aria-label="Stop generating"
            className="rounded-lg border border-hairline px-2.5 py-2 text-[11px] text-ink-body hover:bg-surface-strong"
          >
            <Square className="size-3.5" />
          </button>
        ) : (
          <button
            type="button"
            disabled={!question.trim()}
            onClick={() => void ask(question)}
            aria-label="Send"
            className="portal-primary rounded-lg px-3 py-2 text-[11px] disabled:opacity-40"
          >
            <Send className="size-3.5" />
          </button>
        )}
      </div>

      {chats.length ? (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            History
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {chats.slice(0, 8).map((chat) => (
              <button
                key={chat.id}
                type="button"
                onClick={() => void openChat(chat.id)}
                className={`max-w-64 truncate rounded-lg border px-2.5 py-1 text-[11px] ${
                  chat.id === chatId
                    ? 'border-hairline bg-surface-strong'
                    : 'border-hairline bg-surface hover:bg-surface-strong'
                }`}
              >
                {chat.title}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

type LaneFinding = {
  specialist: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  evidence: string;
  doThis: string;
};

type TraceStep = {
  id: string;
  label: string;
  ms?: number;
  status: string;
  note?: string;
  findings?: LaneFinding[];
};

type Turn = {
  role: 'user' | 'assistant';
  content: string;
  grounded?: string[];
  streaming?: boolean;
  stopped?: boolean;
  error?: string;
  steps?: TraceStep[];
  laneSummary?: string;
};

/** What the answer rested on, in the reader's words rather than field names. */
function describeGrounding(grounded?: {
  observations: number;
  scanRun: string | null;
  missingSources: string[];
}) {
  if (!grounded) return undefined;
  const parts: string[] = [];
  if (grounded.observations)
    parts.push(`${grounded.observations} measured figures`);
  if (grounded.scanRun) parts.push(`website scan ${grounded.scanRun}`);
  if (grounded.missingSources.length)
    parts.push(`not connected: ${grounded.missingSources.join(', ')}`);
  return parts;
}

/**
 * Renders an answer's Markdown as elements.
 *
 * `lib/chat-markdown` parses to data and this turns that data into React
 * nodes, so nothing the model writes is ever interpreted as HTML. A plan with
 * seven numbered steps now reads as seven steps instead of one paragraph with
 * asterisks in it.
 */
function Markdown({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="space-y-2 leading-relaxed">
      {parseBlocks(text).map((block, index) => (
        <MarkdownBlock key={index} block={block} />
      ))}
    </div>
  );
}

function MarkdownBlock({ block }: { block: Block }) {
  if (block.kind === 'heading')
    return block.level === 2 ? (
      <p className="text-[13px] font-semibold">
        <Spans spans={block.spans} />
      </p>
    ) : (
      <p className="text-[12px] font-semibold">
        <Spans spans={block.spans} />
      </p>
    );
  if (block.kind === 'code')
    return (
      <pre className="overflow-x-auto rounded-lg border border-hairline bg-surface-muted p-2.5 text-[11px]">
        <code>{block.text}</code>
      </pre>
    );
  if (block.kind === 'list')
    return block.ordered ? (
      <ol className="ml-4 list-decimal space-y-1">
        {block.items.map((item, index) => (
          <li key={index}>
            <Spans spans={item} />
          </li>
        ))}
      </ol>
    ) : (
      <ul className="ml-4 list-disc space-y-1">
        {block.items.map((item, index) => (
          <li key={index}>
            <Spans spans={item} />
          </li>
        ))}
      </ul>
    );
  return (
    <p>
      <Spans spans={block.spans} />
    </p>
  );
}

function Spans({ spans }: { spans: Inline[] }) {
  return (
    <>
      {spans.map((span, index) => {
        if (span.kind === 'bold')
          return (
            <strong key={index} className="font-semibold">
              {span.text}
            </strong>
          );
        if (span.kind === 'code')
          return (
            <code
              key={index}
              className="rounded border border-hairline bg-surface-muted px-1 py-0.5 text-[11px]"
            >
              {span.text}
            </code>
          );
        return <span key={index}>{span.text}</span>;
      })}
    </>
  );
}

/**
 * What the manager actually did, while it is doing it.
 *
 * Every row here is a step that really ran, with the time it really took: the
 * evidence read, then one row per specialist lane. A lane that was skipped
 * says why, and a lane whose answer could not be used says that too rather
 * than showing a reassuring "0 findings" — those two look identical on a
 * progress bar and mean opposite things.
 */
function RunTrace({
  steps,
  summary,
}: {
  steps: TraceStep[];
  summary?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const lanes = steps.filter((step) => step.findings !== undefined);
  const plain = steps.filter((step) => step.findings === undefined);

  return (
    <div className="mb-2.5 rounded-lg border border-hairline bg-surface-muted/60 p-2.5">
      {plain.map((step) => (
        <p
          key={step.id}
          className="flex items-baseline gap-2 text-[11px] text-ink-muted"
        >
          <span className="text-success-text">✓</span>
          <span className="flex-1">{step.label}</span>
          {typeof step.ms === 'number' ? (
            <span className="font-mono text-[11px]">{step.ms}ms</span>
          ) : null}
        </p>
      ))}

      {lanes.length ? (
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {lanes.map((lane) => {
            const found = lane.findings ?? [];
            const high = found.filter(
              (finding) => finding.severity === 'high',
            ).length;
            return (
              <div
                key={lane.id}
                className={`rounded-lg border p-2 ${
                  lane.status === 'skipped' || lane.status === 'unusable'
                    ? 'border-hairline bg-surface/60'
                    : 'border-hairline bg-surface'
                }`}
              >
                <div className="flex items-baseline gap-2">
                  <p className="flex-1 text-[11px] font-medium">{lane.label}</p>
                  {typeof lane.ms === 'number' ? (
                    <span className="font-mono text-[11px] text-ink-muted">
                      {lane.ms}ms
                    </span>
                  ) : null}
                </div>
                {found.length ? (
                  <button
                    type="button"
                    onClick={() => setOpen(open === lane.id ? null : lane.id)}
                    className="mt-1 text-[11px] text-primary underline-offset-2 hover:underline"
                  >
                    {found.length} finding{found.length === 1 ? '' : 's'}
                    {high ? ` · ${high} high` : ''}
                  </button>
                ) : (
                  <p className="mt-1 text-[11px] text-ink-muted">
                    {lane.note ?? 'Nothing here.'}
                  </p>
                )}
                {open === lane.id ? (
                  <ul className="mt-1.5 space-y-1.5">
                    {found.map((finding, index) => (
                      <li key={index} className="text-[11px]">
                        <span
                          className={
                            finding.severity === 'high'
                              ? 'font-medium text-warning-text'
                              : 'font-medium'
                          }
                        >
                          {finding.title}
                        </span>
                        <span className="block text-ink-muted">
                          from: {finding.evidence}
                        </span>
                        {finding.doThis ? (
                          <span className="block text-ink-body">
                            → {finding.doThis}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {summary ? (
        <p className="mt-2 text-[11px] font-medium text-ink-body">{summary}</p>
      ) : null}
    </div>
  );
}
