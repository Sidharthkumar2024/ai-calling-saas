'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SUPPORTED_LANGUAGES } from '@/lib/languages';
import { useT } from '@/components/locale-provider';

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
  const t = useT();
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
      const body = (await response.json()) as {
        error?: string;
        ok?: boolean;
        reason?: string;
        note?: string;
      };
      if (!response.ok) {
        setNotice(str(body.error, 'Action failed.'));
        return false;
      }
      // A refused archive comes back as a 200 carrying its reason — "this
      // branch is already archived" is an answer, not a server error — so the
      // status code alone is not enough to call this a success.
      if (body.ok === false) {
        setNotice(str(body.reason, 'Action failed.'));
        return false;
      }
      await load();
      // The note says what still points at an archived row. Worth reading:
      // archiving the only team an agent belongs to is a different act from
      // archiving an empty one.
      setNotice(body.note ? `${success} ${body.note}` : success);
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
      <div className="flex items-center gap-2 text-[11px] text-ink-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading org structure…
      </div>
    );
  if (error && !data)
    return <p className="text-[11px] text-danger-text">{error}</p>;
  const org = data!;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] uppercase tracking-wider text-ink-muted">
          {t('screen.org_structure.eyebrow')}
        </p>
        <h1 className="mt-1 text-lg font-semibold">
          {t('screen.org_structure.title')}
        </h1>
        <p className="mt-1 text-[11px] text-ink-muted">
          {t('screen.org_structure.description')}
        </p>
      </div>
      {notice ? (
        <p className="rounded-lg border border-hairline bg-surface-muted px-3 py-2 text-[11px] text-ink">
          {notice}
        </p>
      ) : null}

      <BranchesAndTeams org={org} run={run} busy={busy} />
      <Shifts org={org} agents={agents} run={run} busy={busy} />
      <AgentLanguages agents={agents} run={run} busy={busy} />
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
    <section className="rounded-2xl border border-hairline bg-surface-muted p-5">
      <h2 className="text-[11px] font-semibold text-ink">{title}</h2>
      {hint ? <p className="mt-1 text-[11px] text-ink-muted">{hint}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * Turn a piece of configuration off, or back on.
 *
 * This used to be a bin icon that ran a hard `DELETE`, on three of the seven
 * kinds and on none of the others. Archiving keeps the row, so an agent still
 * belongs to a team that was closed and a call still names the branch it was
 * taken at — and it works for the kinds that previously could not be removed
 * at all.
 */
function ArchiveControl({
  kind,
  id,
  status,
  run,
  busy,
}: {
  kind: string;
  id: string;
  status: string;
  run: RunFn;
  busy: boolean;
}) {
  const archived = status === 'archived';
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() =>
        void run(
          {
            action: archived ? 'restore_config' : 'archive_config',
            kind,
            id,
          },
          archived ? 'Restored.' : 'Archived.',
        )
      }
      className="text-[11px] text-ink-muted transition hover:text-ink-body"
    >
      {archived ? 'Restore' : 'Archive'}
    </button>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full rounded-lg border border-hairline bg-surface-strong px-3 py-2 text-[11px] outline-none focus:border-hairline"
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
  const t = useT();
  const [branch, setBranch] = useState({ name: '', city: '' });
  const [team, setTeam] = useState({ name: '', branchId: '' });
  // Departments were fetched by the API, typed in this component, and rendered
  // nowhere — so `create_department` was an action nothing could call.
  const [department, setDepartment] = useState({ name: '', code: '' });
  return (
    <Panel title={t('panel.branches.title')} hint={t('panel.branches.hint')}>
      <div className="grid gap-4 xl:grid-cols-2">
        <div>
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder={t('panel.branches.namePlaceholder')}
              value={branch.name}
              onChange={(event) =>
                setBranch({ ...branch, name: event.target.value })
              }
            />
            <Input
              placeholder={t('panel.branches.cityPlaceholder')}
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
              <p className="text-[11px] text-ink-muted">No branches yet.</p>
            ) : null}
            {org.branches.map((row) => (
              <div
                key={str(row.id)}
                className="flex items-center gap-2 rounded-xl border border-hairline bg-surface-muted px-3 py-2.5 text-[11px]"
              >
                <span
                  className={
                    str(row.status) === 'archived'
                      ? 'font-medium text-ink-muted line-through'
                      : 'font-medium'
                  }
                >
                  {str(row.name)}
                </span>
                <span className="text-ink-muted">{str(row.city, '—')}</span>
                <span className="ml-auto text-[11px] text-ink-muted">
                  {str(row.agent_count, '0')} agents
                </span>
                <ArchiveControl
                  kind="branch"
                  id={str(row.id)}
                  status={str(row.status)}
                  run={run}
                  busy={busy}
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder={t('panel.branches.teamPlaceholder')}
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
              <p className="text-[11px] text-ink-muted">No teams yet.</p>
            ) : null}
            {org.teams.map((row) => (
              <div
                key={str(row.id)}
                className="flex items-center gap-2 rounded-xl border border-hairline bg-surface-muted px-3 py-2.5 text-[11px]"
              >
                <span className="font-medium">{str(row.name)}</span>
                <span className="text-ink-muted">
                  {str(row.branch_name, 'unassigned')}
                </span>
                <span className="ml-auto text-[11px] text-ink-muted">
                  {str(row.member_count, '0')} members
                </span>
                <ArchiveControl
                  kind="team"
                  id={str(row.id)}
                  status={str(row.status)}
                  run={run}
                  busy={busy}
                />
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <Input
              placeholder="Department name"
              value={department.name}
              onChange={(event) =>
                setDepartment({ ...department, name: event.target.value })
              }
            />
            <Input
              placeholder="Code"
              value={department.code}
              onChange={(event) =>
                setDepartment({ ...department, code: event.target.value })
              }
            />
            <Button
              className="portal-primary"
              disabled={busy || !department.name.trim()}
              onClick={async () => {
                const ok = await run(
                  { action: 'create_department', ...department },
                  'Department added.',
                );
                if (ok) setDepartment({ name: '', code: '' });
              }}
            >
              Add department
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            {org.departments.length === 0 ? (
              <p className="text-[11px] text-ink-muted">No departments yet.</p>
            ) : null}
            {org.departments.map((row) => (
              <div
                key={str(row.id)}
                className="flex items-center gap-2 rounded-xl border border-hairline bg-surface-muted px-3 py-2.5 text-[11px]"
              >
                <span
                  className={
                    str(row.status) === 'archived'
                      ? 'font-medium text-ink-muted line-through'
                      : 'font-medium'
                  }
                >
                  {str(row.name)}
                </span>
                <span className="text-ink-muted">{str(row.code, '—')}</span>
                <span className="ml-auto">
                  <ArchiveControl
                    kind="department"
                    id={str(row.id)}
                    status={str(row.status)}
                    run={run}
                    busy={busy}
                  />
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
  const t = useT();
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
    <Panel title={t('panel.shifts.title')} hint={t('panel.shifts.hint')}>
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
          placeholder={t('panel.shifts.breakStart')}
          value={form.breakStart}
          onChange={(event) =>
            setForm({ ...form, breakStart: event.target.value })
          }
        />
        <Input
          type="time"
          placeholder={t('panel.shifts.breakEnd')}
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
            className={`rounded-md border px-2.5 py-1 text-[11px] transition ${
              form.days.includes(day)
                ? 'border-emerald-400/40 bg-emerald-400/12 text-success-text'
                : 'border-hairline text-ink-muted hover:text-ink'
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
          <p className="text-[11px] text-ink-muted">
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
              className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-surface-muted px-3 py-2.5 text-[11px]"
            >
              <span className="font-medium">{str(row.agent_name)}</span>
              <span className="text-ink-body">
                {str(row.start_label)}–{str(row.end_label)}
              </span>
              <span className="text-[11px] text-ink-muted">
                {days.map((day) => DAY_LABELS[day]).join(' ')}
              </span>
              {row.break_start_minute !== null ? (
                <span className="text-[11px] text-ink-muted">with break</span>
              ) : null}
              <span
                className={`ml-auto rounded-md px-2 py-0.5 text-[11px] uppercase tracking-wide ${
                  covering
                    ? 'bg-emerald-400/12 text-success-text'
                    : 'bg-surface-strong text-ink-muted'
                }`}
              >
                {covering
                  ? 'covering now'
                  : str(row.coverage_reason).replaceAll('_', ' ')}
              </span>
              <ArchiveControl
                kind="shift"
                id={str(row.id)}
                status={str(row.status)}
                run={run}
                busy={busy}
              />
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
  const t = useT();
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
      title={t('panel.numberRoutes.title')}
      hint={t('panel.numberRoutes.hint')}
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
          <optgroup label={t('field.queues')}>
            {queues.map((row) => (
              <option key={str(row.id)} value={`queue:${str(row.id)}`}>
                {str(row.name)}
              </option>
            ))}
          </optgroup>
          <optgroup label={t('field.voiceAgents')}>
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
          <p className="text-[11px] text-ink-muted">
            No number routes yet. Inbound calls have nowhere defined to go.
          </p>
        ) : null}
        {org.numberRoutes.map((row) => (
          <div
            key={str(row.id)}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-surface-muted px-3 py-2.5 text-[11px]"
          >
            <span className="font-mono text-[11px]">
              {str(row.phone_number)}
            </span>
            <span className="rounded-md bg-surface-strong px-2 py-0.5 text-[11px] uppercase tracking-wide text-ink-body">
              {str(row.route_type)}
            </span>
            <span className="text-ink">
              →{' '}
              {str(row.queue_slug) ||
                str(row.agent_name) ||
                str(row.campaign_name, 'nothing')}
            </span>
            <span className="text-[11px] text-ink-muted">
              off hours: {str(row.off_hours_action)}
            </span>
            <span className="ml-auto">
              <ArchiveControl
                kind="number_route"
                id={str(row.id)}
                status={str(row.status)}
                run={run}
                busy={busy}
              />
            </span>
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
  const t = useT();
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    preferredLanguage: '',
  });
  return (
    <Panel title={t('panel.contacts.title')} hint={t('panel.contacts.hint')}>
      <div className="flex flex-wrap items-end gap-2">
        <Input
          placeholder={t('panel.contacts.namePlaceholder')}
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
          <option value="">{t('panel.contacts.languagePlaceholder')}</option>
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
          <p className="text-[11px] text-ink-muted">No contacts yet.</p>
        ) : null}
        {org.contacts.slice(0, 25).map((row) => (
          <div
            key={str(row.id)}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-surface-muted px-3 py-2.5 text-[11px]"
          >
            <span className="font-medium">
              {str(row.full_name, 'Unnamed contact')}
            </span>
            <span className="font-mono text-[11px] text-ink-muted">
              {str(row.phone)}
            </span>
            {str(row.preferred_language) ? (
              <span className="text-[11px] text-ink-muted">
                {str(row.preferred_language)}
              </span>
            ) : null}
            <span className="ml-auto text-[11px] text-ink-muted">
              {str(row.lead_id) ? 'linked to a lead' : 'contact only'}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/**
 * Which languages each person on the desk can actually take a call in.
 *
 * Routing has read `languages_json` since it was written — a queue with a
 * language, or a rule matching one, looks for an agent who speaks it — and no
 * screen ever set it. Every agent's list was empty, so language routing had
 * nothing to match on and quietly fell through to whoever was free.
 *
 * The server keeps `agent_languages` and `languages_json` in step in one
 * action, because routing reads the second and reporting the first, and two
 * sources of truth that disagree is worse than one that is wrong.
 */
function AgentLanguages({
  agents,
  run,
  busy,
}: {
  agents: Row[];
  run: RunFn;
  busy: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);

  const spoken = (agent: Row): string[] => {
    const raw = agent.languages_json;
    if (typeof raw !== 'string') return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  };

  return (
    <section className="portal-panel p-5">
      <h2 className="text-sm font-semibold">Languages on the desk</h2>
      <p className="mt-1 text-[11px] text-ink-muted">
        A queue or rule that routes by language can only find someone who is
        listed here.
      </p>

      <div className="mt-4 space-y-2">
        {agents.length === 0 ? (
          <p className="text-[11px] text-ink-muted">
            No support agents in this workspace yet.
          </p>
        ) : null}
        {agents.map((agent) => {
          const id = str(agent.id);
          const languages = spoken(agent);
          const editing = open === id;
          return (
            <div
              key={id}
              className="rounded-xl border border-hairline bg-surface-muted px-3 py-2.5"
            >
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="font-medium">{str(agent.name)}</span>
                <span className="text-ink-muted">{str(agent.role, '—')}</span>
                <span className="ml-auto text-ink-muted">
                  {languages.length === 0
                    ? 'no languages set'
                    : languages
                        .map(
                          (code) =>
                            SUPPORTED_LANGUAGES.find(
                              (language) => language.code === code,
                            )?.label ?? code,
                        )
                        .join(', ')}
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(editing ? null : id)}
                  className="text-[11px] text-ink-muted hover:text-ink"
                >
                  {editing ? 'Close' : 'Change'}
                </button>
              </div>

              {editing ? (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {SUPPORTED_LANGUAGES.map((language) => {
                    const on = languages.includes(language.code);
                    return (
                      <button
                        key={language.code}
                        type="button"
                        disabled={busy}
                        // The whole set is sent every time, because that is
                        // what the server stores — a toggle that sent one code
                        // would silently drop the rest.
                        onClick={() =>
                          void run(
                            {
                              action: 'set_agent_languages',
                              supportAgentId: id,
                              languages: on
                                ? languages.filter(
                                    (code) => code !== language.code,
                                  )
                                : [...languages, language.code],
                            },
                            on
                              ? `${language.label} removed.`
                              : `${language.label} added.`,
                          )
                        }
                        className={`rounded-lg border px-2.5 py-1 text-[11px] transition ${
                          on
                            ? 'border-primary/40 bg-primary/10 text-primary'
                            : 'border-hairline text-ink-muted hover:bg-surface-strong'
                        }`}
                      >
                        {language.label}
                        <span className="ml-1 text-ink-muted">
                          {language.nativeName === language.label
                            ? ''
                            : language.nativeName}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
