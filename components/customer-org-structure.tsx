'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SUPPORTED_LANGUAGES } from '@/lib/languages';

/**
 * Branches, teams, shifts, per-number routing and contacts (§5-6).
 * Shift rows show whether they are covering right now, so "why did nobody
 * pick this up" is answerable from the screen rather than by guessing.
 */

type Row = Record<string, unknown>;
type OrgData = {
  branches: Row[];
  departments: Row[];
  teams: Row[];
  shifts: Row[];
  numberRoutes: Row[];
  numbers: Row[];
  contacts: Row[];
  routeTypes: string[];
  offHoursActions: string[];
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

export function CustomerOrgStructure() {
  const [data, setData] = useState<OrgData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [agents, setAgents] = useState<Row[]>([]);
  const [queues, setQueues] = useState<Row[]>([]);
  const [voiceAgents, setVoiceAgents] = useState<Row[]>([]);

  const load = useCallback(async () => {
    try {
      const [orgResponse, queueResponse, agentResponse] = await Promise.all([
        fetch('/api/app/org'),
        fetch('/api/app/queues'),
        fetch('/api/app/agents'),
      ]);
      const body = (await orgResponse.json()) as OrgData & { error?: string };
      if (!orgResponse.ok) {
        setError(str(body.error, 'Could not load the org structure.'));
        return;
      }
      setData(body);
      setError(null);
      if (queueResponse.ok) {
        const queueBody = (await queueResponse.json()) as {
          agents?: Row[];
          queues?: Row[];
        };
        setAgents(queueBody.agents ?? []);
        setQueues(queueBody.queues ?? []);
      }
      if (agentResponse.ok) {
        const agentBody = (await agentResponse.json()) as {
          agents?: Row[];
          items?: Row[];
        };
        setVoiceAgents(agentBody.agents ?? agentBody.items ?? []);
      }
    } catch {
      setError('Could not load the org structure.');
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function run(payload: Record<string, unknown>, success: string) {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch('/api/app/org', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setNotice(str(body.error, 'Action failed.'));
        return false;
      }
      await load();
      setNotice(success);
      return true;
    } catch {
      setNotice('Action failed.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error)
    return (
      <div className="flex items-center gap-2 text-[11px] text-white/45">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading org structure…
      </div>
    );
  if (error && !data)
    return <p className="text-[11px] text-rose-300">{error}</p>;
  const org = data!;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[9px] uppercase tracking-wider text-white/28">
          Workspace structure
        </p>
        <h1 className="mt-1 text-lg font-semibold">Org &amp; number routing</h1>
        <p className="mt-1 text-[11px] text-white/40">
          Branches, teams, working hours and which agent or queue each number
          reaches.
        </p>
      </div>
      {notice ? (
        <p className="rounded-lg border border-white/12 bg-white/[0.03] px-3 py-2 text-[11px] text-white/70">
          {notice}
        </p>
      ) : null}

      <BranchesAndTeams org={org} run={run} busy={busy} />
      <Shifts org={org} agents={agents} run={run} busy={busy} />
      <NumberRoutes
        org={org}
        queues={queues}
        voiceAgents={voiceAgents}
        run={run}
        busy={busy}
      />
      <Contacts org={org} run={run} busy={busy} />
    </div>
  );
}

type RunFn = (
  payload: Record<string, unknown>,
  success: string,
) => Promise<boolean>;

function Panel({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/8 bg-white/[0.02] p-5">
      <h2 className="text-[11px] font-semibold text-white/75">{title}</h2>
      {hint ? <p className="mt-1 text-[10px] text-white/32">{hint}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-[11px] outline-none focus:border-white/25"
    />
  );
}

function BranchesAndTeams({
  org,
  run,
  busy,
}: {
  org: OrgData;
  run: RunFn;
  busy: boolean;
}) {
  const [branch, setBranch] = useState({ name: '', city: '' });
  const [team, setTeam] = useState({ name: '', branchId: '' });
  return (
    <Panel
      title="Branches and teams"
      hint="Group agents by office and function so routing and reporting can follow the real organisation."
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <div>
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="Branch name"
              value={branch.name}
              onChange={(event) =>
                setBranch({ ...branch, name: event.target.value })
              }
            />
            <Input
              placeholder="City"
              value={branch.city}
              onChange={(event) =>
                setBranch({ ...branch, city: event.target.value })
              }
            />
            <Button
              className="portal-primary"
              disabled={busy || !branch.name.trim()}
              onClick={async () => {
                const ok = await run(
                  { action: 'create_branch', ...branch },
                  'Branch added.',
                );
                if (ok) setBranch({ name: '', city: '' });
              }}
            >
              Add branch
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            {org.branches.length === 0 ? (
              <p className="text-[11px] text-white/35">No branches yet.</p>
            ) : null}
            {org.branches.map((row) => (
              <div
                key={str(row.id)}
                className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 text-[11px]"
              >
                <span className="font-medium">{str(row.name)}</span>
                <span className="text-white/35">{str(row.city, '—')}</span>
                <span className="ml-auto text-[9px] text-white/32">
                  {str(row.agent_count, '0')} agents
                </span>
                <button
                  type="button"
                  aria-label="Delete branch"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      { action: 'delete_branch', branchId: str(row.id) },
                      'Branch removed.',
                    )
                  }
                  className="text-white/30 transition hover:text-rose-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="Team name"
              value={team.name}
              onChange={(event) =>
                setTeam({ ...team, name: event.target.value })
              }
            />
            <select
              value={team.branchId}
              onChange={(event) =>
                setTeam({ ...team, branchId: event.target.value })
              }
            >
              <option value="">No branch</option>
              {org.branches.map((row) => (
                <option key={str(row.id)} value={str(row.id)}>
                  {str(row.name)}
                </option>
              ))}
            </select>
            <Button
              className="portal-primary"
              disabled={busy || !team.name.trim()}
              onClick={async () => {
                const ok = await run(
                  { action: 'create_team', ...team },
                  'Team added.',
                );
                if (ok) setTeam({ name: '', branchId: '' });
              }}
            >
              Add team
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            {org.teams.length === 0 ? (
              <p className="text-[11px] text-white/35">No teams yet.</p>
            ) : null}
            {org.teams.map((row) => (
              <div
                key={str(row.id)}
                className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 text-[11px]"
              >
                <span className="font-medium">{str(row.name)}</span>
                <span className="text-white/35">
                  {str(row.branch_name, 'unassigned')}
                </span>
                <span className="ml-auto text-[9px] text-white/32">
                  {str(row.member_count, '0')} members
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function Shifts({
  org,
  agents,
  run,
  busy,
}: {
  org: OrgData;
  agents: Row[];
  run: RunFn;
  busy: boolean;
}) {
  const [form, setForm] = useState({
    supportAgentId: '',
    start: '09:00',
    end: '18:00',
    breakStart: '',
    breakEnd: '',
    days: [1, 2, 3, 4, 5] as number[],
  });
  const toggleDay = (day: number) =>
    setForm({
      ...form,
      days: form.days.includes(day)
        ? form.days.filter((item) => item !== day)
        : [...form.days, day].sort((a, b) => a - b),
    });
  return (
    <Panel
      title="Working hours"
      hint="Routing skips an agent outside their shift or on a break, even if they left themselves marked online."
    >
      <div className="flex flex-wrap items-end gap-2">
        <select
          value={form.supportAgentId}
          onChange={(event) =>
            setForm({ ...form, supportAgentId: event.target.value })
          }
        >
          <option value="">Choose an agent…</option>
          {agents.map((row) => (
            <option key={str(row.id)} value={str(row.id)}>
              {str(row.name)}
            </option>
          ))}
        </select>
        <Input
          type="time"
          value={form.start}
          onChange={(event) => setForm({ ...form, start: event.target.value })}
        />
        <Input
          type="time"
          value={form.end}
          onChange={(event) => setForm({ ...form, end: event.target.value })}
        />
        <Input
          type="time"
          placeholder="Break start"
          value={form.breakStart}
          onChange={(event) =>
            setForm({ ...form, breakStart: event.target.value })
          }
        />
        <Input
          type="time"
          placeholder="Break end"
          value={form.breakEnd}
          onChange={(event) =>
            setForm({ ...form, breakEnd: event.target.value })
          }
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {DAY_LABELS.map((label, day) => (
          <button
            key={label}
            type="button"
            onClick={() => toggleDay(day)}
            className={`rounded-md border px-2.5 py-1 text-[10px] transition ${
              form.days.includes(day)
                ? 'border-emerald-400/40 bg-emerald-400/12 text-emerald-100'
                : 'border-white/10 text-white/45 hover:text-white/75'
            }`}
          >
            {label}
          </button>
        ))}
        <Button
          className="portal-primary ml-auto"
          disabled={busy || !form.supportAgentId || !form.days.length}
          onClick={() =>
            void run({ action: 'create_shift', ...form }, 'Shift added.')
          }
        >
          Add shift
        </Button>
      </div>

      <div className="mt-4 space-y-2">
        {org.shifts.length === 0 ? (
          <p className="text-[11px] text-white/35">
            No shifts configured, so every agent is treated as always available.
          </p>
        ) : null}
        {org.shifts.map((row) => {
          const days = Array.isArray(row.days)
            ? (row.days as number[])
            : ([] as number[]);
          const covering = row.covering_now === true;
          return (
            <div
              key={str(row.id)}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 text-[11px]"
            >
              <span className="font-medium">{str(row.agent_name)}</span>
              <span className="text-white/55">
                {str(row.start_label)}–{str(row.end_label)}
              </span>
              <span className="text-[9px] text-white/32">
                {days.map((day) => DAY_LABELS[day]).join(' ')}
              </span>
              {row.break_start_minute !== null ? (
                <span className="text-[9px] text-white/32">with break</span>
              ) : null}
              <span
                className={`ml-auto rounded-md px-2 py-0.5 text-[9px] uppercase tracking-wide ${
                  covering
                    ? 'bg-emerald-400/12 text-emerald-200'
                    : 'bg-white/6 text-white/40'
                }`}
              >
                {covering
                  ? 'covering now'
                  : str(row.coverage_reason).replaceAll('_', ' ')}
              </span>
              <button
                type="button"
                aria-label="Delete shift"
                disabled={busy}
                onClick={() =>
                  void run(
                    { action: 'delete_shift', shiftId: str(row.id) },
                    'Shift removed.',
                  )
                }
                className="text-white/30 transition hover:text-rose-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function NumberRoutes({
  org,
  queues,
  voiceAgents,
  run,
  busy,
}: {
  org: OrgData;
  queues: Row[];
  voiceAgents: Row[];
  run: RunFn;
  busy: boolean;
}) {
  const [form, setForm] = useState({
    numberId: '',
    routeType: 'reception',
    target: '',
    offHoursAction: 'voicemail',
    priority: 100,
  });
  const targetPayload = () => {
    if (form.target.startsWith('queue:'))
      return { queueId: form.target.slice(6) };
    if (form.target.startsWith('agent:'))
      return { agentId: form.target.slice(6) };
    return {};
  };
  return (
    <Panel
      title="Number routing"
      hint="Each number can reach a different voice agent or queue. Without a route, a number is only a free-text label."
    >
      <div className="flex flex-wrap items-end gap-2">
        <select
          value={form.numberId}
          onChange={(event) =>
            setForm({ ...form, numberId: event.target.value })
          }
        >
          <option value="">Choose a number…</option>
          {org.numbers.map((row) => (
            <option key={str(row.id)} value={str(row.id)}>
              {str(row.phone_number)}
            </option>
          ))}
        </select>
        <select
          value={form.routeType}
          onChange={(event) =>
            setForm({ ...form, routeType: event.target.value })
          }
        >
          {org.routeTypes.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          value={form.target}
          onChange={(event) => setForm({ ...form, target: event.target.value })}
        >
          <option value="">Route to…</option>
          <optgroup label="Queues">
            {queues.map((row) => (
              <option key={str(row.id)} value={`queue:${str(row.id)}`}>
                {str(row.name)}
              </option>
            ))}
          </optgroup>
          <optgroup label="Voice agents">
            {voiceAgents.map((row) => (
              <option key={str(row.id)} value={`agent:${str(row.id)}`}>
                {str(row.name)}
              </option>
            ))}
          </optgroup>
        </select>
        <select
          value={form.offHoursAction}
          onChange={(event) =>
            setForm({ ...form, offHoursAction: event.target.value })
          }
        >
          {org.offHoursActions.map((item) => (
            <option key={item} value={item}>
              off hours: {item}
            </option>
          ))}
        </select>
        <Button
          className="portal-primary"
          disabled={busy || !form.numberId || !form.target}
          onClick={async () => {
            const ok = await run(
              {
                action: 'create_number_route',
                numberId: form.numberId,
                routeType: form.routeType,
                offHoursAction: form.offHoursAction,
                priority: form.priority,
                ...targetPayload(),
              },
              'Route added.',
            );
            if (ok) setForm({ ...form, target: '' });
          }}
        >
          Add route
        </Button>
      </div>

      <div className="mt-4 space-y-2">
        {org.numberRoutes.length === 0 ? (
          <p className="text-[11px] text-white/35">
            No number routes yet. Inbound calls have nowhere defined to go.
          </p>
        ) : null}
        {org.numberRoutes.map((row) => (
          <div
            key={str(row.id)}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 text-[11px]"
          >
            <span className="font-mono text-[10px]">
              {str(row.phone_number)}
            </span>
            <span className="rounded-md bg-white/6 px-2 py-0.5 text-[9px] uppercase tracking-wide text-white/55">
              {str(row.route_type)}
            </span>
            <span className="text-white/70">
              →{' '}
              {str(row.queue_slug) ||
                str(row.agent_name) ||
                str(row.campaign_name, 'nothing')}
            </span>
            <span className="text-[9px] text-white/32">
              off hours: {str(row.off_hours_action)}
            </span>
            <button
              type="button"
              aria-label="Delete route"
              disabled={busy}
              onClick={() =>
                void run(
                  { action: 'delete_number_route', routeId: str(row.id) },
                  'Route removed.',
                )
              }
              className="ml-auto text-white/30 transition hover:text-rose-300"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Contacts({
  org,
  run,
  busy,
}: {
  org: OrgData;
  run: RunFn;
  busy: boolean;
}) {
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    preferredLanguage: '',
  });
  return (
    <Panel
      title="Contacts"
      hint="A person can exist here without being a sales lead — support callers, past customers, anyone you may call back."
    >
      <div className="flex flex-wrap items-end gap-2">
        <Input
          placeholder="Full name"
          value={form.fullName}
          onChange={(event) =>
            setForm({ ...form, fullName: event.target.value })
          }
        />
        <Input
          placeholder="+919876543210"
          value={form.phone}
          onChange={(event) => setForm({ ...form, phone: event.target.value })}
        />
        <select
          value={form.preferredLanguage}
          onChange={(event) =>
            setForm({ ...form, preferredLanguage: event.target.value })
          }
        >
          <option value="">Preferred language…</option>
          {SUPPORTED_LANGUAGES.map((item) => (
            <option key={item.code} value={item.code}>
              {item.label}
            </option>
          ))}
        </select>
        <Button
          className="portal-primary"
          disabled={busy || !form.phone.trim()}
          onClick={async () => {
            const ok = await run(
              { action: 'upsert_contact', ...form },
              'Contact saved.',
            );
            if (ok) setForm({ fullName: '', phone: '', preferredLanguage: '' });
          }}
        >
          Save contact
        </Button>
      </div>
      <div className="mt-4 space-y-2">
        {org.contacts.length === 0 ? (
          <p className="text-[11px] text-white/35">No contacts yet.</p>
        ) : null}
        {org.contacts.slice(0, 25).map((row) => (
          <div
            key={str(row.id)}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 text-[11px]"
          >
            <span className="font-medium">
              {str(row.full_name, 'Unnamed contact')}
            </span>
            <span className="font-mono text-[10px] text-white/45">
              {str(row.phone)}
            </span>
            {str(row.preferred_language) ? (
              <span className="text-[9px] text-white/32">
                {str(row.preferred_language)}
              </span>
            ) : null}
            <span className="ml-auto text-[9px] text-white/28">
              {str(row.lead_id) ? 'linked to a lead' : 'contact only'}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
