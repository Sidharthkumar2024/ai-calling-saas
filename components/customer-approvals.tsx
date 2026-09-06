'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNotifications } from '@/components/notification-center';
import { newlyArrived } from '@/lib/notifications';
import { withheldLabel } from '@/lib/whatsapp-media';
import {
  BadgeCheck,
  Headphones,
  Loader2,
  PhoneForwarded,
  ShieldAlert,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  CALLBACK_LABEL,
  nextCallbackStatuses,
  type CallbackStatus,
} from '@/lib/callbacks';

type Approval = {
  id: string;
  action: string;
  amount: number | null;
  currency: string;
  reason: string | null;
  case_summary: string | null;
  evidence_json: string;
  risk_level: string;
  policy_decision: string;
  policy_version: number;
  policy_reasons_json: string;
  ai_recommendation: string | null;
  status: string;
  decided_by: string | null;
  decision_reason: string | null;
  created_at: string;
};

type Handoff = {
  id: string;
  reason: string;
  ai_summary: string | null;
  skill: string | null;
  language: string | null;
  queue_status: string | null;
  status: string;
  agent_name: string | null;
  agent_role: string | null;
  created_at: string;
};

type AgentRow = {
  id: string;
  name: string;
  role: string;
  skills_json: string;
  languages_json: string;
  availability: string;
  active_calls: number;
};

type Refund = {
  id: string;
  order_reference: string | null;
  amount: number;
  status: string;
  reason: string | null;
  policy_version: number;
  authorised_by: string | null;
  confirmed_at: string | null;
};

const RISK_STYLE: Record<string, string> = {
  low: 'border-emerald-300/20 bg-emerald-300/8 text-success-text',
  medium: 'border-amber-300/20 bg-amber-300/8 text-warning-text',
  high: 'border-orange-400/20 bg-orange-400/8 text-warning-text',
  restricted: 'border-red-400/25 bg-red-400/10 text-danger-text',
};

function parseList(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

export function CustomerApprovals() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const { notify } = useNotifications();
  const seenHandoffs = useRef<Set<string> | null>(null);
  const acceptedHandoffs = useRef<Set<string> | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [myRole, setMyRole] = useState('support_agent');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reasons, setReasons] = useState<Record<string, string>>({});

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3000);
  }

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/app/approvals', { cache: 'no-store' });
      const payload = (await response.json()) as {
        approvals?: Approval[];
        handoffs?: Handoff[];
        agents?: AgentRow[];
        refunds?: Refund[];
        myRole?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? 'Unable to load.');
      setApprovals(payload.approvals ?? []);
      const incoming = payload.handoffs ?? [];
      // §33: a caller asking for a person appeared silently in a list that
      // repolls, so nobody learned about it unless they were already watching
      // this screen. Edge-triggered — the queue is not news, an arrival is.
      const waiting = incoming
        .filter((row) => row.status !== 'closed' && row.status !== 'completed')
        .map((row) => row.id);
      const arrived = newlyArrived(seenHandoffs.current, waiting);
      if (arrived?.length)
        notify({
          event: 'handoff_requested',
          // The handoff's own id is §3.2's single event ID: two people with
          // this screen open see one notification between them, not two.
          subject: arrived[0],
          scope: 'workspace',
          detail:
            arrived.length === 1
              ? 'One caller is waiting for a person.'
              : `${arrived.length} callers are waiting for a person.`,
        });
      const accepted = incoming
        .filter((row) => row.status === 'accepted')
        .map((row) => row.id);
      const newlyAccepted = newlyArrived(acceptedHandoffs.current, accepted);
      if (newlyAccepted?.length) notify({ event: 'transfer_accepted' });
      seenHandoffs.current = new Set(waiting);
      acceptedHandoffs.current = new Set(accepted);
      setHandoffs(incoming);
      setAgents(payload.agents ?? []);
      setRefunds(payload.refunds ?? []);
      setMyRole(payload.myRole ?? 'support_agent');
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load.');
    } finally {
      setLoading(false);
    }
    // `notify` is memoised by the provider, so this stays a stable identity and
    // the poll below does not restart on every render.
  }, [notify]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function send(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setError('');
    try {
      const response = await fetch('/api/app/approvals', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        error?: string;
        required?: string;
      };
      if (!response.ok)
        throw new Error(
          payload.error === 'insufficient_authority'
            ? `Your role cannot authorise a ${payload.required} action.`
            : (payload.error ?? 'Request failed.'),
        );
      await load();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed.');
      return false;
    } finally {
      setBusy('');
    }
  }

  const pending = approvals.filter((item) => item.status === 'pending');
  const history = approvals.filter((item) => item.status !== 'pending');

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
          Approvals & human handoff
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">
          Manager approval console
        </h2>
        <p className="mt-2 max-w-2xl text-xs text-ink-muted">
          The AI never decides money actions. The policy engine classifies each
          request and anything above the AI&apos;s authority arrives here for a
          human decision. Your authority:{' '}
          <span className="font-medium text-ink">{myRole}</span>.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2 text-[11px] text-danger-text">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="text-[11px] font-medium text-success-text">{notice}</p>
      ) : null}

      {/* Agent presence / queues */}
      <div className="portal-panel p-4">
        <div className="flex items-center gap-2">
          <Headphones className="size-3.5 text-primary" />
          <p className="text-sm font-medium">Agent presence</p>
        </div>
        <p className="mt-1 text-[11px] text-ink-muted">
          Routing picks an online agent by skill, then language, then least
          busy. With nobody online the AI offers a callback instead of
          pretending to transfer.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="rounded-xl border border-hairline bg-surface-muted p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{agent.name}</p>
                  <p className="mt-0.5 text-[11px] text-ink-muted">
                    {agent.role} ·{' '}
                    {parseList(agent.skills_json).join(', ') || 'no skills'} ·{' '}
                    {parseList(agent.languages_json).join('/')} ·{' '}
                    {agent.active_calls} active
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={`text-[11px] ${agent.availability === 'online' ? 'border-emerald-300/20 bg-emerald-300/8 text-success-text' : 'border-hairline text-ink-muted'}`}
                >
                  {agent.availability}
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {['online', 'busy', 'break', 'offline'].map((state) => (
                  <button
                    key={state}
                    type="button"
                    disabled={busy === `${agent.id}:${state}`}
                    onClick={async () => {
                      const ok = await send(
                        {
                          action: 'set_presence',
                          agentId: agent.id,
                          availability: state,
                        },
                        `${agent.id}:${state}`,
                      );
                      if (ok) flash(`${agent.name} → ${state}`);
                    }}
                    className={`rounded-full border px-2 py-0.5 text-[11px] transition ${agent.availability === state ? 'border-hairline bg-surface-strong text-ink' : 'border-hairline text-ink-muted hover:bg-surface-strong'}`}
                  >
                    {state}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {!agents.length && !loading ? (
            <p className="text-[11px] text-ink-muted">
              No support agents yet. Add agents to enable live transfer.
            </p>
          ) : null}
        </div>
      </div>

      {/* Pending approval cards */}
      <div>
        <p className="mb-2 text-xs font-medium text-ink">
          Pending approvals ({pending.length})
        </p>
        <div className="grid gap-3">
          {pending.map((card) => {
            const evidence = (() => {
              try {
                return JSON.parse(card.evidence_json || '{}') as Record<
                  string,
                  unknown
                >;
              } catch {
                return {};
              }
            })();
            return (
              <div key={card.id} className="portal-panel p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="size-3.5 text-warning-text" />
                      <p className="text-sm font-medium">
                        {card.action} ·{' '}
                        {card.amount
                          ? `₹${card.amount.toLocaleString('en-IN')}`
                          : 'no amount'}
                      </p>
                    </div>
                    <p className="mt-1 text-[11px] text-ink-body">
                      {card.case_summary || card.reason || 'No summary given.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge
                      variant="outline"
                      className={`text-[11px] ${RISK_STYLE[card.risk_level] ?? 'border-hairline text-ink-body'}`}
                    >
                      risk: {card.risk_level}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="border-hairline text-[11px] text-ink-body"
                    >
                      {card.policy_decision}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="border-hairline text-[11px] text-ink-muted"
                    >
                      policy v{card.policy_version}
                    </Badge>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Detail label="Policy result">
                    {parseList(card.policy_reasons_json).join(', ') || '—'}
                  </Detail>
                  <Detail label="Evidence">
                    {Object.entries(evidence)
                      .filter(([, value]) => Boolean(value))
                      .map(([key, value]) => `${key}: ${String(value)}`)
                      .join(' · ') || '—'}
                  </Detail>
                </div>

                <Input
                  value={reasons[card.id] ?? ''}
                  onChange={(event) =>
                    setReasons((current) => ({
                      ...current,
                      [card.id]: event.target.value,
                    }))
                  }
                  placeholder="Decision reason (recorded in the audit trail)"
                  className="mt-3 h-9 border-hairline bg-surface-muted text-xs"
                />

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    disabled={busy === `${card.id}:approved`}
                    onClick={async () => {
                      const ok = await send(
                        {
                          action: 'decide',
                          approvalId: card.id,
                          outcome: 'approved',
                          reason: reasons[card.id] ?? null,
                        },
                        `${card.id}:approved`,
                      );
                      if (ok)
                        flash(
                          'Approved ✓ — refund recorded, awaiting provider',
                        );
                    }}
                    className="h-8 bg-emerald-400/90 text-[11px] text-black hover:bg-emerald-400"
                  >
                    {busy === `${card.id}:approved` ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <BadgeCheck />
                    )}{' '}
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy === `${card.id}:rejected`}
                    onClick={async () => {
                      const ok = await send(
                        {
                          action: 'decide',
                          approvalId: card.id,
                          outcome: 'rejected',
                          reason: reasons[card.id] ?? null,
                        },
                        `${card.id}:rejected`,
                      );
                      if (ok) flash('Rejected');
                    }}
                    className="h-8 border-red-400/25 bg-transparent text-[11px] text-danger-text"
                  >
                    <X /> Reject
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy === `${card.id}:info_requested`}
                    onClick={async () => {
                      const ok = await send(
                        {
                          action: 'decide',
                          approvalId: card.id,
                          outcome: 'info_requested',
                          reason: reasons[card.id] ?? null,
                        },
                        `${card.id}:info_requested`,
                      );
                      if (ok) flash('Asked the AI to collect more information');
                    }}
                    className="h-8 border-hairline bg-transparent text-[11px]"
                  >
                    Ask AI for more info
                  </Button>
                </div>
              </div>
            );
          })}
          {!pending.length && !loading ? (
            <p className="text-[11px] text-ink-muted">
              Nothing waiting for a human decision.
            </p>
          ) : null}
        </div>
      </div>

      {/* Handoff queue */}
      <div className="portal-panel p-4">
        <div className="flex items-center gap-2">
          <PhoneForwarded className="size-3.5 text-primary" />
          <p className="text-sm font-medium">Handoff queue</p>
        </div>
        <div className="mt-3 space-y-2">
          {handoffs.slice(0, 8).map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-hairline bg-surface-muted px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-[11px] text-ink">{row.reason}</p>
                <p className="mt-0.5 text-[11px] text-ink-muted">
                  {row.skill ? `skill: ${row.skill} · ` : ''}
                  {row.agent_name
                    ? `assigned: ${row.agent_name} (${row.agent_role})`
                    : 'waiting in queue'}
                </p>
              </div>
              <Badge
                variant="outline"
                className={`text-[11px] ${row.queue_status === 'assigned' ? 'border-emerald-300/20 bg-emerald-300/8 text-success-text' : 'border-amber-300/20 bg-amber-300/8 text-warning-text'}`}
              >
                {row.queue_status ?? row.status}
              </Badge>
            </div>
          ))}
          {!handoffs.length && !loading ? (
            <p className="text-[11px] text-ink-muted">No handoffs yet.</p>
          ) : null}
        </div>
      </div>

      {/* Refund + callback audit */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="portal-panel p-4">
          <p className="text-sm font-medium">Refund audit</p>
          <div className="mt-3 space-y-2">
            {refunds.map((row) => (
              <div key={row.id} className="text-[11px] text-ink-body">
                ₹{row.amount.toLocaleString('en-IN')} ·{' '}
                {row.order_reference ?? 'no reference'} ·{' '}
                <span
                  className={
                    row.confirmed_at ? 'text-success-text' : 'text-warning-text'
                  }
                >
                  {row.status}
                  {row.confirmed_at ? '' : ' (awaiting provider)'}
                </span>
                <span className="text-ink-muted">
                  {' '}
                  · policy v{row.policy_version} · {row.authorised_by}
                </span>
              </div>
            ))}
            {!refunds.length && !loading ? (
              <p className="text-[11px] text-ink-muted">No refunds yet.</p>
            ) : null}
          </div>
        </div>
        <CallbackQueue />
      </div>

      <MediaReleaseQueue />

      {history.length ? (
        <div className="portal-panel p-4">
          <p className="text-sm font-medium">Decision history</p>
          <div className="mt-3 space-y-1.5">
            {history.slice(0, 10).map((row) => (
              <p key={row.id} className="text-[11px] text-ink-body">
                {row.action} ₹{row.amount ?? 0} ·{' '}
                <span
                  className={
                    row.status === 'approved'
                      ? 'text-success-text'
                      : row.status === 'rejected'
                        ? 'text-danger-text'
                        : 'text-warning-text'
                  }
                >
                  {row.status}
                </span>
                {row.decision_reason ? ` · ${row.decision_reason}` : ''}
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-hairline bg-surface-muted p-2.5">
      <p className="text-[11px] uppercase tracking-wider text-ink-muted">
        {label}
      </p>
      <p className="mt-1 text-[11px] text-ink-body">{children}</p>
    </div>
  );
}

/**
 * The callback queue.
 *
 * This was a read-only list of phone numbers and the word "pending", which is
 * where the problem lived: a callback is a promise somebody made out loud to a
 * customer, and there was no way to say it had been kept.
 *
 * Three things the screen insists on.
 *
 * Late is shown, not sorted away. A promise past its time is the top of the
 * list with how far past it is, because that is the person the business owes
 * most — not the one who called a minute ago.
 *
 * "No answer" is offered as its own outcome and puts the callback back in the
 * queue. Dialling is not reaching, and a single "done" button is how a queue
 * gets cleared without anybody being called.
 *
 * And nothing can be marked reached that was not first claimed, so the list
 * cannot be tidied away in one pass.
 */
function CallbackQueue() {
  const [rows, setRows] = useState<QueueCallback[]>([]);
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/app/callbacks');
    if (!response.ok) return;
    const payload = (await response.json()) as {
      callbacks: QueueCallback[];
      summary: string;
    };
    setRows(payload.callbacks ?? []);
    setSummary(payload.summary ?? '');
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function move(callbackId: string, status: CallbackStatus) {
    setBusy(callbackId + status);
    setProblem(null);
    try {
      const note =
        status === 'unreachable' || status === 'completed'
          ? (window.prompt(
              status === 'unreachable'
                ? 'What happened? (optional)'
                : 'What did you agree? (optional)',
            ) ?? undefined)
          : undefined;
      const response = await fetch('/api/app/callbacks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ callbackId, status, note }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        reason?: string;
      };
      if (!payload.ok) setProblem(payload.reason ?? 'That change was refused.');
      else await load();
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="portal-panel p-4">
      <p className="text-sm font-medium">Callbacks promised</p>
      <p className="mt-1 text-[11px] text-ink-muted">{summary}</p>
      {problem ? (
        <p role="alert" className="mt-2 text-[11px] text-danger-text">
          {problem}
        </p>
      ) : null}
      <div className="mt-3 space-y-2">
        {rows.map((row) => (
          <div
            key={row.id}
            className={`rounded-lg border px-2.5 py-2 ${
              row.lateness?.late
                ? 'border-warning-text/40 bg-surface-muted'
                : 'border-hairline bg-surface'
            }`}
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-[11px] font-medium">
                {row.customer_name || row.customer_phone}
              </span>
              <span className="text-[11px] text-ink-muted">
                {row.customer_phone}
                {row.requested_window ? ` · ${row.requested_window}` : ''}
              </span>
              <span
                className={`ml-auto text-[11px] ${
                  row.status === 'completed'
                    ? 'text-success-text'
                    : row.status === 'cancelled'
                      ? 'text-ink-muted'
                      : 'text-warning-text'
                }`}
              >
                {CALLBACK_LABEL[row.status] ?? row.status}
                {row.attempts > 0
                  ? ` · ${row.attempts} ${row.attempts === 1 ? 'try' : 'tries'}`
                  : ''}
              </span>
            </div>
            {row.reason ? (
              <p className="mt-0.5 text-[11px] text-ink-body">{row.reason}</p>
            ) : null}
            {/* How far past the promise, at the top of the row rather than
                implied by position. */}
            {row.lateness?.late ? (
              <p className="mt-0.5 text-[11px] text-warning-text">
                {row.lateness.message}
              </p>
            ) : null}
            {row.outcome_note ? (
              <p className="mt-0.5 text-[11px] text-ink-muted">
                {row.outcome_note}
              </p>
            ) : null}
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {nextCallbackStatuses(row.status).map((next) => (
                <button
                  key={next}
                  type="button"
                  disabled={busy === row.id + next}
                  onClick={() => void move(row.id, next)}
                  className="rounded-full border border-hairline px-2.5 py-1 text-[11px] disabled:opacity-50"
                >
                  {next === 'in_progress'
                    ? row.attempts > 0
                      ? 'Try again'
                      : 'Start calling'
                    : next === 'completed'
                      ? 'Reached them'
                      : next === 'unreachable'
                        ? 'No answer'
                        : 'Cancel'}
                </button>
              ))}
              {nextCallbackStatuses(row.status).length === 0 ? (
                <span className="text-[11px] text-ink-muted">
                  Closed{row.resolved_by ? ` by ${row.resolved_by}` : ''}.
                </span>
              ) : null}
            </div>
          </div>
        ))}
        {rows.length === 0 ? (
          <p className="text-[11px] text-ink-muted">
            Nothing promised yet. A callback lands here the moment an agent
            tells somebody they will be rung back.
          </p>
        ) : null}
      </div>
    </div>
  );
}

type QueueCallback = {
  id: string;
  customer_name: string | null;
  customer_phone: string;
  reason: string | null;
  requested_window: string | null;
  status: CallbackStatus;
  attempts: number;
  outcome_note: string | null;
  resolved_by: string | null;
  lateness?: { late: boolean; message: string };
};

type SendRow = {
  id: string;
  destination: string;
  status: string;
  createdAt: string;
  sent: Array<{ id: string; label: string }>;
  withheld: Array<{ id: string; label?: string; reason: string }>;
  summary: string;
};

/**
 * Media an agent was refused, waiting for a person.
 *
 * The send policy holds files back and the agent tells the caller "a colleague
 * will send the rest". There was no colleague: the `whatsapp_sends` row was
 * written by the tool and read by nothing, so a promise made out loud on a
 * call had no way of ever being kept. This is that colleague.
 */
function MediaReleaseQueue() {
  const [sends, setSends] = useState<SendRow[]>([]);
  const [pendingFiles, setPendingFiles] = useState(0);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/app/media-sends');
    if (!response.ok) return;
    const payload = (await response.json()) as {
      sends: SendRow[];
      pendingFiles: number;
    };
    setSends(payload.sends);
    setPendingFiles(payload.pendingFiles);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function post(body: Record<string, unknown>) {
    setProblem(null);
    const response = await fetch('/api/app/media-sends', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      reason?: string;
      unavailable?: Array<{ id: string; reason: string }>;
    };
    if (!payload.ok) {
      setProblem(payload.reason ?? 'That release was refused.');
      return;
    }
    // A partial success is said out loud rather than looking like a clean one:
    // some files resolve and some no longer exist on the listing.
    if (payload.unavailable?.length) setProblem(payload.unavailable[0].reason);
    setChosen({});
    await load();
  }

  const waiting = sends.filter(
    (row) => row.withheld.length > 0 && row.status !== 'cancelled',
  );

  return (
    <div className="portal-panel p-4">
      <p className="text-sm font-medium">Files waiting to be released</p>
      <p className="mt-1 max-w-2xl text-[11px] text-ink-muted">
        An agent asked to send these and was not allowed to on its own, so it
        told the caller a colleague would.{' '}
        {pendingFiles > 0
          ? `${pendingFiles} ${pendingFiles === 1 ? 'file is' : 'files are'} still owed.`
          : 'Nothing is owed right now.'}
      </p>
      {problem ? (
        <p role="alert" className="mt-2 text-[11px] text-danger-text">
          {problem}
        </p>
      ) : null}

      <div className="mt-3 space-y-2">
        {waiting.length === 0 ? (
          <p className="text-[11px] text-ink-muted">
            Nothing waiting. Held-back files appear here the moment an agent is
            refused one on a call.
          </p>
        ) : null}
        {waiting.map((row) => (
          <div
            key={row.id}
            className="rounded-lg border border-hairline bg-surface px-3 py-2.5"
          >
            <p className="text-[11px] text-ink-body">{row.summary}</p>
            <div className="mt-2 space-y-1">
              {row.withheld.map((entry) => (
                <label
                  key={entry.id}
                  className="flex items-start gap-2 text-[11px] text-ink-muted"
                >
                  <input
                    type="checkbox"
                    checked={chosen[entry.id] ?? false}
                    onChange={(event) =>
                      setChosen((current) => ({
                        ...current,
                        [entry.id]: event.target.checked,
                      }))
                    }
                    className="mt-0.5"
                  />
                  <span>
                    <span className="text-ink-body">
                      {withheldLabel(entry)}
                    </span>
                    {' — '}
                    {entry.reason}
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={!row.withheld.some((entry) => chosen[entry.id])}
                onClick={() =>
                  void post({
                    action: 'release',
                    sendId: row.id,
                    assetIds: row.withheld
                      .filter((entry) => chosen[entry.id])
                      .map((entry) => entry.id),
                  })
                }
                className="portal-primary h-6 rounded-md px-2 text-[11px] disabled:opacity-40"
              >
                Release chosen
              </button>
              <button
                type="button"
                onClick={() => void post({ action: 'cancel', sendId: row.id })}
                className="h-6 rounded-md border border-hairline px-2 text-[11px] text-ink-muted"
              >
                Do not send
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
