'use client';

import { useCallback, useEffect, useState } from 'react';

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
      await fetch('/api/app/growth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'save_discovery', answers }),
      });
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (error)
    return (
      <p role="alert" className="text-[11px] text-danger-text">
        {error}
      </p>
    );
  if (!board) return null;

  const byId = new Map(board.observations.map((item) => [item.id, item]));

  return (
    <div className="space-y-6">
      <section className="portal-panel p-5">
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

      <GrowthChat
        chips={board.chips ?? []}
        suggestedGoal={board.suggestedGoal ?? ''}
        chats={board.chats ?? []}
        onDone={load}
      />

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
        <p key={action.id} className="mt-1 text-[11px] text-ink-muted">
          {actionSummary(action)} {action.detail}
        </p>
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
  const [turns, setTurns] = useState<
    Array<{ role: string; content: string; grounded?: string[] }>
  >([]);
  const [busy, setBusy] = useState(false);

  async function ask(text: string) {
    const asked = text.trim();
    if (!asked) return;
    setBusy(true);
    setQuestion('');
    setTurns((current) => [...current, { role: 'user', content: asked }]);
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
        setTurns((current) => [
          ...current,
          {
            role: 'assistant',
            content: body.error ?? 'That did not go through.',
          },
        ]);
        return;
      }
      if (body.chatId) setChatId(body.chatId);
      const grounded: string[] = [];
      if (body.groundedOn?.observations)
        grounded.push(`${body.groundedOn.observations} measured figures`);
      if (body.groundedOn?.scanRun)
        grounded.push(`website scan ${body.groundedOn.scanRun}`);
      if (body.groundedOn?.missingSources.length)
        grounded.push(
          `not connected: ${body.groundedOn.missingSources.join(', ')}`,
        );
      setTurns((current) => [
        ...current,
        { role: 'assistant', content: body.answer ?? '', grounded },
      ]);
      await onDone();
    } catch {
      setTurns((current) => [
        ...current,
        { role: 'assistant', content: 'That did not go through.' },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function openChat(id: string) {
    const response = await fetch(
      `/api/app/growth?chat=${encodeURIComponent(id)}`,
      {
        cache: 'no-store',
      },
    );
    const body = (await response.json()) as {
      messages?: Array<{ role: string; content: string }>;
    };
    setChatId(id);
    setTurns(body.messages ?? []);
  }

  return (
    <section className="portal-panel p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">What should I grow today?</h2>
        {turns.length ? (
          <button
            type="button"
            onClick={() => {
              setChatId(null);
              setTurns([]);
            }}
            className="text-[11px] text-ink-body underline-offset-2 hover:underline"
          >
            New chat
          </button>
        ) : null}
      </div>

      {chips.length ? (
        <>
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Your workspace
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <span
                key={chip.id}
                className="rounded-full border border-hairline bg-surface-muted px-2.5 py-1 text-[11px]"
              >
                <span className="text-ink-muted">{chip.label} </span>
                <span className="font-medium">{chip.value}</span>
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-ink-muted">
            I use this to direct every run — no need to repeat it.
          </p>
        </>
      ) : (
        <p className="mt-3 text-[11px] text-ink-muted">
          Answer the discovery questions below and I will use them to direct
          every answer.
        </p>
      )}

      <div className="mt-4 space-y-2">
        {turns.map((turn, index) => (
          <div
            key={`${turn.role}-${index}`}
            className={
              turn.role === 'user'
                ? 'ml-auto max-w-[80%] rounded-xl bg-primary px-3 py-2 text-[11px] text-primary-foreground'
                : 'max-w-[90%] rounded-xl border border-hairline bg-surface-muted px-3 py-2 text-[11px]'
            }
          >
            <p className="whitespace-pre-wrap">{turn.content}</p>
            {turn.grounded?.length ? (
              <p className="mt-1.5 text-[11px] text-ink-muted">
                ↳ answered from {turn.grounded.join(' · ')}
              </p>
            ) : null}
          </div>
        ))}
        {busy ? <p className="text-[11px] text-ink-muted">Thinking…</p> : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) void ask(question);
          }}
          placeholder={
            suggestedGoal || 'Ask about your calls, leads or website'
          }
          aria-label="Ask the growth manager"
          className="h-9 flex-1 min-w-56 rounded-lg border border-hairline bg-surface px-3 text-[11px]"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void ask(question || suggestedGoal)}
          className="portal-primary rounded-lg px-4 py-2 text-[11px] disabled:opacity-60"
        >
          Ask
        </button>
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
