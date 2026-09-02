'use client';

import { useEffect, useState } from 'react';
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

type Callback = {
  id: string;
  customer_name: string | null;
  customer_phone: string;
  reason: string | null;
  requested_window: string | null;
  status: string;
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
  low: 'border-emerald-300/20 bg-emerald-300/8 text-emerald-200',
  medium: 'border-amber-300/20 bg-amber-300/8 text-amber-200',
  high: 'border-orange-400/20 bg-orange-400/8 text-orange-200',
  restricted: 'border-red-400/25 bg-red-400/10 text-red-200',
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
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [callbacks, setCallbacks] = useState<Callback[]>([]);
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

  async function load() {
    try {
      const response = await fetch('/api/app/approvals', { cache: 'no-store' });
      const payload = (await response.json()) as {
        approvals?: Approval[];
        handoffs?: Handoff[];
        agents?: AgentRow[];
        callbacks?: Callback[];
        refunds?: Refund[];
        myRole?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? 'Unable to load.');
      setApprovals(payload.approvals ?? []);
      setHandoffs(payload.handoffs ?? []);
      setAgents(payload.agents ?? []);
      setCallbacks(payload.callbacks ?? []);
      setRefunds(payload.refunds ?? []);
      setMyRole(payload.myRole ?? 'support_agent');
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

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
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#afbcff]">
          Approvals & human handoff
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">
          Manager approval console
        </h2>
        <p className="mt-2 max-w-2xl text-xs text-white/45">
          The AI never decides money actions. The policy engine classifies each
          request and anything above the AI&apos;s authority arrives here for a
          human decision. Your authority:{' '}
          <span className="font-medium text-white/70">{myRole}</span>.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2 text-[11px] text-red-200">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="text-[11px] font-medium text-emerald-300">{notice}</p>
      ) : null}

      {/* Agent presence / queues */}
      <div className="portal-panel p-4">
        <div className="flex items-center gap-2">
          <Headphones className="size-3.5 text-[#afbcff]" />
          <p className="text-sm font-medium">Agent presence</p>
        </div>
        <p className="mt-1 text-[10px] text-white/38">
          Routing picks an online agent by skill, then language, then least busy.
          With nobody online the AI offers a callback instead of pretending to
          transfer.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="rounded-xl border border-white/8 bg-white/[0.02] p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{agent.name}</p>
                  <p className="mt-0.5 text-[9px] text-white/38">
                    {agent.role} · {parseList(agent.skills_json).join(', ') || 'no skills'}{' '}
                    · {parseList(agent.languages_json).join('/')} ·{' '}
                    {agent.active_calls} active
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={`text-[9px] ${agent.availability === 'online' ? 'border-emerald-300/20 bg-emerald-300/8 text-emerald-200' : 'border-white/10 text-white/45'}`}
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
                    className={`rounded-full border px-2 py-0.5 text-[9px] transition ${agent.availability === state ? 'border-white/20 bg-white/12 text-white' : 'border-white/8 text-white/45 hover:bg-white/5'}`}
                  >
                    {state}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {!agents.length && !loading ? (
            <p className="text-[11px] text-white/40">
              No support agents yet. Add agents to enable live transfer.
            </p>
          ) : null}
        </div>
      </div>

      {/* Pending approval cards */}
      <div>
        <p className="mb-2 text-xs font-medium text-white/70">
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
                      <ShieldAlert className="size-3.5 text-amber-200" />
                      <p className="text-sm font-medium">
                        {card.action} ·{' '}
                        {card.amount
                          ? `₹${card.amount.toLocaleString('en-IN')}`
                          : 'no amount'}
                      </p>
                    </div>
                    <p className="mt-1 text-[11px] text-white/55">
                      {card.case_summary || card.reason || 'No summary given.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge
                      variant="outline"
                      className={`text-[9px] ${RISK_STYLE[card.risk_level] ?? 'border-white/10 text-white/50'}`}
                    >
                      risk: {card.risk_level}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="border-white/10 text-[9px] text-white/55"
                    >
                      {card.policy_decision}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="border-white/10 text-[9px] text-white/40"
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
                  className="mt-3 h-9 border-white/10 bg-black/30 text-xs"
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
                      if (ok) flash('Approved ✓ — refund recorded, awaiting provider');
                    }}
                    className="h-8 bg-emerald-400/90 text-[10px] text-black hover:bg-emerald-400"
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
                    className="h-8 border-red-400/25 bg-transparent text-[10px] text-red-200"
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
                    className="h-8 border-white/12 bg-transparent text-[10px]"
                  >
                    Ask AI for more info
                  </Button>
                </div>
              </div>
            );
          })}
          {!pending.length && !loading ? (
            <p className="text-[11px] text-white/40">
              Nothing waiting for a human decision.
            </p>
          ) : null}
        </div>
      </div>

      {/* Handoff queue */}
      <div className="portal-panel p-4">
        <div className="flex items-center gap-2">
          <PhoneForwarded className="size-3.5 text-[#afbcff]" />
          <p className="text-sm font-medium">Handoff queue</p>
        </div>
        <div className="mt-3 space-y-2">
          {handoffs.slice(0, 8).map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/7 bg-white/[0.02] px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-[11px] text-white/70">
                  {row.reason}
                </p>
                <p className="mt-0.5 text-[9px] text-white/35">
                  {row.skill ? `skill: ${row.skill} · ` : ''}
                  {row.agent_name
                    ? `assigned: ${row.agent_name} (${row.agent_role})`
                    : 'waiting in queue'}
                </p>
              </div>
              <Badge
                variant="outline"
                className={`text-[9px] ${row.queue_status === 'assigned' ? 'border-emerald-300/20 bg-emerald-300/8 text-emerald-200' : 'border-amber-300/20 bg-amber-300/8 text-amber-200'}`}
              >
                {row.queue_status ?? row.status}
              </Badge>
            </div>
          ))}
          {!handoffs.length && !loading ? (
            <p className="text-[11px] text-white/40">No handoffs yet.</p>
          ) : null}
        </div>
      </div>

      {/* Refund + callback audit */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="portal-panel p-4">
          <p className="text-sm font-medium">Refund audit</p>
          <div className="mt-3 space-y-2">
            {refunds.map((row) => (
              <div key={row.id} className="text-[11px] text-white/60">
                ₹{row.amount.toLocaleString('en-IN')} ·{' '}
                {row.order_reference ?? 'no reference'} ·{' '}
                <span
                  className={
                    row.confirmed_at ? 'text-emerald-300' : 'text-amber-200'
                  }
                >
                  {row.status}
                  {row.confirmed_at ? '' : ' (awaiting provider)'}
                </span>
                <span className="text-white/30">
                  {' '}
                  · policy v{row.policy_version} · {row.authorised_by}
                </span>
              </div>
            ))}
            {!refunds.length && !loading ? (
              <p className="text-[11px] text-white/40">No refunds yet.</p>
            ) : null}
          </div>
        </div>
        <div className="portal-panel p-4">
          <p className="text-sm font-medium">Callbacks promised</p>
          <div className="mt-3 space-y-2">
            {callbacks.map((row) => (
              <div key={row.id} className="text-[11px] text-white/60">
                {row.customer_phone}
                {row.requested_window ? ` · ${row.requested_window}` : ''} ·{' '}
                <span className="text-amber-200">{row.status}</span>
              </div>
            ))}
            {!callbacks.length && !loading ? (
              <p className="text-[11px] text-white/40">No callbacks pending.</p>
            ) : null}
          </div>
        </div>
      </div>

      {history.length ? (
        <div className="portal-panel p-4">
          <p className="text-sm font-medium">Decision history</p>
          <div className="mt-3 space-y-1.5">
            {history.slice(0, 10).map((row) => (
              <p key={row.id} className="text-[11px] text-white/55">
                {row.action} ₹{row.amount ?? 0} ·{' '}
                <span
                  className={
                    row.status === 'approved'
                      ? 'text-emerald-300'
                      : row.status === 'rejected'
                        ? 'text-red-300'
                        : 'text-amber-200'
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
    <div className="rounded-lg border border-white/7 bg-white/[0.02] p-2.5">
      <p className="text-[9px] uppercase tracking-wider text-white/32">
        {label}
      </p>
      <p className="mt-1 text-[10px] text-white/60">{children}</p>
    </div>
  );
}
