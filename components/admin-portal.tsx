'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Coins,
  CreditCard,
  FileCheck2,
  Gauge,
  KeyRound,
  LifeBuoy,
  Loader2,
  Network,
  PackagePlus,
  PhoneCall,
  Radio,
  RefreshCcw,
  Save,
  ServerCog,
  SlidersHorizontal,
  ShieldCheck,
  UsersRound,
  WalletCards,
  Webhook,
} from 'lucide-react';

import { PortalShell, type PortalNavGroup } from '@/components/portal-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { ActivityAreaChart, QueueBars } from '@/components/analytics-charts';

type AdminSession = { name: string; email: string };

type AdminPayload = {
  stats?: Record<string, number>;
  revenue?: Record<string, number>;
  customers?: Record<string, unknown>[];
  plans?: Record<string, unknown>[];
  creditPackages?: Record<string, unknown>[];
  numbers?: Record<string, unknown>[];
  audits?: Record<string, unknown>[];
  integrations?: Record<string, unknown>[];
  commerce?: Record<string, unknown>[];
  system?: Record<string, string | number | null>;
  providerHealth?: Record<string, unknown>[];
  liveCalls?: Record<string, unknown>[];
  authProviders?: Record<string, unknown>[];
  platformProviders?: Record<string, unknown>[];
  providerKeys?: Record<string, unknown>[];
  tickets?: Record<string, unknown>[];
  ticketMessages?: Record<string, unknown>[];
  activitySeries?: Record<string, string | number>[];
  jobStats?: Record<string, string | number>[];
  providerCosts?: Record<string, unknown>[];
  compliance?: Record<string, number>;
  providerReadiness?: Record<string, unknown>[];
};

const groups: PortalNavGroup[] = [
  {
    label: 'Platform',
    items: [
      { id: 'overview', label: 'Command center', icon: Gauge },
      { id: 'customers', label: 'Customers', icon: Building2 },
      {
        id: 'call_ops',
        label: 'Call operations',
        icon: Radio,
      },
      { id: 'voice_engines', label: 'Voice engines', icon: Activity },
    ],
  },
  {
    label: 'Commercial',
    items: [
      { id: 'numbers_kyc', label: 'Numbers & KYC', icon: FileCheck2 },
      { id: 'plans_billing', label: 'Plans & billing', icon: CreditCard },
      {
        id: 'trials_commerce',
        label: 'Trials & commerce',
        icon: CircleDollarSign,
        badge: 'New',
      },
      { id: 'integrations', label: 'API & integrations', icon: Network },
      {
        id: 'platform_apis',
        label: 'Provider & auth config',
        icon: SlidersHorizontal,
      },
    ],
  },
  {
    label: 'Governance',
    items: [
      { id: 'system_audit', label: 'System & audit', icon: ShieldCheck },
      { id: 'support_tickets', label: 'Support tickets', icon: LifeBuoy },
    ],
  },
];

export function AdminPortal({ session }: { session: AdminSession }) {
  const [active, setActive] = useState('overview');
  const [data, setData] = useState<AdminPayload>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const loadedOnceRef = useRef(false);

  async function load() {
    // Only block the screen on the very first load. Later refreshes (after a
    // save) stay silent so the section is not unmounted — otherwise inline
    // success confirmations would be wiped out by the remount.
    const firstLoad = !loadedOnceRef.current;
    if (firstLoad) setLoading(true);
    setError('');
    try {
      const [response, platformResponse] = await Promise.all([
        fetch('/api/admin/overview', { cache: 'no-store' }),
        fetch('/api/admin/platform', { cache: 'no-store' }),
      ]);
      if (
        response.status === 401 ||
        response.status === 403 ||
        platformResponse.status === 401 ||
        platformResponse.status === 403
      ) {
        window.location.assign('/admin/login');
        return;
      }
      const payload = (await response.json()) as AdminPayload & {
        error?: string;
      };
      const platform = (await platformResponse.json()) as AdminPayload & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error || 'Unable to load admin data.');
      if (!platformResponse.ok)
        throw new Error(
          platform.error || 'Unable to load platform configuration.',
        );
      setData({ ...payload, ...platform });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to load admin data.',
      );
    } finally {
      loadedOnceRef.current = true;
      if (firstLoad) setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <PortalShell
      mode="admin"
      active={active}
      groups={groups}
      onNavigate={setActive}
      name={session.name}
      email={session.email}
    >
      <div className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error} retry={load} />
        ) : null}
        {!loading && !error && active === 'overview' ? (
          <AdminOverview data={data} onRefresh={load} onNavigate={setActive} />
        ) : null}
        {!loading && !error && active === 'customers' ? (
          <Customers data={data} />
        ) : null}
        {!loading && !error && active === 'call_ops' ? (
          <CallOperations data={data} />
        ) : null}
        {!loading && !error && active === 'voice_engines' ? (
          <VoiceEngines data={data} />
        ) : null}
        {!loading && !error && active === 'numbers_kyc' ? (
          <NumbersKyc data={data} onChanged={load} />
        ) : null}
        {!loading && !error && active === 'plans_billing' ? (
          <PlansBilling data={data} onChanged={load} />
        ) : null}
        {!loading && !error && active === 'trials_commerce' ? (
          <TrialsCommerce data={data} />
        ) : null}
        {!loading && !error && active === 'integrations' ? (
          <Integrations data={data} />
        ) : null}
        {!loading && !error && active === 'platform_apis' ? (
          <PlatformApis data={data} onChanged={load} />
        ) : null}
        {!loading && !error && active === 'system_audit' ? (
          <SystemAudit data={data} />
        ) : null}
        {!loading && !error && active === 'support_tickets' ? (
          <SupportDesk data={data} onChanged={load} />
        ) : null}
      </div>
    </PortalShell>
  );
}

function AdminOverview({
  data,
  onRefresh,
  onNavigate,
}: {
  data: AdminPayload;
  onRefresh: () => Promise<void>;
  onNavigate: (page: string) => void;
}) {
  const stats = data.stats ?? {};
  const revenue = data.revenue ?? {};
  const readiness = data.providerReadiness ?? [];
  const connectedProviders = readiness.filter((item) =>
    Boolean(item.configured),
  ).length;
  const attentionCount =
    Number(data.compliance?.pending_documents ?? stats.pending_kyc ?? 0) +
    Number(revenue.open_invoices ?? 0) +
    Number(stats.open_alerts ?? 0) +
    Number(stats.open_tickets ?? 0);
  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_78%_20%,rgba(125,211,252,0.13),transparent_32%),radial-gradient(circle_at_15%_0%,rgba(167,139,250,0.14),transparent_35%),linear-gradient(145deg,#10141d_0%,#090b10_58%,#0d1118_100%)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.28)] sm:p-7">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:linear-gradient(to_bottom,black,transparent_88%)]"
        />
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/15 bg-emerald-300/[0.055] px-3 py-1.5 text-[9px] font-medium uppercase tracking-[0.14em] text-emerald-200">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-300" />{' '}
                Core operational
              </span>
              <span className="text-[9px] uppercase tracking-[0.15em] text-white/28">
                Platform command center
              </span>
            </div>
            <h1 className="mt-5 max-w-3xl text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              Operate every tenant, call and rupee from one control room.
            </h1>
            <p className="mt-3 max-w-2xl text-xs leading-5 text-white/42 sm:text-sm">
              Live capacity, provider readiness, commercial health and
              compliance reviews—without exposing tenant conversations or
              infrastructure secrets.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => onNavigate('platform_apis')}
              className="border-white/12 bg-white/[0.035]"
            >
              <ServerCog /> Provider control
            </Button>
            <Button
              onClick={() => void onRefresh()}
              className="bg-white text-black hover:bg-white/90"
            >
              <RefreshCcw /> Refresh now
            </Button>
          </div>
        </div>
        <div className="relative mt-7 grid gap-px overflow-hidden rounded-2xl border border-white/8 bg-white/8 sm:grid-cols-2 xl:grid-cols-4">
          {[
            [
              'Live conversations',
              num(stats.live_calls),
              'PII-masked monitor',
              Radio,
              'text-emerald-300',
            ],
            [
              'Action queue',
              num(attentionCount),
              'Reviews and incidents',
              Clock3,
              'text-amber-200',
            ],
            [
              'Provider readiness',
              `${connectedProviders}/${readiness.length}`,
              'Live-capable adapters',
              Network,
              'text-cyan-200',
            ],
            [
              'Collected revenue',
              money(revenue.total),
              `${num(revenue.paid_invoices)} paid invoices`,
              WalletCards,
              'text-violet-200',
            ],
          ].map(([label, value, note, Icon, tone]) => (
            <div key={String(label)} className="bg-[#0b0e14]/90 p-4">
              <div className="flex items-center justify-between">
                <p className="text-[9px] uppercase tracking-[0.13em] text-white/28">
                  {String(label)}
                </p>
                <Icon className={`size-4 ${String(tone)}`} />
              </div>
              <p className="mt-3 text-xl font-semibold">{String(value)}</p>
              <p className="mt-1 text-[9px] text-white/28">{String(note)}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat
          label="Active customers"
          value={num(stats.customers)}
          note={`${num(stats.users)} active users`}
          icon={Building2}
        />
        <Stat
          label="Platform calls"
          value={num(stats.calls)}
          note={`${num(stats.recordings)} recordings`}
          icon={PhoneCall}
        />
        <Stat
          label="CRM leads"
          value={num(stats.leads)}
          note="Tenant-isolated records"
          icon={BarChart3}
        />
        <Stat
          label="Active numbers"
          value={num(stats.active_numbers)}
          note={`${num(stats.pending_kyc)} pending KYC`}
          icon={FileCheck2}
        />
        <Stat
          label="Open alerts"
          value={num(stats.open_alerts)}
          note={`${num(stats.open_tickets)} support tickets`}
          icon={ShieldCheck}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <Panel>
          <PanelHeader
            title="Network activity"
            description="14 days · calls, completed conversations and leads"
          />
          <ActivityAreaChart data={data.activitySeries ?? []} admin />
        </Panel>
        <Panel>
          <PanelHeader
            title="Provider readiness"
            description="Health, credentials and deployment gates"
          />
          <div className="mt-5 space-y-4">
            {[
              [
                'API & database',
                data.system?.database === 'operational'
                  ? `Operational${data.system?.databaseProbeMs ? ` · ${num(data.system.databaseProbeMs)} ms` : ''}`
                  : textValue(data.system?.database, 'Unknown'),
                data.system?.database === 'operational' ? 100 : 24,
              ],
              ...readiness
                .slice(0, 5)
                .map((item) => [
                  textValue(item.publicName),
                  item.configured ? 'Connected' : 'Credentials needed',
                  item.configured ? 100 : 24,
                ]),
            ].map(([label, status, progress]) => (
              <div key={String(label)}>
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="text-white/68">{String(label)}</span>
                  <span
                    className={
                      status === 'Operational' || status === 'Connected'
                        ? 'text-emerald-300'
                        : 'text-[#a8b7ff]'
                    }
                  >
                    {String(status)}
                  </span>
                </div>
                <Progress value={Number(progress)} className="h-1 bg-white/6" />
              </div>
            ))}
          </div>
          <button
            type="button"
            aria-label="Open provider configuration and latency controls"
            onClick={() => onNavigate('platform_apis')}
            className="mt-6 flex w-full items-center justify-between rounded-xl border border-white/8 bg-white/[0.025] p-4 text-left transition hover:bg-white/[0.045]"
          >
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] text-white/30">
                P95 conversation latency
              </p>
              <p className="mt-2 text-2xl font-semibold">
                {typeof data.system?.p95LatencyMs === 'number'
                  ? `${num(data.system.p95LatencyMs)} ms`
                  : 'Not measured'}
              </p>
              <p className="mt-1 text-[10px] text-white/40">
                {Number(data.system?.latencySampleSize ?? 0)
                  ? `Provider calls · last ${num(data.system?.latencySampleSize)} samples`
                  : 'No provider calls recorded yet'}
              </p>
            </div>
            <ArrowRight className="size-4 text-white/30" />
          </button>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_0.72fr_0.72fr]">
        <CustomersTable rows={(data.customers ?? []).slice(0, 6)} />
        <Panel>
          <PanelHeader
            title="Queue reliability"
            description="Durable jobs by current state"
          />
          <QueueBars data={data.jobStats ?? []} />
        </Panel>
        <Panel>
          <PanelHeader
            title="Operator queue"
            description="Items needing platform attention"
          />
          <div className="mt-3 divide-y divide-white/7">
            {[
              [
                'KYC review',
                `${num(data.compliance?.pending_documents ?? stats.pending_kyc)} submitted documents`,
                'Review',
                'numbers_kyc',
              ],
              [
                'Open invoices',
                `${num(revenue.open_invoices)} payment items`,
                'Inspect',
                'plans_billing',
              ],
              [
                'Provider gates',
                `${readiness.length - connectedProviders} adapters need credentials`,
                'Configure',
                'platform_apis',
              ],
              [
                'Support desk',
                `${num(stats.open_tickets)} tenant tickets`,
                'Open',
                'support_tickets',
              ],
            ].map(([title, note, action, target]) => (
              <div key={title} className="flex items-center gap-3 py-4">
                <span className="grid size-9 place-items-center rounded-xl bg-white/5">
                  <Clock3 className="size-4 text-white/45" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">{title}</p>
                  <p className="mt-1 text-[10px] text-white/35">{note}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onNavigate(target)}
                  className="border-white/10 bg-transparent text-[10px]"
                >
                  {action}
                </Button>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Customers({ data }: { data: AdminPayload }) {
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Tenant management"
        title="Customer accounts"
        description="Plan, wallet, numbers and lead volume stay scoped to each organization."
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Organizations"
          value={num(data.stats?.customers)}
          note="Active tenants"
          icon={Building2}
        />
        <Stat
          label="Customer users"
          value={num(data.stats?.users)}
          note="Owners and agents"
          icon={UsersRound}
        />
        <Stat
          label="CRM records"
          value={num(data.stats?.leads)}
          note="Tenant-isolated"
          icon={BarChart3}
        />
      </div>
      <TenantLifecycle />
      <CustomersTable rows={data.customers ?? []} />
    </div>
  );
}


/**
 * Tenant lifecycle. There was no admin API to create or suspend an
 * organization at all, and the portal's "Invite customer" button had no
 * handler — it was removed rather than left dead.
 */
function TenantLifecycle() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [adminRole, setAdminRole] = useState<string>('');
  const [form, setForm] = useState({ name: '', ownerEmail: '', ownerName: '' });
  const [reason, setReason] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/organizations');
      const body = (await response.json()) as {
        organizations?: Record<string, unknown>[];
        capabilities?: string[];
        adminRole?: string;
        error?: string;
      };
      if (!response.ok) {
        setNotice(body.error ?? 'Could not load organizations.');
        return;
      }
      setRows(body.organizations ?? []);
      setCapabilities(body.capabilities ?? []);
      setAdminRole(body.adminRole ?? '');
    } catch {
      setNotice('Could not load organizations.');
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function act(label: string, payload: Record<string, unknown>) {
    setBusy(label);
    setNotice(null);
    try {
      const response = await fetch('/api/admin/organizations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        setNotice(textValue(body.error, 'Action failed.'));
        return null;
      }
      await load();
      return body;
    } finally {
      setBusy(null);
    }
  }

  const canManage = capabilities.includes('tenants.manage');
  const canSuspend = capabilities.includes('tenants.suspend');

  return (
    <section className="rounded-2xl border border-white/8 bg-white/[0.02] p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[11px] font-semibold text-white/75">
            Create and suspend workspaces
          </h2>
          <p className="mt-1 text-[10px] text-white/32">
            Suspending pauses running campaigns, cancels queued jobs and blocks
            the workspace&apos;s API access immediately.
          </p>
        </div>
        {adminRole ? (
          <span className="rounded-md bg-white/6 px-2 py-1 text-[9px] uppercase tracking-wide text-white/50">
            your role: {adminRole.replaceAll('_', ' ')}
          </span>
        ) : null}
      </div>

      {notice ? (
        <p className="mt-3 rounded-lg border border-white/12 bg-white/[0.03] px-3 py-2 text-[11px] text-white/70">
          {notice}
        </p>
      ) : null}

      {canManage ? (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <input
            placeholder="Workspace name"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            className="rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-[11px] outline-none focus:border-white/25"
          />
          <input
            placeholder="Owner email"
            value={form.ownerEmail}
            onChange={(event) =>
              setForm({ ...form, ownerEmail: event.target.value })
            }
            className="rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-[11px] outline-none focus:border-white/25"
          />
          <input
            placeholder="Owner name"
            value={form.ownerName}
            onChange={(event) =>
              setForm({ ...form, ownerName: event.target.value })
            }
            className="rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-[11px] outline-none focus:border-white/25"
          />
          <Button
            disabled={busy === 'create' || !form.name || !form.ownerEmail}
            onClick={async () => {
              const created = await act('create', {
                action: 'create',
                ...form,
              });
              if (created) {
                setForm({ name: '', ownerEmail: '', ownerName: '' });
                setNotice(
                  `Created ${textValue(created.slug)}. Temporary password: ${textValue(
                    created.temporaryPassword,
                  )} — hand this over out of band; it is shown once.`,
                );
              }
            }}
          >
            Create workspace
          </Button>
        </div>
      ) : (
        <p className="mt-4 text-[11px] text-white/35">
          Your admin role cannot create workspaces.
        </p>
      )}

      <div className="mt-5 space-y-2">
        {rows.map((row) => {
          const id = String(row.id);
          const suspended = String(row.status) !== 'active';
          return (
            <div
              key={id}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 text-[11px]"
            >
              <span className="font-medium">{textValue(row.name)}</span>
              <span className="font-mono text-[9px] text-white/28">
                {textValue(row.slug)}
              </span>
              <span
                className={`rounded-md px-2 py-0.5 text-[9px] uppercase tracking-wide ${
                  suspended
                    ? 'bg-rose-400/12 text-rose-200'
                    : 'bg-emerald-400/12 text-emerald-200'
                }`}
              >
                {textValue(row.status)}
              </span>
              <span className="text-[9px] text-white/32">
                {textValue(row.plan_name, 'no plan')} · {num(row.users)} users ·{' '}
                {num(row.calls_30d)} calls/30d
              </span>
              {row.suspension_reason ? (
                <span className="text-[9px] text-rose-200/70">
                  {textValue(row.suspension_reason)}
                </span>
              ) : null}
              {canSuspend ? (
                suspended ? (
                  <Button
                    className="ml-auto"
                    disabled={busy === `on-${id}`}
                    onClick={() =>
                      void act(`on-${id}`, {
                        action: 'reactivate',
                        organizationId: id,
                      })
                    }
                  >
                    Reactivate
                  </Button>
                ) : (
                  <div className="ml-auto flex items-center gap-2">
                    <input
                      placeholder="Suspension reason"
                      value={reason[id] ?? ''}
                      onChange={(event) =>
                        setReason({ ...reason, [id]: event.target.value })
                      }
                      className="w-44 rounded-lg border border-white/10 bg-white/4 px-2.5 py-1.5 text-[10px] outline-none focus:border-white/25"
                    />
                    <Button
                      disabled={busy === `off-${id}` || !(reason[id] ?? '').trim()}
                      onClick={() =>
                        void act(`off-${id}`, {
                          action: 'suspend',
                          organizationId: id,
                          reason: reason[id],
                        })
                      }
                    >
                      Suspend
                    </Button>
                  </div>
                )
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CustomersTable({ rows }: { rows: Record<string, unknown>[] }) {
  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Customers"
        description="Current plan, credits and activity"
      />
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="border-y border-white/8 text-[9px] uppercase tracking-[0.13em] text-white/28">
            <tr>
              <th className="px-3 py-3 font-medium">Organization</th>
              <th className="px-3 py-3 font-medium">Plan</th>
              <th className="px-3 py-3 font-medium">Credits</th>
              <th className="px-3 py-3 font-medium">Leads</th>
              <th className="px-3 py-3 font-medium">Numbers</th>
              <th className="px-3 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/7">
            {rows.map((row) => (
              <tr key={String(row.id)} className="hover:bg-white/[0.025]">
                <td className="px-3 py-4">
                  <p className="font-medium">{textValue(row.name)}</p>
                  <p className="mt-1 text-[10px] text-white/32">
                    {textValue(row.owner_email, 'No owner')}
                  </p>
                </td>
                <td className="px-3 py-4 text-white/60">
                  {textValue(row.plan_name, 'Free')}
                </td>
                <td className="px-3 py-4 font-mono text-amber-200">
                  {num(row.balance)}
                </td>
                <td className="px-3 py-4 text-white/60">{num(row.leads)}</td>
                <td className="px-3 py-4 text-white/60">{num(row.numbers)}</td>
                <td className="px-3 py-4">
                  <Status value={textValue(row.status, 'active')} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function CallOperations({ data }: { data: AdminPayload }) {
  const calls = data.liveCalls ?? [];
  const live = calls.filter((row) => textValue(row.status) === 'in_progress');
  const system = data.system ?? {};
  const p95 = system.p95LatencyMs;
  const sampleSize = Number(system.latencySampleSize ?? 0);

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Call operations"
        title="Platform call activity"
        description="Every figure here is read from call records and provider telemetry. Nothing on this screen is estimated."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Live calls"
          value={num(data.stats?.live_calls ?? live.length)}
          note="status = in_progress"
          icon={Radio}
        />
        <Stat
          label="Recorded calls"
          value={num(data.stats?.calls)}
          note="all workspaces"
          icon={PhoneCall}
        />
        <Stat
          label="Queue depth"
          value={num(system.queueDepth)}
          note={
            Number(system.queueFailed ?? 0) > 0
              ? `${num(system.queueFailed)} failed`
              : 'no failed jobs'
          }
          icon={Gauge}
        />
        <Stat
          label="Provider p95 latency"
          value={typeof p95 === 'number' ? `${p95} ms` : 'Not measured'}
          note={
            sampleSize
              ? `last ${sampleSize} provider calls`
              : 'no provider calls recorded yet'
          }
          icon={Activity}
        />
      </div>

      <Panel>
        <PanelHeader
          title="Most recent calls"
          description="In-progress calls first. Blank cells mean the field was never captured for that call."
        />
        {calls.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="border-y border-white/8 text-[9px] uppercase tracking-wider text-white/32">
                <tr>
                  {[
                    'Workspace',
                    'Agent',
                    'To',
                    'Status',
                    'Outcome',
                    'Duration',
                    'Latency',
                  ].map((heading) => (
                    <th key={heading} className="px-3 py-3 font-medium">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {calls.map((row) => (
                  <tr key={textValue(row.id)} className="hover:bg-white/[0.025]">
                    <td className="px-3 py-3">
                      {textValue(row.organization_name)}
                    </td>
                    <td className="px-3 py-3 text-white/60">
                      {textValue(row.agent_name)}
                    </td>
                    <td className="px-3 py-3 font-mono text-[10px] text-white/55">
                      {textValue(row.to_number)}
                    </td>
                    <td className="px-3 py-3">
                      <Status value={textValue(row.status, 'unknown')} />
                    </td>
                    <td className="px-3 py-3 text-white/55">
                      {textValue(row.outcome)}
                    </td>
                    <td className="px-3 py-3 text-white/55">
                      {row.duration_seconds
                        ? `${num(row.duration_seconds)}s`
                        : '—'}
                    </td>
                    <td className="px-3 py-3 text-white/55">
                      {row.latency_ms ? `${num(row.latency_ms)} ms` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 text-xs text-white/40">
            No calls recorded yet. This screen fills in once calls run.
          </p>
        )}
      </Panel>
    </div>
  );
}

function VoiceEngines({ data }: { data: AdminPayload }) {
  const health = data.providerHealth ?? [];
  const readiness = data.providerReadiness ?? [];
  const readinessFor = (providerId: string) =>
    readiness.find(
      (entry) => `provider_${textValue(entry.adapter)}` === providerId,
    );

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Voice engines"
        title="Measured provider performance"
        description="Latency, volume and error rate come from recorded provider calls. Engines with no traffic are shown as unmeasured rather than healthy."
      />

      <Panel>
        <PanelHeader
          title="Provider readiness"
          description="Whether credentials are present, from the live configuration check."
        />
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {readiness.map((entry) => (
            <div
              key={textValue(entry.adapter)}
              className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.02] p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">
                  {textValue(entry.publicName)}
                </p>
                <p className="mt-1 text-[9px] text-white/32">
                  {textValue(entry.adapter)} ·{' '}
                  {entry.configured ? 'credentials present' : 'not configured'}
                </p>
              </div>
              <Status value={textValue(entry.mode, 'sandbox')} />
            </div>
          ))}
          {!readiness.length ? (
            <p className="text-xs text-white/40">No providers registered.</p>
          ) : null}
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Measured latency and volume"
          description="Sampled from the most recent provider calls."
        />
        {health.length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {health.map((entry) => {
              const providerId = textValue(entry.providerId);
              const ready = readinessFor(providerId);
              const errorRate = Number(entry.errorRate ?? 0);
              return (
                <div
                  key={providerId}
                  className="rounded-xl border border-white/8 bg-white/[0.02] p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {ready
                          ? textValue(ready.publicName)
                          : providerId.replace('provider_', '')}
                      </p>
                      <p className="mt-1 text-[9px] text-white/32">
                        {(entry.operations as string[] | undefined)?.join(' · ') ??
                          '—'}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[9px] ${errorRate > 0.05 ? 'border-red-400/25 bg-red-400/10 text-red-200' : 'border-emerald-300/20 bg-emerald-300/8 text-emerald-200'}`}
                    >
                      {(errorRate * 100).toFixed(1)}% errors
                    </Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-sm font-semibold">
                        {num(entry.calls)}
                      </p>
                      <p className="mt-1 text-[9px] text-white/32">calls</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold">
                        {num(entry.averageLatencyMs)}
                        <span className="text-[9px] text-white/40"> ms</span>
                      </p>
                      <p className="mt-1 text-[9px] text-white/32">average</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold">
                        {entry.p95LatencyMs
                          ? `${num(entry.p95LatencyMs)}`
                          : '—'}
                        <span className="text-[9px] text-white/40"> ms</span>
                      </p>
                      <p className="mt-1 text-[9px] text-white/32">p95</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-4 text-xs text-white/40">
            No provider calls recorded yet, so there is nothing to measure.
          </p>
        )}
      </Panel>

      {data.providerCosts?.length ? (
        <Panel>
          <PanelHeader
            title="Provider cost and margin"
            description="Recorded usage events by provider."
          />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-xs">
              <thead className="border-y border-white/8 text-[9px] uppercase tracking-wider text-white/32">
                <tr>
                  {['Provider', 'Category', 'Events', 'Cost', 'Billed credits'].map(
                    (heading) => (
                      <th key={heading} className="px-3 py-3 font-medium">
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.providerCosts.map((row, index) => (
                  <tr key={`${textValue(row.provider_id)}-${index}`}>
                    <td className="px-3 py-3">{textValue(row.provider_id)}</td>
                    <td className="px-3 py-3 text-white/55">
                      {textValue(row.category)}
                    </td>
                    <td className="px-3 py-3 text-white/55">
                      {num(row.events ?? row.event_count)}
                    </td>
                    <td className="px-3 py-3 text-white/55">
                      {num(row.provider_cost_micros ?? row.cost_micros)}
                    </td>
                    <td className="px-3 py-3 text-white/55">
                      {num(row.billed_credits)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function NumbersKyc({
  data,
  onChanged,
}: {
  data: AdminPayload;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function review(numberId: string, status: 'approved' | 'rejected') {
    setBusy(numberId);
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/admin/platform', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'kyc_status', numberId, status }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(payload.error || 'Unable to update KYC status.');
      setMessage(
        status === 'approved'
          ? 'KYC approved and the number route is active.'
          : 'Changes requested from the customer.',
      );
      await onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to update KYC status.',
      );
    } finally {
      setBusy('');
    }
  }
  const providerRoutes = new Set(
    (data.numbers ?? []).map((item) => textValue(item.provider_code, 'auto')),
  ).size;
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Telephony governance"
        title="Number activation and KYC review"
        description="Review managed numbers, native carrier imports and SIP routes with an auditable ownership-to-activation flow."
      />
      {message ? (
        <div className="rounded-xl border border-emerald-300/15 bg-emerald-300/[0.035] p-3 text-xs text-emerald-100">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-red-300/15 bg-red-300/[0.035] p-3 text-xs text-red-100">
          {error}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Active numbers"
          value={num(data.stats?.active_numbers)}
          note="Dedicated caller identities"
          icon={PhoneCall}
        />
        <Stat
          label="Pending KYC"
          value={num(data.stats?.pending_kyc)}
          note="Review or resubmission"
          icon={FileCheck2}
        />
        <Stat
          label="Submitted documents"
          value={num(data.compliance?.pending_documents)}
          note="Private object storage"
          icon={ShieldCheck}
        />
        <Stat
          label="Provider routes"
          value={num(providerRoutes)}
          note="Native import and SIP"
          icon={Network}
        />
      </div>
      <Panel className="overflow-hidden">
        <PanelHeader
          title="Activation queue"
          description="Approve only after ownership, business purpose and provider routing checks pass"
        />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left text-xs">
            <thead className="border-y border-white/8 text-[9px] uppercase tracking-[0.13em] text-white/28">
              <tr>
                {[
                  'Number',
                  'Customer',
                  'Provider path',
                  'Use case',
                  'Volume',
                  'Docs',
                  'KYC',
                  'Onboarding',
                  'Decision',
                ].map((h) => (
                  <th key={h} className="px-3 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/7">
              {(data.numbers ?? []).map((row) => (
                <tr key={String(row.id)}>
                  <td className="px-3 py-4 font-mono">
                    {textValue(row.phone_number)}
                  </td>
                  <td className="px-3 py-4 text-white/62">
                    {textValue(row.organization_name)}
                  </td>
                  <td className="px-3 py-4 text-white/48">
                    <p className="capitalize">
                      {textValue(row.provider_code, 'auto')}
                    </p>
                    <p className="mt-1 text-[9px] text-white/25">
                      {textValue(
                        row.connection_mode,
                        textValue(row.acquisition_type),
                      ).replaceAll('_', ' ')}
                    </p>
                  </td>
                  <td className="max-w-48 px-3 py-4 text-white/48">
                    {textValue(row.business_use_case)}
                  </td>
                  <td className="px-3 py-4 text-white/48">
                    {num(row.estimated_monthly_minutes)} min
                  </td>
                  <td className="px-3 py-4 text-white/48">
                    {num(row.kyc_document_count)}
                  </td>
                  <td className="px-3 py-4">
                    <Status value={textValue(row.kyc_status)} />
                  </td>
                  <td className="px-3 py-4">
                    <Status
                      value={textValue(
                        row.onboarding_status,
                        textValue(row.status),
                      )}
                    />
                  </td>
                  <td className="px-3 py-4">
                    <div className="flex gap-2">
                      <Button
                        aria-label={`Approve KYC for ${textValue(row.phone_number)}`}
                        disabled={
                          busy === textValue(row.id) ||
                          row.kyc_status === 'approved' ||
                          Number(row.kyc_document_count || 0) < 1 ||
                          !['kyc_review', 'provider_review'].includes(
                            textValue(
                              row.onboarding_status,
                              textValue(row.status),
                            ),
                          )
                        }
                        onClick={() =>
                          void review(textValue(row.id), 'approved')
                        }
                        size="sm"
                        className="bg-emerald-300 text-[#07120d] hover:bg-emerald-200"
                      >
                        Approve
                      </Button>
                      <Button
                        aria-label={`Request KYC changes for ${textValue(row.phone_number)}`}
                        disabled={
                          busy === textValue(row.id) ||
                          row.kyc_status === 'rejected'
                        }
                        onClick={() =>
                          void review(textValue(row.id), 'rejected')
                        }
                        size="sm"
                        variant="outline"
                        className="border-white/10 bg-transparent"
                      >
                        Request changes
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function PlansBilling({
  data,
  onChanged,
}: {
  data: AdminPayload;
  onChanged: () => Promise<void>;
}) {
  const [showPackage, setShowPackage] = useState(false);
  const [packageName, setPackageName] = useState('Starter top-up');
  const [packageCredits, setPackageCredits] = useState(5000);
  const [packagePrice, setPackagePrice] = useState(299900);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function createPackage() {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/admin/platform', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'credit_package_create',
          name: packageName,
          credits: packageCredits,
          price: packagePrice,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(payload.error || 'Unable to create credit package.');
      setMessage(
        'Credit package created and available in the customer billing catalog.',
      );
      setShowPackage(false);
      await onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to create credit package.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Commercial control"
        title="Plans, credits and invoices"
        description="Edit pricing and capacity centrally while every wallet mutation remains traceable in the immutable ledger."
        action={
          <Button
            onClick={() => setShowPackage((current) => !current)}
            className="bg-amber-300 text-[#17120a] hover:bg-amber-200"
          >
            <PackagePlus /> New credit package
          </Button>
        }
      />
      {message ? (
        <div className="rounded-xl border border-emerald-300/15 bg-emerald-300/[0.035] p-3 text-xs text-emerald-100">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-red-300/15 bg-red-300/[0.035] p-3 text-xs text-red-100">
          {error}
        </div>
      ) : null}
      {showPackage ? (
        <Panel>
          <div className="grid gap-4 md:grid-cols-[1fr_0.6fr_0.6fr_auto]">
            <label
              htmlFor="credit-package-name"
              className="text-[10px] text-white/42"
            >
              Package name
              <Input
                id="credit-package-name"
                value={packageName}
                onChange={(event) => setPackageName(event.target.value)}
                className="mt-2 border-white/8 bg-white/[0.025]"
              />
            </label>
            <label
              htmlFor="credit-package-credits"
              className="text-[10px] text-white/42"
            >
              Credits
              <Input
                id="credit-package-credits"
                type="number"
                value={packageCredits}
                onChange={(event) =>
                  setPackageCredits(Number(event.target.value))
                }
                className="mt-2 border-white/8 bg-white/[0.025]"
              />
            </label>
            <label
              htmlFor="credit-package-price"
              className="text-[10px] text-white/42"
            >
              Price in paise
              <Input
                id="credit-package-price"
                type="number"
                value={packagePrice}
                onChange={(event) =>
                  setPackagePrice(Number(event.target.value))
                }
                className="mt-2 border-white/8 bg-white/[0.025]"
              />
            </label>
            <Button
              onClick={() => void createPackage()}
              disabled={busy}
              className="self-end bg-white text-black hover:bg-white/90"
            >
              {busy ? <Loader2 className="animate-spin" /> : <Save />} Create
            </Button>
          </div>
        </Panel>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-3">
        {(data.plans ?? []).map((plan) => (
          <PlanCard
            key={textValue(plan.id)}
            plan={plan}
            onChanged={onChanged}
          />
        ))}
      </div>
      <Panel>
        <PanelHeader
          title="Credit top-up catalog"
          description="Customer-purchasable packages with tax-ready invoice generation"
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(data.creditPackages ?? []).map((item) => (
            <div
              key={textValue(item.id)}
              className="rounded-xl border border-white/8 bg-white/[0.02] p-4"
            >
              <div className="flex items-center justify-between">
                <Coins className="size-4 text-amber-200" />
                <Status value={textValue(item.status)} />
              </div>
              <p className="mt-4 text-sm font-medium">{textValue(item.name)}</p>
              <p className="mt-2 text-xl font-semibold">
                {num(item.credits)}{' '}
                <span className="text-[10px] font-normal text-white/30">
                  credits
                </span>
              </p>
              <p className="mt-1 text-[10px] text-white/38">
                {money(item.price)}
              </p>
            </div>
          ))}
        </div>
      </Panel>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Revenue collected"
          value={money(data.revenue?.total)}
          note="GST-inclusive invoices"
          icon={CircleDollarSign}
        />
        <Stat
          label="Paid invoices"
          value={num(data.revenue?.paid_invoices)}
          note="Webhook-confirmed"
          icon={CheckCircle2}
        />
        <Stat
          label="Open invoices"
          value={num(data.revenue?.open_invoices)}
          note="Requires follow-up"
          icon={CreditCard}
        />
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  onChanged,
}: {
  plan: Record<string, unknown>;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({
    name: textValue(plan.name),
    monthlyPrice: Number(plan.monthly_price),
    includedCredits: Number(plan.included_credits),
    maxAgents: Number(plan.max_agents),
    maxNumbers: Number(plan.max_numbers),
    concurrency: Number(plan.concurrency),
    status: textValue(plan.status, 'active'),
  });
  async function save() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/platform', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'plan_update',
          planId: plan.id,
          ...draft,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(payload.error || 'Unable to update plan.');
      setEditing(false);
      await onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to update plan.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <div className="flex items-center justify-between">
        <Badge variant="outline" className="border-white/10 text-white/45">
          {textValue(plan.code)}
        </Badge>
        <Status value={draft.status} />
      </div>
      {editing ? (
        <div className="mt-5 space-y-3">
          {error ? (
            <p className="rounded-lg border border-red-300/15 bg-red-300/[0.035] p-2 text-[10px] text-red-100">
              {error}
            </p>
          ) : null}
          <PlanField
            label="Plan name"
            value={draft.name}
            onChange={(value) => setDraft({ ...draft, name: value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <PlanField
              label="Monthly price · paise"
              value={draft.monthlyPrice}
              number
              onChange={(value) =>
                setDraft({ ...draft, monthlyPrice: Number(value) })
              }
            />
            <PlanField
              label="Included credits"
              value={draft.includedCredits}
              number
              onChange={(value) =>
                setDraft({ ...draft, includedCredits: Number(value) })
              }
            />
            <PlanField
              label="Max agents"
              value={draft.maxAgents}
              number
              onChange={(value) =>
                setDraft({ ...draft, maxAgents: Number(value) })
              }
            />
            <PlanField
              label="Max numbers"
              value={draft.maxNumbers}
              number
              onChange={(value) =>
                setDraft({ ...draft, maxNumbers: Number(value) })
              }
            />
            <PlanField
              label="Concurrency"
              value={draft.concurrency}
              number
              onChange={(value) =>
                setDraft({ ...draft, concurrency: Number(value) })
              }
            />
            <label className="text-[9px] text-white/35">
              Status
              <select
                value={draft.status}
                onChange={(event) =>
                  setDraft({ ...draft, status: event.target.value })
                }
                className="mt-2 h-9 w-full rounded-lg border border-white/8 bg-[#121620] px-3 text-xs"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => void save()}
              disabled={busy}
              className="flex-1 bg-white text-black hover:bg-white/90"
            >
              {busy ? <Loader2 className="animate-spin" /> : <Save />} Save plan
            </Button>
            <Button
              variant="outline"
              onClick={() => setEditing(false)}
              className="border-white/10 bg-transparent"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <h3 className="mt-5 text-xl font-semibold">{draft.name}</h3>
          <p className="mt-2 text-3xl font-semibold">
            {money(draft.monthlyPrice)}
            <span className="text-xs font-normal text-white/35"> / month</span>
          </p>
          <div className="mt-5 space-y-2 text-xs text-white/52">
            <p>{num(draft.includedCredits)} included credits</p>
            <p>
              {num(draft.maxAgents)} agents · {num(draft.maxNumbers)} numbers
            </p>
            <p>{num(draft.concurrency)} concurrent calls</p>
          </div>
          <Button
            onClick={() => setEditing(true)}
            variant="outline"
            className="mt-6 w-full border-white/10 bg-transparent"
          >
            Edit plan and limits
          </Button>
        </>
      )}
    </Panel>
  );
}

function PlanField({
  label,
  value,
  onChange,
  number = false,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  number?: boolean;
}) {
  return (
    <label className="text-[9px] text-white/35">
      {label}
      <Input
        type={number ? 'number' : 'text'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-9 border-white/8 bg-white/[0.025] text-xs"
      />
    </label>
  );
}

function TrialsCommerce({ data }: { data: AdminPayload }) {
  const stats = data.stats ?? {};
  const rows = data.commerce ?? [];
  const collected = rows
    .filter((row) => textValue(row.status) === 'paid')
    .reduce((total, row) => total + Number(row.amount ?? 0), 0);
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Activation & assisted revenue"
        title="Trials, agent tests and AI commerce"
        description="Monitor free-credit activation, no-call playground usage and payment-link execution across tenants without exposing provider credentials."
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Trial workspaces"
          value={num(stats.trials)}
          note="100 credits · 10 per test turn"
          icon={Coins}
        />
        <Stat
          label="Voice agents"
          value={num(stats.voice_agents)}
          note="Draft and active"
          icon={Activity}
        />
        <Stat
          label="Agent tests"
          value={num(stats.agent_tests)}
          note="Text and browser voice"
          icon={PhoneCall}
        />
        <Stat
          label="Commerce collected"
          value={money(collected)}
          note={`${num(stats.payment_links)} payment links`}
          icon={CircleDollarSign}
        />
      </div>
      <Panel className="overflow-hidden">
        <PanelHeader
          title="Recent payment-link activity"
          description="Instant and scheduled WhatsApp delivery with webhook-confirmed status"
        />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-xs">
            <thead className="border-y border-white/8 text-[9px] uppercase tracking-[0.13em] text-white/28">
              <tr>
                {[
                  'Reference',
                  'Workspace',
                  'Customer',
                  'Amount',
                  'Delivery',
                  'Provider',
                  'Status',
                  'Created',
                ].map((heading) => (
                  <th key={heading} className="px-3 py-3 font-medium">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/7">
              {rows.map((row) => (
                <tr key={textValue(row.id)}>
                  <td className="px-3 py-4 font-mono text-amber-200">
                    {textValue(row.reference_id)}
                  </td>
                  <td className="px-3 py-4 text-white/62">
                    {textValue(row.organization_name)}
                  </td>
                  <td className="px-3 py-4 text-white/62">
                    {textValue(row.customer_name)}
                  </td>
                  <td className="px-3 py-4">{money(row.amount)}</td>
                  <td className="px-3 py-4 text-white/48">
                    {textValue(row.delivery_mode).replaceAll('_', ' ')}
                  </td>
                  <td className="px-3 py-4 text-white/48">
                    {textValue(row.provider).replaceAll('_', ' ')}
                  </td>
                  <td className="px-3 py-4">
                    <Status value={textValue(row.status)} />
                  </td>
                  <td className="px-3 py-4 text-[10px] text-white/32">
                    {formatDate(row.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 ? (
            <p className="py-10 text-center text-xs text-white/30">
              No payment links yet.
            </p>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}

function Integrations({ data }: { data: AdminPayload }) {
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Integration control plane"
        title="API, webhooks and provider adapters"
        description="Customers see Vaani products; raw infrastructure credentials remain encrypted and admin-only."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {(data.integrations ?? []).map((item) => (
          <Panel key={`${textValue(item.type)}-${textValue(item.status)}`}>
            <div className="flex items-start gap-4">
              <span className="grid size-10 place-items-center rounded-xl bg-violet-400/10">
                <Webhook className="size-4 text-violet-200" />
              </span>
              <div className="flex-1">
                <p className="text-sm font-medium">{textValue(item.name)}</p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-white/28">
                  {textValue(item.type).replaceAll('_', ' ')}
                </p>
              </div>
              <Status value={textValue(item.status)} />
            </div>
            <div className="mt-5 flex items-center justify-between rounded-xl bg-white/[0.025] p-3 text-xs">
              <span className="text-white/35">Connected tenants</span>
              <span>{num(item.tenants)}</span>
            </div>
          </Panel>
        ))}
      </div>
      <Panel>
        <PanelHeader
          title="Public API controls"
          description="Hash-only keys, scoped permissions and webhook signatures"
        />
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            ['API keys', 'SHA-256 hashes', KeyRound],
            ['Secrets', 'AES-GCM at rest', ShieldCheck],
            ['Webhooks', 'HMAC SHA-256', Webhook],
          ].map(([title, note, Icon]) => (
            <div
              key={String(title)}
              className="rounded-xl border border-white/8 bg-white/[0.02] p-4"
            >
              <Icon className="size-4 text-amber-200" />
              <p className="mt-4 text-xs font-medium">{String(title)}</p>
              <p className="mt-1 text-[10px] text-white/32">{String(note)}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

type KeyProvider = {
  id: string;
  name: string;
  note: string;
  fields: { k: string; label: string; placeholder?: string }[];
  fetchVoices?: boolean;
};

const KEY_PROVIDERS: KeyProvider[] = [
  {
    id: 'elevenlabs',
    name: 'ElevenLabs — voices',
    note: 'Premium human voices. Save the key, then fetch and pick a voice.',
    fields: [
      { k: 'voiceId', label: 'Default voice ID' },
      {
        k: 'modelId',
        label: 'Model (optional)',
        placeholder: 'eleven_multilingual_v2',
      },
    ],
    fetchVoices: true,
  },
  {
    id: 'sarvam',
    name: 'Sarvam — speech + transcription',
    note: 'Indian-language STT and TTS (Hindi, Punjabi, Haryanvi, English).',
    fields: [],
  },
  {
    id: 'anthropic',
    name: 'Claude (Anthropic) — reasoning',
    note: 'Natural, correct replies.',
    fields: [
      {
        k: 'model',
        label: 'Model (routine calls)',
        placeholder: 'claude-haiku-4-5',
      },
      {
        k: 'escalationModel',
        label: 'Escalation model (objections, policy)',
        placeholder: 'claude-sonnet-5',
      },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI — realtime (optional)',
    note: 'Only needed for full-duplex realtime streaming with barge-in.',
    fields: [
      { k: 'model', label: 'Model', placeholder: 'gpt-5.4-mini' },
      {
        k: 'realtimeModel',
        label: 'Realtime model',
        placeholder: 'gpt-realtime',
      },
    ],
  },
];

function ProviderKeyPanel({
  data,
  onChanged,
}: {
  data: AdminPayload;
  onChanged: () => Promise<void> | void;
}) {
  const saved = new Map(
    (data.providerKeys ?? []).map((row) => [textValue(row.provider), row]),
  );
  return (
    <Panel>
      <PanelHeader
        title="Provider API keys & voices"
        description="Paste keys here to run the platform live. Keys are stored encrypted and never shown again."
      />
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {KEY_PROVIDERS.map((provider) => (
          <ProviderKeyCard
            key={provider.id}
            provider={provider}
            existing={saved.get(provider.id)}
            onChanged={onChanged}
          />
        ))}
      </div>
    </Panel>
  );
}

function ProviderKeyCard({
  provider,
  existing,
  onChanged,
}: {
  provider: KeyProvider;
  existing?: Record<string, unknown>;
  onChanged: () => Promise<void> | void;
}) {
  const savedConfig = (() => {
    try {
      return JSON.parse(
        textValue(existing?.public_config_json, '{}'),
      ) as Record<string, string>;
    } catch {
      return {};
    }
  })();
  const hasKey = Boolean(existing && Number(existing.has_secret));
  const [apiKey, setApiKey] = useState('');
  const [config, setConfig] = useState<Record<string, string>>(savedConfig);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [voices, setVoices] = useState<
    { voiceId: string; name: string; category: string }[]
  >([]);

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3000);
  }

  async function call(payload: Record<string, unknown>, key: string) {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/platform', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { error?: string } & Record<
        string,
        unknown
      >;
      if (!response.ok) throw new Error(body.error ?? 'Request failed.');
      return body;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed.');
      return null;
    } finally {
      setBusy('');
    }
  }

  async function save() {
    const result = await call(
      {
        action: 'provider_key_save',
        provider: provider.id,
        apiKey: apiKey.trim() || undefined,
        config,
      },
      'save',
    );
    if (result) {
      setApiKey('');
      flash(apiKey.trim() ? 'Key saved ✓' : 'Saved ✓');
      await onChanged();
    }
  }

  async function clear() {
    const result = await call(
      { action: 'provider_key_clear', provider: provider.id },
      'clear',
    );
    if (result) {
      setConfig({});
      setVoices([]);
      flash('Cleared');
      await onChanged();
    }
  }

  async function fetchVoices() {
    const result = await call(
      {
        action: 'elevenlabs_voices',
        apiKey: apiKey.trim() || undefined,
      },
      'voices',
    );
    if (result && Array.isArray(result.voices)) {
      setVoices(
        result.voices as { voiceId: string; name: string; category: string }[],
      );
      flash(`${result.voices.length} voices loaded ✓`);
    }
  }

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium">{provider.name}</p>
          <p className="mt-1 text-[9px] text-white/32">{provider.note}</p>
        </div>
        <Status value={hasKey ? 'key set' : 'not set'} />
      </div>

      <label className="mt-4 block text-[9px] uppercase tracking-wider text-white/32">
        API key {hasKey ? '(leave blank to keep current)' : ''}
      </label>
      <Input
        type="password"
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
        placeholder={hasKey ? '•••••••• saved' : 'Paste key'}
        className="mt-1 h-9 border-white/10 bg-black/30 text-xs"
      />

      {provider.fields.map((field) => (
        <div key={field.k}>
          <label className="mt-3 block text-[9px] uppercase tracking-wider text-white/32">
            {field.label}
          </label>
          <Input
            value={config[field.k] ?? ''}
            onChange={(event) =>
              setConfig((current) => ({
                ...current,
                [field.k]: event.target.value,
              }))
            }
            placeholder={field.placeholder}
            className="mt-1 h-9 border-white/10 bg-black/30 text-xs"
          />
        </div>
      ))}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          disabled={busy === 'save'}
          onClick={save}
          className="h-8 bg-white text-[10px] text-black hover:bg-white/90"
        >
          {busy === 'save' ? <Loader2 className="animate-spin" /> : null} Save
        </Button>
        {provider.fetchVoices ? (
          <Button
            variant="outline"
            disabled={busy === 'voices'}
            onClick={fetchVoices}
            className="h-8 border-white/12 bg-transparent text-[10px]"
          >
            {busy === 'voices' ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Activity />
            )}{' '}
            Fetch my voices
          </Button>
        ) : null}
        {hasKey ? (
          <Button
            variant="outline"
            disabled={busy === 'clear'}
            onClick={clear}
            className="h-8 border-red-400/20 bg-transparent text-[10px] text-red-200"
          >
            Clear
          </Button>
        ) : null}
      </div>

      {error ? <p className="mt-2 text-[10px] text-red-300">{error}</p> : null}
      {notice ? (
        <p className="mt-2 text-[10px] font-medium text-emerald-300">
          {notice}
        </p>
      ) : null}

      {voices.length ? (
        <div className="mt-3 max-h-44 overflow-y-auto rounded-lg border border-white/8 bg-black/20 p-2">
          <p className="mb-1 px-1 text-[9px] uppercase tracking-wider text-white/32">
            {voices.length} voices · tap to select
          </p>
          {voices.map((voice) => (
            <button
              key={voice.voiceId}
              type="button"
              onClick={() =>
                setConfig((current) => ({ ...current, voiceId: voice.voiceId }))
              }
              className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[11px] hover:bg-white/5 ${config.voiceId === voice.voiceId ? 'bg-white/[0.06] text-white' : 'text-white/70'}`}
            >
              <span className="truncate">
                {voice.name}
                {voice.category ? (
                  <span className="ml-2 text-[9px] text-white/30">
                    {voice.category}
                  </span>
                ) : null}
              </span>
              {config.voiceId === voice.voiceId ? (
                <span className="text-[9px] text-emerald-300">selected</span>
              ) : null}
            </button>
          ))}
          <p className="mt-1 px-1 text-[8px] text-white/28">
            Selecting a voice fills the Voice ID — press Save to apply.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function PlatformApis({
  data,
  onChanged,
}: {
  data: AdminPayload;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState('');
  async function patch(payload: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const response = await fetch('/api/admin/platform', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(body.error ?? 'Unable to update platform setting.');
      await onChanged();
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Admin-only configuration"
        title="Identity, APIs and cloud requirements"
        description="Customer screens use Vaani product names. Provider credentials, readiness and health remain inside this operator console."
      />
      <ProviderKeyPanel data={data} onChanged={onChanged} />
      <Panel>
        <PanelHeader
          title="Customer sign-in providers"
          description="Visibility and activation are separate controls; activation is blocked until credentials exist."
        />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {(data.authProviders ?? []).map((provider) => {
            const visible = Boolean(provider.button_visible);
            const enabled = Boolean(provider.enabled);
            const key = textValue(provider.provider);
            return (
              <div
                key={key}
                className="rounded-xl border border-white/8 bg-white/[0.02] p-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">
                      {textValue(provider.display_name)}
                    </p>
                    <p className="mt-1 text-[9px] text-white/30">
                      {textValue(provider.status).replaceAll('_', ' ')}
                    </p>
                  </div>
                  <Status
                    value={
                      enabled ? 'active' : visible ? 'button visible' : 'hidden'
                    }
                  />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    disabled={busy === key}
                    onClick={() =>
                      patch(
                        {
                          action: 'auth_visibility',
                          provider: provider.provider,
                          buttonVisible: !visible,
                        },
                        key,
                      )
                    }
                    className="border-white/10 bg-transparent text-[10px]"
                  >
                    {visible ? 'Hide' : 'Show'}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy === key}
                    onClick={() =>
                      patch(
                        {
                          action: 'auth_enabled',
                          provider: provider.provider,
                          enabled: !enabled,
                        },
                        key,
                      )
                    }
                    className="border-white/10 bg-transparent text-[10px]"
                  >
                    {busy === key ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <SlidersHorizontal />
                    )}
                    {enabled ? 'Disable' : 'Enable'}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
      <Panel>
        <PanelHeader
          title="Recommended integration stack"
          description="The minimum production stack, grouped by business capability"
        />
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            [
              'Voice & intelligence',
              'OpenAI Realtime · ElevenLabs · Sarvam · fallback reasoning',
              'P0',
            ],
            [
              'Telephony',
              'Exotel · Twilio · SIP · Plivo · Telnyx · Vonage',
              'P0',
            ],
            [
              'Revenue & messaging',
              'WhatsApp Cloud · Razorpay · Stripe · Resend',
              'P0',
            ],
            [
              'CRM, ads & automation',
              'Meta · Google Ads · HubSpot · Salesforce · Zoho · n8n',
              'P1',
            ],
          ].map(([title, note, priority]) => (
            <div
              key={title}
              className="rounded-xl border border-white/8 bg-white/[0.02] p-4"
            >
              <div className="flex items-center justify-between">
                <Network className="size-4 text-cyan-200" />
                <Badge
                  variant="outline"
                  className="border-white/10 text-[8px] text-white/42"
                >
                  {priority}
                </Badge>
              </div>
              <p className="mt-4 text-xs font-medium">{title}</p>
              <p className="mt-2 text-[9px] leading-4 text-white/34">{note}</p>
            </div>
          ))}
        </div>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        {(data.platformProviders ?? []).map((provider) => {
          const required = safeList(provider.required_credentials_json);
          const id = textValue(provider.id);
          const isDisabled = textValue(provider.status) === 'disabled';
          return (
            <Panel key={id}>
              <div className="flex items-start justify-between">
                <span className="grid size-10 place-items-center rounded-xl border border-white/10 bg-white/[0.04]">
                  <ServerCog className="size-4 text-[#a8b7ff]" />
                </span>
                <Status value={textValue(provider.health)} />
              </div>
              <h2 className="mt-5 text-sm font-semibold">
                {textValue(provider.public_name)}
              </h2>
              <p className="mt-1 text-[9px] uppercase tracking-wider text-white/25">
                {textValue(provider.category)}
              </p>
              <p className="mt-3 text-xs leading-5 text-white/38">
                {textValue(provider.usage_note)}
              </p>
              <div className="mt-4 rounded-xl border border-white/7 bg-black/20 p-3">
                <p className="text-[8px] uppercase tracking-wider text-white/25">
                  Required environment secrets
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {required.map((item) => (
                    <code
                      key={item}
                      className="rounded bg-white/5 px-2 py-1 text-[8px] text-white/65"
                    >
                      {item}
                    </code>
                  ))}
                </div>
              </div>
              <Button
                variant="outline"
                disabled={busy === id}
                onClick={() =>
                  patch(
                    {
                      action: 'provider_status',
                      id,
                      status: isDisabled ? 'required_for_live' : 'disabled',
                      health: isDisabled ? 'not_connected' : 'disabled',
                    },
                    id,
                  )
                }
                className="mt-4 w-full border-white/10 bg-transparent text-[10px]"
              >
                {busy === id ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <SlidersHorizontal />
                )}
                {isDisabled ? 'Enable adapter' : 'Disable adapter'}
              </Button>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

function SupportDesk({
  data,
  onChanged,
}: {
  data: AdminPayload;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  async function act(
    ticketId: string,
    action: 'ticket_reply' | 'ticket_status',
  ) {
    const draft = (drafts[ticketId] ?? '').trim();
    if (action === 'ticket_reply' && !draft) {
      setError('Write a reply before sending it.');
      return;
    }
    setBusy(ticketId);
    setError('');
    try {
      const payload =
        action === 'ticket_reply'
          ? { action, ticketId, message: draft }
          : { action, ticketId, status: 'resolved' };
      const response = await fetch('/api/admin/platform', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('Unable to update ticket.');
      if (action === 'ticket_reply')
        setDrafts((current) => ({ ...current, [ticketId]: '' }));
      await onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to update ticket.',
      );
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Tenant support"
        title="Support desk"
        description="Customer tickets, platform replies, assignment and resolution status in one admin queue."
      />
      {error ? (
        <p className="rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2 text-[11px] text-red-200">
          {error}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {(data.tickets ?? []).map((ticket) => {
          const messages = (data.ticketMessages ?? []).filter(
            (item) => item.ticket_id === ticket.id,
          );
          return (
            <Panel key={textValue(ticket.id)}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">
                    {textValue(ticket.subject)}
                  </h2>
                  <p className="mt-1 text-[9px] text-white/30">
                    {textValue(ticket.organization_name)} ·{' '}
                    {textValue(ticket.creator_email)}
                  </p>
                </div>
                <Status value={textValue(ticket.status)} />
              </div>
              <div className="mt-4 space-y-2">
                {messages.map((message) => (
                  <div
                    key={textValue(message.id)}
                    className={`rounded-xl border p-3 text-[10px] leading-5 ${message.sender_role === 'admin' ? 'border-violet-300/10 bg-violet-300/[0.035]' : 'border-white/7 bg-white/[0.02]'}`}
                  >
                    <p className="mb-1 text-[8px] uppercase tracking-wider text-white/25">
                      {textValue(message.sender_name)} ·{' '}
                      {textValue(message.sender_role)}
                    </p>
                    {textValue(message.message)}
                  </div>
                ))}
              </div>
              <textarea
                value={drafts[textValue(ticket.id)] ?? ''}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [textValue(ticket.id)]: event.target.value,
                  }))
                }
                rows={3}
                placeholder="Write your reply to this workspace…"
                className="mt-4 w-full rounded-lg border border-white/10 bg-black/30 p-2.5 text-[11px] text-white/80 outline-none placeholder:text-white/25 focus:border-white/20"
              />
              <div className="mt-2 flex gap-2">
                <Button
                  variant="outline"
                  disabled={busy === textValue(ticket.id)}
                  onClick={() => act(textValue(ticket.id), 'ticket_reply')}
                  className="flex-1 border-white/10 bg-transparent text-[9px]"
                >
                  Reply
                </Button>
                <Button
                  disabled={busy === textValue(ticket.id)}
                  onClick={() => act(textValue(ticket.id), 'ticket_status')}
                  className="flex-1 bg-emerald-300 text-[#07120d] hover:bg-emerald-200"
                >
                  Resolve
                </Button>
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

function SystemAudit({ data }: { data: AdminPayload }) {
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Security & reliability"
        title="System health and audit trail"
        description="Every sensitive mutation is attributable, tenant-scoped and designed for incident review."
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: 'API',
            value: textValue(data.system?.api, 'unknown'),
            note: 'this request was served',
          },
          {
            label: 'Database',
            value: textValue(data.system?.database, 'unknown'),
            note:
              typeof data.system?.databaseProbeMs === 'number'
                ? `probe ${num(data.system.databaseProbeMs)} ms`
                : 'probe failed',
          },
          {
            label: 'Job queue',
            value: textValue(data.system?.queue, 'unknown'),
            note: `${num(data.system?.queueDepth)} queued · ${num(data.system?.queueFailed)} failed`,
          },
          {
            label: 'Provider p95',
            value:
              typeof data.system?.p95LatencyMs === 'number'
                ? `${num(data.system.p95LatencyMs)} ms`
                : 'Not measured',
            note: Number(data.system?.latencySampleSize ?? 0)
              ? `${num(data.system?.latencySampleSize)} samples`
              : 'no provider calls yet',
          },
        ].map((entry) => (
          <Stat
            key={entry.label}
            label={entry.label}
            value={entry.value}
            note={entry.note}
            icon={ServerCog}
          />
        ))}
      </div>
      <Panel className="overflow-hidden">
        <PanelHeader
          title="Recent audit events"
          description="Security-relevant changes across customer workspaces"
        />
        <div className="mt-4 divide-y divide-white/7">
          {(data.audits ?? []).map((row, index) => (
            <div
              key={`${textValue(row.action)}-${index}`}
              className="flex items-start gap-3 py-4"
            >
              <span className="mt-0.5 grid size-8 place-items-center rounded-lg bg-white/5">
                <ShieldCheck className="size-3.5 text-white/42" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">
                  {textValue(row.action).replaceAll('.', ' · ')}
                </p>
                <p className="mt-1 text-[10px] text-white/32">
                  {textValue(row.actor_name, 'System')} ·{' '}
                  {textValue(row.organization_name, 'Platform')} ·{' '}
                  {textValue(row.target_type)}
                </p>
              </div>
              <span className="text-[9px] text-white/25">
                {formatDate(row.created_at)}
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9eb0ff]">
          {eyebrow}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          {title}
        </h1>
        <p className="mt-2 max-w-3xl text-xs leading-5 text-white/38 sm:text-sm">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  icon: Icon,
}: {
  label: string;
  value: unknown;
  note: string;
  icon: typeof Activity;
}) {
  return (
    <div className="portal-stat">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/30">
          {label}
        </p>
        <Icon className="size-4 text-[#a8b7ff]" />
      </div>
      <p className="mt-4 text-2xl font-semibold tracking-tight">
        {String(value)}
      </p>
      <p className="mt-1 text-[10px] text-white/30">{note}</p>
    </div>
  );
}

function Panel({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`portal-panel p-5 ${className}`}>{children}</section>
  );
}

function PanelHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-[10px] text-white/32">{description}</p>
    </div>
  );
}

function Status({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const positive = [
    'active',
    'approved',
    'operational',
    'connected',
    'paid',
  ].some((item) => normalized.includes(item));
  const warning = ['pending', 'review', 'required', 'test'].some((item) =>
    normalized.includes(item),
  );
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-1 text-[9px] capitalize ${positive ? 'border-emerald-400/15 bg-emerald-400/7 text-emerald-300' : warning ? 'border-amber-300/15 bg-amber-300/7 text-amber-200' : 'border-white/10 bg-white/5 text-white/45'}`}
    >
      {value.replaceAll('_', ' ')}
    </span>
  );
}

function LoadingState() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="text-center">
        <Loader2 className="mx-auto size-6 animate-spin text-amber-300" />
        <p className="mt-3 text-xs text-white/35">
          Loading platform control plane…
        </p>
      </div>
    </div>
  );
}
function ErrorState({ error, retry }: { error: string; retry: () => void }) {
  return (
    <div className="mx-auto mt-20 max-w-md rounded-2xl border border-red-400/15 bg-red-400/5 p-6 text-center">
      <p className="text-sm text-red-100">{error}</p>
      <Button
        onClick={retry}
        variant="outline"
        className="mt-4 border-white/10 bg-transparent"
      >
        <RefreshCcw /> Retry
      </Button>
    </div>
  );
}
function num(value: unknown) {
  return Number(value ?? 0).toLocaleString('en-IN');
}
function money(value: unknown) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0) / 100);
}
function formatDate(value: unknown) {
  const date = new Date(String(value));
  return Number.isNaN(date.valueOf())
    ? '—'
    : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}
function textValue(value: unknown, fallback = '—') {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : fallback;
}
function safeList(value: unknown) {
  try {
    const parsed = JSON.parse(textValue(value, '[]'));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
