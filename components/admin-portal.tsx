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

import { CustomerSecurity } from '@/components/customer-security';
import { PortalShell, type PortalNavGroup } from '@/components/portal-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { ActivityAreaChart, QueueBars } from '@/components/analytics-charts';
import { useT } from '@/components/locale-provider';
import { formatMoney } from '@/lib/currency';
import {
  KYC_DOCUMENT_LABEL,
  kycProgress,
  nextKycStatuses,
} from '@/lib/kyc-documents';
import { USAGE_UNITS } from '@/lib/rate-cards';

type AdminSession = { name: string; email: string };

type AdminPayload = {
  stats?: Record<string, number>;
  revenue?: Record<string, number>;
  customers?: Record<string, unknown>[];
  plans?: Record<string, unknown>[];
  creditPackages?: Record<string, unknown>[];
  fxRates?: Record<string, unknown>[];
  priceBooks?: Record<string, unknown>[];
  numbers?: Record<string, unknown>[];
  kycDocuments?: Record<string, unknown>[];
  rateCards?: Record<string, unknown>[];
  costModel?: {
    assumptions: { note: string };
    minute: {
      summary: string;
      complete: boolean;
      components: Array<{
        key: string;
        label: string;
        micros: number | null;
        quantity: string;
      }>;
    };
    call: { summary: string };
    message: { summary: string };
    fixed: { summary: string };
    targetMargin: number;
    plans: Array<{
      id: string;
      name: string;
      includedMinutes: number;
      summary: string;
      complete: boolean;
      suggestion: { summary: string; shortfallMicros: number | null };
    }>;
    credits: Array<{
      packName: string;
      sellPerMinuteMicros: number;
      marginPerMinute: number | null;
      summary: string;
    }>;
  };
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
  health?: {
    overall: string;
    windowMinutes: number;
    measuredAt: string;
    components: Array<{
      component: string;
      state: string;
      reason: string;
      errorRate: number | null;
      p95LatencyMs: number | null;
      lastSuccessAt: string | null;
      quotaUsedFraction: number | null;
      tokenState: string;
      breaker: string;
    }>;
    silentJobs?: Array<{
      type: string;
      runs: number;
      considered: number;
      skipped: number;
      message: string;
    }>;
  };
  unitEconomics?: {
    currency: string;
    windowDays: number;
    revenueMinor: number;
    costMinor: number;
    grossProfitMinor: number | null;
    grossMargin: number | null;
    unpricedEvents: number;
    complete: boolean;
  };
  compliance?: Record<string, number>;
  providerReadiness?: Record<string, unknown>[];
};

const groups: PortalNavGroup[] = [
  {
    label: 'Platform',
    translationKey: 'adminNav.group.platform',
    items: [
      {
        id: 'overview',
        label: 'Command center',
        icon: Gauge,
        translationKey: 'adminNav.overview',
      },
      {
        id: 'customers',
        label: 'Customers',
        icon: Building2,
        translationKey: 'adminNav.customers',
      },
      {
        id: 'call_ops',
        label: 'Call operations',
        icon: Radio,
        translationKey: 'adminNav.call_ops',
      },
      {
        id: 'voice_engines',
        label: 'Voice engines',
        icon: Activity,
        translationKey: 'adminNav.voice_engines',
      },
    ],
  },
  {
    label: 'Commercial',
    translationKey: 'adminNav.group.commercial',
    items: [
      {
        id: 'numbers_kyc',
        label: 'Numbers & KYC',
        icon: FileCheck2,
        translationKey: 'adminNav.numbers_kyc',
      },
      {
        id: 'plans_billing',
        label: 'Plans & billing',
        icon: CreditCard,
        translationKey: 'adminNav.plans_billing',
      },
      {
        id: 'trials_commerce',
        label: 'Trials & commerce',
        icon: CircleDollarSign,
        badge: 'New',
        translationKey: 'adminNav.trials_commerce',
      },
      {
        id: 'integrations',
        label: 'API & integrations',
        icon: Network,
        translationKey: 'adminNav.integrations',
      },
      {
        id: 'platform_apis',
        label: 'Provider & auth config',
        icon: SlidersHorizontal,
        translationKey: 'adminNav.platform_apis',
      },
    ],
  },
  {
    label: 'Governance',
    translationKey: 'adminNav.group.governance',
    items: [
      {
        id: 'system_audit',
        label: 'System & audit',
        icon: ShieldCheck,
        translationKey: 'adminNav.system_audit',
      },
      {
        id: 'support_tickets',
        label: 'Support tickets',
        icon: LifeBuoy,
        translationKey: 'adminNav.support_tickets',
      },
    ],
  },
];

export function AdminPortal({ session }: { session: AdminSession }) {
  const [active, setActive] = useState('overview');
  const [data, setData] = useState<AdminPayload>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mfaRequired, setMfaRequired] = useState('');
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
        // §14 restricts a platform admin with no second factor. Bouncing to
        // the sign-in page loops for ever: the credentials are correct, so the
        // login succeeds and the next request is refused again. This screen had
        // the loop; the customer portal's equivalent was fixed and this one was
        // missed.
        const refusal = (await response.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
        };
        if (refusal.code === 'mfa_required') {
          setMfaRequired(refusal.error ?? '');
          setLoading(false);
          return;
        }
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

  if (mfaRequired)
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface-muted px-6 py-10">
        <section className="portal-panel max-w-md p-6 text-center">
          <h1 className="text-sm font-semibold">
            Two-factor authentication required
          </h1>
          <p className="mt-2 text-[11px] text-ink-body">{mfaRequired}</p>
          <p className="mt-3 text-[10px] text-ink-muted">
            Your password was accepted. This is the one step left before the
            admin console opens.
          </p>
        </section>
        {/* The security panel is on §14's allow-list precisely so it still
            works when every other admin request is refused. */}
        <div className="w-full max-w-2xl">
          <CustomerSecurity />
        </div>
      </div>
    );

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
      <section className="relative overflow-hidden rounded-[28px] border border-hairline bg-[radial-gradient(circle_at_78%_20%,rgba(125,211,252,0.13),transparent_32%),radial-gradient(circle_at_15%_0%,rgba(167,139,250,0.14),transparent_35%),linear-gradient(145deg,#ffffff_0%,#ffffff_58%,#ffffff_100%)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.28)] sm:p-7">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(rgba(17,24,39,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(17,24,39,0.05)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:linear-gradient(to_bottom,black,transparent_88%)]"
        />
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/15 bg-emerald-300/[0.055] px-3 py-1.5 text-[9px] font-medium uppercase tracking-[0.14em] text-success-text">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-300" />{' '}
                Core operational
              </span>
              <span className="text-[9px] uppercase tracking-[0.15em] text-ink-muted">
                Platform command center
              </span>
            </div>
            <h1 className="mt-5 max-w-3xl text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              Operate every tenant, call and rupee from one control room.
            </h1>
            <p className="mt-3 max-w-2xl text-xs leading-5 text-ink-muted sm:text-sm">
              Live capacity, provider readiness, commercial health and
              compliance reviews—without exposing tenant conversations or
              infrastructure secrets.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => onNavigate('platform_apis')}
              className="border-hairline bg-surface-strong"
            >
              <ServerCog /> Provider control
            </Button>
            <Button
              onClick={() => void onRefresh()}
              className="bg-primary text-primary-foreground hover:bg-[#1d4ed8]"
            >
              <RefreshCcw /> Refresh now
            </Button>
          </div>
        </div>
        <div className="relative mt-7 grid gap-px overflow-hidden rounded-2xl border border-hairline bg-surface-strong sm:grid-cols-2 xl:grid-cols-4">
          {[
            [
              'Live conversations',
              num(stats.live_calls),
              'PII-masked monitor',
              Radio,
              'text-success-text',
            ],
            [
              'Action queue',
              num(attentionCount),
              'Reviews and incidents',
              Clock3,
              'text-warning-text',
            ],
            [
              'Provider readiness',
              `${connectedProviders}/${readiness.length}`,
              'Live-capable adapters',
              Network,
              'text-cyan-700',
            ],
            [
              'Collected revenue',
              money(revenue.total),
              `${num(revenue.paid_invoices)} paid invoices`,
              WalletCards,
              'text-violet-700',
            ],
          ].map(([label, value, note, Icon, tone]) => (
            <div key={String(label)} className="bg-surface p-4">
              <div className="flex items-center justify-between">
                <p className="text-[9px] uppercase tracking-[0.13em] text-ink-muted">
                  {String(label)}
                </p>
                <Icon className={`size-4 ${String(tone)}`} />
              </div>
              <p className="mt-3 text-xl font-semibold">{String(value)}</p>
              <p className="mt-1 text-[9px] text-ink-muted">{String(note)}</p>
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
                  <span className="text-ink-body">{String(label)}</span>
                  <span
                    className={
                      status === 'Operational' || status === 'Connected'
                        ? 'text-success-text'
                        : 'text-primary'
                    }
                  >
                    {String(status)}
                  </span>
                </div>
                <Progress
                  value={Number(progress)}
                  className="h-1 bg-surface-strong"
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            aria-label="Open provider configuration and latency controls"
            onClick={() => onNavigate('platform_apis')}
            className="mt-6 flex w-full items-center justify-between rounded-xl border border-hairline bg-surface-muted p-4 text-left transition hover:bg-surface-strong"
          >
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] text-ink-muted">
                P95 conversation latency
              </p>
              <p className="mt-2 text-2xl font-semibold">
                {typeof data.system?.p95LatencyMs === 'number'
                  ? `${num(data.system.p95LatencyMs)} ms`
                  : 'Not measured'}
              </p>
              <p className="mt-1 text-[10px] text-ink-muted">
                {Number(data.system?.latencySampleSize ?? 0)
                  ? `Provider calls · last ${num(data.system?.latencySampleSize)} samples`
                  : 'No provider calls recorded yet'}
              </p>
            </div>
            <ArrowRight className="size-4 text-ink-muted" />
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
                <span className="grid size-9 place-items-center rounded-xl bg-surface-strong">
                  <Clock3 className="size-4 text-ink-muted" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">{title}</p>
                  <p className="mt-1 text-[10px] text-ink-muted">{note}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onNavigate(target)}
                  className="border-hairline bg-transparent text-[10px]"
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
  const t = useT();
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow={t('adminScreen.customers.eyebrow')}
        title={t('adminScreen.customers.title')}
        description={t('adminScreen.customers.description')}
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
    <section className="rounded-2xl border border-hairline bg-surface-muted p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[11px] font-semibold text-ink">
            Create and suspend workspaces
          </h2>
          <p className="mt-1 text-[10px] text-ink-muted">
            Suspending pauses running campaigns, cancels queued jobs and blocks
            the workspace&apos;s API access immediately.
          </p>
        </div>
        {adminRole ? (
          <span className="rounded-md bg-surface-strong px-2 py-1 text-[9px] uppercase tracking-wide text-ink-body">
            your role: {adminRole.replaceAll('_', ' ')}
          </span>
        ) : null}
      </div>

      {notice ? (
        <p className="mt-3 rounded-lg border border-hairline bg-surface-muted px-3 py-2 text-[11px] text-ink">
          {notice}
        </p>
      ) : null}

      {canManage ? (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <input
            placeholder="Workspace name"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            className="rounded-lg border border-hairline bg-surface-strong px-3 py-2 text-[11px] outline-none focus:border-hairline"
          />
          <input
            placeholder="Owner email"
            value={form.ownerEmail}
            onChange={(event) =>
              setForm({ ...form, ownerEmail: event.target.value })
            }
            className="rounded-lg border border-hairline bg-surface-strong px-3 py-2 text-[11px] outline-none focus:border-hairline"
          />
          <input
            placeholder="Owner name"
            value={form.ownerName}
            onChange={(event) =>
              setForm({ ...form, ownerName: event.target.value })
            }
            className="rounded-lg border border-hairline bg-surface-strong px-3 py-2 text-[11px] outline-none focus:border-hairline"
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
        <p className="mt-4 text-[11px] text-ink-muted">
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
              className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-surface-muted px-3 py-2.5 text-[11px]"
            >
              <span className="font-medium">{textValue(row.name)}</span>
              <span className="font-mono text-[9px] text-ink-muted">
                {textValue(row.slug)}
              </span>
              <span
                className={`rounded-md px-2 py-0.5 text-[9px] uppercase tracking-wide ${
                  suspended
                    ? 'bg-rose-400/12 text-danger-text'
                    : 'bg-emerald-400/12 text-success-text'
                }`}
              >
                {textValue(row.status)}
              </span>
              <span className="text-[9px] text-ink-muted">
                {textValue(row.plan_name, 'no plan')} · {num(row.users)} users ·{' '}
                {num(row.calls_30d)} calls/30d
              </span>
              {row.suspension_reason ? (
                <span className="text-[9px] text-danger-text">
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
                      className="w-44 rounded-lg border border-hairline bg-surface-strong px-2.5 py-1.5 text-[10px] outline-none focus:border-hairline"
                    />
                    <Button
                      disabled={
                        busy === `off-${id}` || !(reason[id] ?? '').trim()
                      }
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
          <thead className="border-y border-hairline text-[9px] uppercase tracking-[0.13em] text-ink-muted">
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
              <tr key={String(row.id)} className="hover:bg-surface-muted">
                <td className="px-3 py-4">
                  <p className="font-medium">{textValue(row.name)}</p>
                  <p className="mt-1 text-[10px] text-ink-muted">
                    {textValue(row.owner_email, 'No owner')}
                  </p>
                </td>
                <td className="px-3 py-4 text-ink-body">
                  {textValue(row.plan_name, 'Free')}
                </td>
                <td className="px-3 py-4 font-mono text-warning-text">
                  {num(row.balance)}
                </td>
                <td className="px-3 py-4 text-ink-body">{num(row.leads)}</td>
                <td className="px-3 py-4 text-ink-body">{num(row.numbers)}</td>
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
  const t = useT();
  const calls = data.liveCalls ?? [];
  const live = calls.filter((row) => textValue(row.status) === 'in_progress');
  const system = data.system ?? {};
  const p95 = system.p95LatencyMs;
  const sampleSize = Number(system.latencySampleSize ?? 0);

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow={t('adminScreen.call_ops.eyebrow')}
        title={t('adminScreen.call_ops.title')}
        description={t('adminScreen.call_ops.description')}
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
              <thead className="border-y border-hairline text-[9px] uppercase tracking-wider text-ink-muted">
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
                  <tr
                    key={textValue(row.id)}
                    className="hover:bg-surface-muted"
                  >
                    <td className="px-3 py-3">
                      {textValue(row.organization_name)}
                    </td>
                    <td className="px-3 py-3 text-ink-body">
                      {textValue(row.agent_name)}
                    </td>
                    <td className="px-3 py-3 font-mono text-[10px] text-ink-body">
                      {textValue(row.to_number)}
                    </td>
                    <td className="px-3 py-3">
                      <Status value={textValue(row.status, 'unknown')} />
                    </td>
                    <td className="px-3 py-3 text-ink-body">
                      {textValue(row.outcome)}
                    </td>
                    <td className="px-3 py-3 text-ink-body">
                      {row.duration_seconds
                        ? `${num(row.duration_seconds)}s`
                        : '—'}
                    </td>
                    <td className="px-3 py-3 text-ink-body">
                      {row.latency_ms ? `${num(row.latency_ms)} ms` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 text-xs text-ink-muted">
            No calls recorded yet. This screen fills in once calls run.
          </p>
        )}
      </Panel>
    </div>
  );
}

function VoiceEngines({ data }: { data: AdminPayload }) {
  const t = useT();
  const health = data.providerHealth ?? [];
  const readiness = data.providerReadiness ?? [];
  const readinessFor = (providerId: string) =>
    readiness.find(
      (entry) => `provider_${textValue(entry.adapter)}` === providerId,
    );

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow={t('adminScreen.voice_engines.eyebrow')}
        title={t('adminScreen.voice_engines.title')}
        description={t('adminScreen.voice_engines.description')}
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
              className="flex items-center justify-between rounded-xl border border-hairline bg-surface-muted p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">
                  {textValue(entry.publicName)}
                </p>
                <p className="mt-1 text-[9px] text-ink-muted">
                  {textValue(entry.adapter)} ·{' '}
                  {entry.configured ? 'credentials present' : 'not configured'}
                </p>
              </div>
              <Status value={textValue(entry.mode, 'sandbox')} />
            </div>
          ))}
          {!readiness.length ? (
            <p className="text-xs text-ink-muted">No providers registered.</p>
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
                  className="rounded-xl border border-hairline bg-surface-muted p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {ready
                          ? textValue(ready.publicName)
                          : providerId.replace('provider_', '')}
                      </p>
                      <p className="mt-1 text-[9px] text-ink-muted">
                        {(entry.operations as string[] | undefined)?.join(
                          ' · ',
                        ) ?? '—'}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[9px] ${errorRate > 0.05 ? 'border-red-400/25 bg-red-400/10 text-danger-text' : 'border-emerald-300/20 bg-emerald-300/8 text-success-text'}`}
                    >
                      {(errorRate * 100).toFixed(1)}% errors
                    </Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-sm font-semibold">
                        {num(entry.calls)}
                      </p>
                      <p className="mt-1 text-[9px] text-ink-muted">calls</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold">
                        {num(entry.averageLatencyMs)}
                        <span className="text-[9px] text-ink-muted"> ms</span>
                      </p>
                      <p className="mt-1 text-[9px] text-ink-muted">average</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold">
                        {entry.p95LatencyMs
                          ? `${num(entry.p95LatencyMs)}`
                          : '—'}
                        <span className="text-[9px] text-ink-muted"> ms</span>
                      </p>
                      <p className="mt-1 text-[9px] text-ink-muted">p95</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-4 text-xs text-ink-muted">
            No provider calls recorded yet, so there is nothing to measure.
          </p>
        )}
      </Panel>

      {data.unitEconomics ? (
        <Panel>
          <PanelHeader
            title="Unit economics"
            description="Revenue and provider cost over the same 30 days, in the same currency."
          />
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            {(
              [
                [
                  'Revenue',
                  money(
                    data.unitEconomics.revenueMinor,
                    data.unitEconomics.currency,
                  ),
                ],
                [
                  'Provider cost',
                  money(
                    data.unitEconomics.costMinor,
                    data.unitEconomics.currency,
                  ),
                ],
                [
                  'Gross profit',
                  data.unitEconomics.grossProfitMinor === null
                    ? 'not measured'
                    : money(
                        data.unitEconomics.grossProfitMinor,
                        data.unitEconomics.currency,
                      ),
                ],
                [
                  'Gross margin',
                  // null means no revenue in the window — which is not the
                  // same fact as a zero margin, so it does not print as 0%.
                  data.unitEconomics.grossMargin === null
                    ? 'not measured'
                    : `${(Number(data.unitEconomics.grossMargin) * 100).toFixed(1)}%`,
                ],
              ] as Array<[string, string]>
            ).map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl border border-hairline bg-surface-muted p-3"
              >
                <p className="text-[9px] uppercase tracking-wider text-ink-muted">
                  {label}
                </p>
                <p className="mt-1 text-lg font-semibold">{value}</p>
              </div>
            ))}
          </div>
          {!data.unitEconomics.complete ? (
            <p className="mt-3 text-[10px] text-warning-text">
              {num(data.unitEconomics.unpricedEvents)} usage events in this
              window had no rate card, so the cost above is a floor rather than
              a total and the margin is optimistic. Add the missing rate cards
              to close the gap.
            </p>
          ) : null}
        </Panel>
      ) : null}

      {data.providerCosts?.length ? (
        <Panel>
          <PanelHeader
            title="Provider cost by category"
            description="Metered usage, priced from the rate card in force at the time of each call."
          />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-xs">
              <thead className="border-y border-hairline text-[9px] uppercase tracking-wider text-ink-muted">
                <tr>
                  {[
                    'Provider',
                    'Category',
                    'Events',
                    'Units',
                    'Cost',
                    'Unpriced',
                  ].map((heading) => (
                    <th key={heading} className="px-3 py-3 font-medium">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.providerCosts.map((row, index) => (
                  <tr key={`${textValue(row.provider_id)}-${index}`}>
                    <td className="px-3 py-3">{textValue(row.provider_id)}</td>
                    <td className="px-3 py-3 text-ink-body">
                      {textValue(row.category)}
                    </td>
                    <td className="px-3 py-3 text-ink-body">
                      {num(row.total)}
                    </td>
                    <td className="px-3 py-3 text-ink-body">
                      {num(row.units)}
                    </td>
                    <td className="px-3 py-3 text-ink-body">
                      {money(Math.round(Number(row.cost_micros ?? 0) / 10_000))}
                    </td>
                    <td className="px-3 py-3">
                      {Number(row.unpriced_events ?? 0) > 0 ? (
                        <span className="text-warning-text">
                          {num(row.unpriced_events)}
                        </span>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
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
  const t = useT();
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  /**
   * Where each number's paperwork actually stands.
   *
   * The queue used to show a document *count*, and Approve unlocked at one.
   * A count cannot tell a reviewer whether the one file on a number is the
   * address proof or the use-case declaration, so this reads the same
   * checklist the customer is shown — the documents are already in the
   * payload, newest first, which is the order `kycProgress` expects.
   */
  const progressByNumber = new Map(
    (data.numbers ?? []).map((row) => {
      const documents = (data.kycDocuments ?? [])
        .filter((doc) => textValue(doc.phone_number_id) === textValue(row.id))
        .map((doc) => ({
          document_type: textValue(doc.document_type),
          status: textValue(doc.status),
        }));
      return [
        textValue(row.id),
        kycProgress(documents, textValue(row.connection_mode) || null),
      ] as const;
    }),
  );
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
        eyebrow={t('adminScreen.numbers_kyc.eyebrow')}
        title={t('adminScreen.numbers_kyc.title')}
        description={t('adminScreen.numbers_kyc.description')}
      />
      {message ? (
        <div className="rounded-xl border border-emerald-300/15 bg-emerald-300/[0.035] p-3 text-xs text-success-text">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-red-300/15 bg-red-300/[0.035] p-3 text-xs text-danger-text">
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
            <thead className="border-y border-hairline text-[9px] uppercase tracking-[0.13em] text-ink-muted">
              <tr>
                {[
                  'Number',
                  'Customer',
                  'Provider path',
                  'Use case',
                  'Volume',
                  'Documents',
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
                  <td className="px-3 py-4 text-ink-body">
                    {textValue(row.organization_name)}
                  </td>
                  <td className="px-3 py-4 text-ink-muted">
                    <p className="capitalize">
                      {textValue(row.provider_code, 'auto')}
                    </p>
                    <p className="mt-1 text-[9px] text-ink-muted">
                      {textValue(
                        row.connection_mode,
                        textValue(row.acquisition_type),
                      ).replaceAll('_', ' ')}
                    </p>
                  </td>
                  <td className="max-w-48 px-3 py-4 text-ink-muted">
                    {textValue(row.business_use_case)}
                  </td>
                  <td className="px-3 py-4 text-ink-muted">
                    {num(row.estimated_monthly_minutes)} min
                  </td>
                  <td className="max-w-56 px-3 py-4 text-ink-muted">
                    <p>
                      {progressByNumber.get(textValue(row.id))?.approved
                        .length ?? 0}
                      {' of '}
                      {progressByNumber.get(textValue(row.id))?.required
                        .length ?? 0}
                      {' accepted'}
                    </p>
                    <p className="mt-1 text-[9px] leading-relaxed text-ink-muted">
                      {progressByNumber.get(textValue(row.id))?.message}
                    </p>
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
                          // Waiting documents are approved by this click, so
                          // they do not block it; a required one that is
                          // absent or was turned down does.
                          (progressByNumber.get(textValue(row.id))?.missing
                            .length ?? 1) +
                            (progressByNumber.get(textValue(row.id))?.rejected
                              .length ?? 0) >
                            0 ||
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
                        className="border-hairline bg-transparent"
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

      <KycDocumentReview data={data} onChanged={onChanged} />
    </div>
  );
}

/**
 * Every file a customer has sent, one decision at a time.
 *
 * The panel above could count documents and approve or reject a number's whole
 * set at once — so "approve" meant approving an address proof nobody had
 * opened, and one bad file meant sending all of them back. A reviewer could not
 * see what they were deciding about at all.
 */
function KycDocumentReview({
  data,
  onChanged,
}: {
  data: AdminPayload;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');
  const documents = data.kycDocuments ?? [];

  async function decide(documentId: string, status: 'approved' | 'rejected') {
    setBusy(documentId);
    setProblem('');
    const reason =
      status === 'rejected'
        ? (window.prompt('What is wrong with this document?') ?? '')
        : '';
    const message = await platformAction(
      {
        action: 'kyc_document_review',
        documentId,
        status,
        rejectionReason: reason,
      },
      onChanged,
    );
    if (message) setProblem(message);
    setBusy('');
  }

  return (
    <Panel>
      <PanelHeader
        title="Documents submitted"
        description="Each file a customer sent, decided one at a time. Approving a number's whole set at once meant accepting files nobody had read."
      />
      {problem ? (
        <p role="alert" className="mt-3 text-[10px] text-danger-text">
          {problem}
        </p>
      ) : null}
      {documents.length === 0 ? (
        <p className="mt-3 text-[11px] text-ink-muted">
          No documents have been submitted yet.
        </p>
      ) : null}
      <div className="mt-4 space-y-2">
        {documents.map((row) => {
          const id = textValue(row.id);
          const status = textValue(row.status, 'submitted');
          const moves = nextKycStatuses(status);
          return (
            <div
              key={id}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-surface-muted px-3 py-2.5 text-[10px]"
            >
              <span className="text-[11px] font-medium text-ink">
                {KYC_DOCUMENT_LABEL[
                  textValue(
                    row.document_type,
                  ) as keyof typeof KYC_DOCUMENT_LABEL
                ] ?? textValue(row.document_type).replaceAll('_', ' ')}
              </span>
              <span className="text-ink-muted">
                {textValue(row.organization_name)}
              </span>
              <Status value={status} />
              {row.rejection_reason ? (
                <span className="text-danger-text">
                  {textValue(row.rejection_reason)}
                </span>
              ) : null}
              <span className="ml-auto flex gap-1.5">
                {moves.includes('approved') ? (
                  <Button
                    size="sm"
                    disabled={busy === id}
                    onClick={() => void decide(id, 'approved')}
                    className="bg-emerald-300 text-[#07120d] hover:bg-emerald-200"
                  >
                    Accept
                  </Button>
                ) : null}
                {moves.includes('rejected') ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === id}
                    onClick={() => void decide(id, 'rejected')}
                    className="border-hairline bg-transparent"
                  >
                    Send back
                  </Button>
                ) : null}
                {moves.length === 0 ? (
                  <span className="text-ink-muted">Decided</span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function PlansBilling({
  data,
  onChanged,
}: {
  data: AdminPayload;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
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
        eyebrow={t('adminScreen.plans_billing.eyebrow')}
        title={t('adminScreen.plans_billing.title')}
        description={t('adminScreen.plans_billing.description')}
        action={
          <Button
            onClick={() => setShowPackage((current) => !current)}
            className="bg-primary text-primary-foreground hover:bg-[#1d4ed8]"
          >
            <PackagePlus /> New credit package
          </Button>
        }
      />
      {message ? (
        <div className="rounded-xl border border-emerald-300/15 bg-emerald-300/[0.035] p-3 text-xs text-success-text">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-red-300/15 bg-red-300/[0.035] p-3 text-xs text-danger-text">
          {error}
        </div>
      ) : null}
      {showPackage ? (
        <Panel>
          <div className="grid gap-4 md:grid-cols-[1fr_0.6fr_0.6fr_auto]">
            <label
              htmlFor="credit-package-name"
              className="text-[10px] text-ink-muted"
            >
              Package name
              <Input
                id="credit-package-name"
                value={packageName}
                onChange={(event) => setPackageName(event.target.value)}
                className="mt-2 border-hairline bg-surface-muted"
              />
            </label>
            <label
              htmlFor="credit-package-credits"
              className="text-[10px] text-ink-muted"
            >
              Credits
              <Input
                id="credit-package-credits"
                type="number"
                value={packageCredits}
                onChange={(event) =>
                  setPackageCredits(Number(event.target.value))
                }
                className="mt-2 border-hairline bg-surface-muted"
              />
            </label>
            <label
              htmlFor="credit-package-price"
              className="text-[10px] text-ink-muted"
            >
              Price in paise
              <Input
                id="credit-package-price"
                type="number"
                value={packagePrice}
                onChange={(event) =>
                  setPackagePrice(Number(event.target.value))
                }
                className="mt-2 border-hairline bg-surface-muted"
              />
            </label>
            <Button
              onClick={() => void createPackage()}
              disabled={busy}
              className="self-end bg-primary text-primary-foreground hover:bg-[#1d4ed8]"
            >
              {busy ? <Loader2 className="animate-spin" /> : <Save />} Create
            </Button>
          </div>
        </Panel>
      ) : null}
      {/*
        Creating a plan. The API has had `plan_create` — capability-mapped and
        audited — and this screen only ever sent `plan_update`, so plans could
        be edited and never created. Plans are seeded only outside production
        (`db/bootstrap.ts`, behind NODE_ENV), which meant a fresh production
        deploy had an empty `plans` table and no way to fill it: signup works,
        but no workspace could complete onboarding and go live, because going
        live requires a paid plan and there was no plan to buy.
      */}
      {(data.plans ?? []).length === 0 ? (
        <Panel>
          <PanelHeader
            title="No plans exist yet"
            description="A workspace cannot complete onboarding or go live until at least one plan exists"
          />
          <p className="mt-3 text-[11px] text-ink-body">
            Plans are not seeded in production. Create the first one below.
          </p>
        </Panel>
      ) : null}
      <NewPlan onChanged={onChanged} />
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
              className="rounded-xl border border-hairline bg-surface-muted p-4"
            >
              <div className="flex items-center justify-between">
                <Coins className="size-4 text-warning-text" />
                <Status value={textValue(item.status)} />
              </div>
              <p className="mt-4 text-sm font-medium">{textValue(item.name)}</p>
              <p className="mt-2 text-xl font-semibold">
                {num(item.credits)}{' '}
                <span className="text-[10px] font-normal text-ink-muted">
                  credits
                </span>
              </p>
              <p className="mt-1 text-[10px] text-ink-muted">
                {money(item.price)}
              </p>
              {/* A pack could be created and never withdrawn, so an offer
                  taken off the price list stayed buyable. */}
              <button
                type="button"
                onClick={() =>
                  void platformAction(
                    {
                      action: 'credit_package_status',
                      packageId: textValue(item.id),
                      status:
                        textValue(item.status) === 'active'
                          ? 'retired'
                          : 'active',
                    },
                    onChanged,
                  )
                }
                className="mt-3 text-[10px] text-ink-muted transition hover:text-ink-body"
              >
                {textValue(item.status) === 'active' ? 'Retire' : 'Bring back'}
              </button>
            </div>
          ))}
        </div>
      </Panel>
      <CurrencyRates data={data} onChanged={onChanged} />
      <CostModel data={data} onChanged={onChanged} />
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

function NewPlan({ onChanged }: { onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({
    code: '',
    name: '',
    monthlyPrice: 999900,
    includedCredits: 5000,
    maxAgents: 3,
    maxNumbers: 2,
    concurrency: 5,
    status: 'active',
  });

  async function create() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/platform', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'plan_create', ...draft }),
      });
      const payload = (await response.json()) as { error?: string };
      // The server rejects a duplicate code with 409 and says which one, so
      // that message is shown rather than replaced with something generic.
      if (!response.ok)
        throw new Error(payload.error || 'Unable to create plan.');
      setOpen(false);
      setDraft({ ...draft, code: '', name: '' });
      await onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to create plan.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <Button
        onClick={() => setOpen(true)}
        className="self-start bg-primary text-primary-foreground hover:bg-[#1d4ed8]"
      >
        <Save /> Create a plan
      </Button>
    );

  return (
    <Panel>
      <PanelHeader
        title="Create a plan"
        description="Code is permanent and becomes the plan id; everything else can be edited later"
      />
      {error ? (
        <p className="mt-3 text-[11px] text-danger-text">{error}</p>
      ) : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label htmlFor="new-plan-code" className="text-[10px] text-ink-muted">
          Code
          <Input
            id="new-plan-code"
            value={draft.code}
            onChange={(event) =>
              setDraft({ ...draft, code: event.target.value })
            }
            placeholder="growth"
            className="mt-2 border-hairline bg-surface-muted"
          />
        </label>
        <label htmlFor="new-plan-name" className="text-[10px] text-ink-muted">
          Name
          <Input
            id="new-plan-name"
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
            placeholder="Growth"
            className="mt-2 border-hairline bg-surface-muted"
          />
        </label>
        {(
          [
            ['monthlyPrice', 'Monthly price (paise)'],
            ['includedCredits', 'Included credits'],
            ['maxAgents', 'Max agents'],
            ['maxNumbers', 'Max numbers'],
            ['concurrency', 'Concurrency'],
          ] as const
        ).map(([field, label]) => (
          <label
            key={field}
            htmlFor={`new-plan-${field}`}
            className="text-[10px] text-ink-muted"
          >
            {label}
            <Input
              id={`new-plan-${field}`}
              type="number"
              value={draft[field]}
              onChange={(event) =>
                setDraft({ ...draft, [field]: Number(event.target.value) })
              }
              className="mt-2 border-hairline bg-surface-muted"
            />
          </label>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <Button
          onClick={() => void create()}
          disabled={busy || !draft.code.trim() || !draft.name.trim()}
          className="bg-primary text-primary-foreground hover:bg-[#1d4ed8]"
        >
          {busy ? <Loader2 className="animate-spin" /> : <Save />} Create plan
        </Button>
        <Button
          variant="outline"
          onClick={() => setOpen(false)}
          className="border-hairline"
        >
          Cancel
        </Button>
      </div>
    </Panel>
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
        <Badge variant="outline" className="border-hairline text-ink-muted">
          {textValue(plan.code)}
        </Badge>
        <Status value={draft.status} />
      </div>
      {editing ? (
        <div className="mt-5 space-y-3">
          {error ? (
            <p className="rounded-lg border border-red-300/15 bg-red-300/[0.035] p-2 text-[10px] text-danger-text">
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
            <label className="text-[9px] text-ink-muted">
              Status
              <select
                value={draft.status}
                onChange={(event) =>
                  setDraft({ ...draft, status: event.target.value })
                }
                className="mt-2 h-9 w-full rounded-lg border border-hairline bg-surface px-3 text-xs"
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
              className="flex-1 bg-primary text-primary-foreground hover:bg-[#1d4ed8]"
            >
              {busy ? <Loader2 className="animate-spin" /> : <Save />} Save plan
            </Button>
            <Button
              variant="outline"
              onClick={() => setEditing(false)}
              className="border-hairline bg-transparent"
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
            <span className="text-xs font-normal text-ink-muted"> / month</span>
          </p>
          <div className="mt-5 space-y-2 text-xs text-ink-body">
            <p>{num(draft.includedCredits)} included credits</p>
            <p>
              {num(draft.maxAgents)} agents · {num(draft.maxNumbers)} numbers
            </p>
            <p>{num(draft.concurrency)} concurrent calls</p>
          </div>
          <Button
            onClick={() => setEditing(true)}
            variant="outline"
            className="mt-6 w-full border-hairline bg-transparent"
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
    <label className="text-[9px] text-ink-muted">
      {label}
      <Input
        type={number ? 'number' : 'text'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-9 border-hairline bg-surface-muted text-xs"
      />
    </label>
  );
}

function TrialsCommerce({ data }: { data: AdminPayload }) {
  const t = useT();
  const stats = data.stats ?? {};
  const rows = data.commerce ?? [];
  const collected = rows
    .filter((row) => textValue(row.status) === 'paid')
    .reduce((total, row) => total + Number(row.amount ?? 0), 0);
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow={t('adminScreen.trials_commerce.eyebrow')}
        title={t('adminScreen.trials_commerce.title')}
        description={t('adminScreen.trials_commerce.description')}
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
            <thead className="border-y border-hairline text-[9px] uppercase tracking-[0.13em] text-ink-muted">
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
                  <td className="px-3 py-4 font-mono text-warning-text">
                    {textValue(row.reference_id)}
                  </td>
                  <td className="px-3 py-4 text-ink-body">
                    {textValue(row.organization_name)}
                  </td>
                  <td className="px-3 py-4 text-ink-body">
                    {textValue(row.customer_name)}
                  </td>
                  <td className="px-3 py-4">{money(row.amount)}</td>
                  <td className="px-3 py-4 text-ink-muted">
                    {textValue(row.delivery_mode).replaceAll('_', ' ')}
                  </td>
                  <td className="px-3 py-4 text-ink-muted">
                    {textValue(row.provider).replaceAll('_', ' ')}
                  </td>
                  <td className="px-3 py-4">
                    <Status value={textValue(row.status)} />
                  </td>
                  <td className="px-3 py-4 text-[10px] text-ink-muted">
                    {formatDate(row.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 ? (
            <p className="py-10 text-center text-xs text-ink-muted">
              No payment links yet.
            </p>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}

function Integrations({ data }: { data: AdminPayload }) {
  const t = useT();
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow={t('adminScreen.integrations.eyebrow')}
        title={t('adminScreen.integrations.title')}
        description={t('adminScreen.integrations.description')}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {(data.integrations ?? []).map((item) => (
          <Panel key={`${textValue(item.type)}-${textValue(item.status)}`}>
            <div className="flex items-start gap-4">
              <span className="grid size-10 place-items-center rounded-xl bg-violet-400/10">
                <Webhook className="size-4 text-violet-700" />
              </span>
              <div className="flex-1">
                <p className="text-sm font-medium">{textValue(item.name)}</p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-ink-muted">
                  {textValue(item.type).replaceAll('_', ' ')}
                </p>
              </div>
              <Status value={textValue(item.status)} />
            </div>
            <div className="mt-5 flex items-center justify-between rounded-xl bg-surface-muted p-3 text-xs">
              <span className="text-ink-muted">Connected tenants</span>
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
              className="rounded-xl border border-hairline bg-surface-muted p-4"
            >
              <Icon className="size-4 text-warning-text" />
              <p className="mt-4 text-xs font-medium">{String(title)}</p>
              <p className="mt-1 text-[10px] text-ink-muted">{String(note)}</p>
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
    <div className="rounded-xl border border-hairline bg-surface-muted p-4">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium">{provider.name}</p>
          <p className="mt-1 text-[9px] text-ink-muted">{provider.note}</p>
        </div>
        <Status value={hasKey ? 'key set' : 'not set'} />
      </div>

      <label className="mt-4 block text-[9px] uppercase tracking-wider text-ink-muted">
        API key {hasKey ? '(leave blank to keep current)' : ''}
      </label>
      <Input
        type="password"
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
        placeholder={hasKey ? '•••••••• saved' : 'Paste key'}
        className="mt-1 h-9 border-hairline bg-surface-muted text-xs"
      />

      {provider.fields.map((field) => (
        <div key={field.k}>
          <label className="mt-3 block text-[9px] uppercase tracking-wider text-ink-muted">
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
            className="mt-1 h-9 border-hairline bg-surface-muted text-xs"
          />
        </div>
      ))}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          disabled={busy === 'save'}
          onClick={save}
          className="h-8 bg-primary text-[10px] text-primary-foreground hover:bg-[#1d4ed8]"
        >
          {busy === 'save' ? <Loader2 className="animate-spin" /> : null} Save
        </Button>
        {provider.fetchVoices ? (
          <Button
            variant="outline"
            disabled={busy === 'voices'}
            onClick={fetchVoices}
            className="h-8 border-hairline bg-transparent text-[10px]"
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
            className="h-8 border-red-400/20 bg-transparent text-[10px] text-danger-text"
          >
            Clear
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="mt-2 text-[10px] text-danger-text">{error}</p>
      ) : null}
      {notice ? (
        <p className="mt-2 text-[10px] font-medium text-success-text">
          {notice}
        </p>
      ) : null}

      {voices.length ? (
        <div className="mt-3 max-h-44 overflow-y-auto rounded-lg border border-hairline bg-surface-muted p-2">
          <p className="mb-1 px-1 text-[9px] uppercase tracking-wider text-ink-muted">
            {voices.length} voices · tap to select
          </p>
          {voices.map((voice) => (
            <button
              key={voice.voiceId}
              type="button"
              onClick={() =>
                setConfig((current) => ({ ...current, voiceId: voice.voiceId }))
              }
              className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[11px] hover:bg-surface-strong ${config.voiceId === voice.voiceId ? 'bg-surface-strong text-ink' : 'text-ink'}`}
            >
              <span className="truncate">
                {voice.name}
                {voice.category ? (
                  <span className="ml-2 text-[9px] text-ink-muted">
                    {voice.category}
                  </span>
                ) : null}
              </span>
              {config.voiceId === voice.voiceId ? (
                <span className="text-[9px] text-success-text">selected</span>
              ) : null}
            </button>
          ))}
          <p className="mt-1 px-1 text-[8px] text-ink-muted">
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
  const t = useT();
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
        eyebrow={t('adminScreen.platform_apis.eyebrow')}
        title={t('adminScreen.platform_apis.title')}
        description={t('adminScreen.platform_apis.description')}
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
                className="rounded-xl border border-hairline bg-surface-muted p-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">
                      {textValue(provider.display_name)}
                    </p>
                    <p className="mt-1 text-[9px] text-ink-muted">
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
                    className="border-hairline bg-transparent text-[10px]"
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
                    className="border-hairline bg-transparent text-[10px]"
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
              className="rounded-xl border border-hairline bg-surface-muted p-4"
            >
              <div className="flex items-center justify-between">
                <Network className="size-4 text-cyan-700" />
                <Badge
                  variant="outline"
                  className="border-hairline text-[8px] text-ink-muted"
                >
                  {priority}
                </Badge>
              </div>
              <p className="mt-4 text-xs font-medium">{title}</p>
              <p className="mt-2 text-[9px] leading-4 text-ink-muted">{note}</p>
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
                <span className="grid size-10 place-items-center rounded-xl border border-hairline bg-surface-strong">
                  <ServerCog className="size-4 text-primary" />
                </span>
                <Status value={textValue(provider.health)} />
              </div>
              <h2 className="mt-5 text-sm font-semibold">
                {textValue(provider.public_name)}
              </h2>
              <p className="mt-1 text-[9px] uppercase tracking-wider text-ink-muted">
                {textValue(provider.category)}
              </p>
              <p className="mt-3 text-xs leading-5 text-ink-muted">
                {textValue(provider.usage_note)}
              </p>
              <div className="mt-4 rounded-xl border border-hairline bg-surface-muted p-3">
                <p className="text-[8px] uppercase tracking-wider text-ink-muted">
                  Required environment secrets
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {required.map((item) => (
                    <code
                      key={item}
                      className="rounded bg-surface-strong px-2 py-1 text-[8px] text-ink-body"
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
                className="mt-4 w-full border-hairline bg-transparent text-[10px]"
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
  const t = useT();
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
        eyebrow={t('adminScreen.support_tickets.eyebrow')}
        title={t('adminScreen.support_tickets.title')}
        description={t('adminScreen.support_tickets.description')}
      />
      {error ? (
        <p className="rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2 text-[11px] text-danger-text">
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
                  <p className="mt-1 text-[9px] text-ink-muted">
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
                    className={`rounded-xl border p-3 text-[10px] leading-5 ${message.sender_role === 'admin' ? 'border-violet-300/10 bg-violet-300/[0.035]' : 'border-hairline bg-surface-muted'}`}
                  >
                    <p className="mb-1 text-[8px] uppercase tracking-wider text-ink-muted">
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
                className="mt-4 w-full rounded-lg border border-hairline bg-surface-muted p-2.5 text-[11px] text-ink outline-none placeholder:text-ink-muted focus:border-hairline"
              />
              <div className="mt-2 flex gap-2">
                <Button
                  variant="outline"
                  disabled={busy === textValue(ticket.id)}
                  onClick={() => act(textValue(ticket.id), 'ticket_reply')}
                  className="flex-1 border-hairline bg-transparent text-[9px]"
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
  const t = useT();
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow={t('adminScreen.system_audit.eyebrow')}
        title={t('adminScreen.system_audit.title')}
        description={t('adminScreen.system_audit.description')}
      />
      {data.health ? (
        <Panel>
          <PanelHeader
            title="API health center"
            description={`Every component classified from evidence over the last ${data.health.windowMinutes} minutes. Nothing is asserted.`}
          />
          <div className="mt-3 flex items-center gap-3">
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] ${HEALTH_TONE[data.health.overall] ?? HEALTH_TONE.unknown}`}
            >
              <span className="size-1.5 rounded-full bg-current" />
              Platform: {data.health.overall}
            </span>
            <span className="text-[10px] text-ink-muted">
              {/* `unknown` outranks `healthy` on purpose: a platform with an
                  unmeasured component is not known to be healthy. */}
              measured {formatDate(data.health.measuredAt)}
            </span>
          </div>
          {/* A job that completes while doing nothing looks exactly like one
              that worked. Nothing failed, so nothing was reported — and the
              customer was never reminded. */}
          {data.health.silentJobs?.length ? (
            <div className="mt-4 space-y-1.5">
              {data.health.silentJobs.map((job) => (
                <p
                  key={job.type}
                  className="rounded-lg border border-hairline bg-surface-muted px-3 py-2 text-[10px] leading-5 text-ink-body"
                >
                  {job.message}
                  {job.runs > 1 ? ` Seen on ${job.runs} runs.` : ''}
                </p>
              ))}
            </div>
          ) : null}
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {data.health.components.map((component) => (
              <div
                key={component.component}
                className="rounded-xl border border-hairline bg-surface p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[11px] font-medium">
                    {component.component.replace(/^provider_/, '')}
                  </p>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] ${HEALTH_TONE[component.state] ?? HEALTH_TONE.unknown}`}
                  >
                    {component.state}
                  </span>
                </div>
                <p className="mt-1.5 text-[10px] leading-4 text-ink-muted">
                  {component.reason}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-ink-faint">
                  {component.p95LatencyMs !== null ? (
                    <span>p95 {num(component.p95LatencyMs)} ms</span>
                  ) : null}
                  {component.errorRate !== null ? (
                    <span>
                      errors {(component.errorRate * 100).toFixed(1)}%
                    </span>
                  ) : null}
                  {component.quotaUsedFraction !== null ? (
                    <span>
                      quota {(component.quotaUsedFraction * 100).toFixed(0)}%
                    </span>
                  ) : null}
                  {component.tokenState !== 'none' ? (
                    <span>token {component.tokenState}</span>
                  ) : null}
                  {component.breaker !== 'closed' ? (
                    <span className="text-warning-text">
                      breaker {component.breaker}
                    </span>
                  ) : null}
                  <span>
                    {component.lastSuccessAt
                      ? `last ok ${formatDate(component.lastSuccessAt)}`
                      : 'never succeeded'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

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
              <span className="mt-0.5 grid size-8 place-items-center rounded-lg bg-surface-strong">
                <ShieldCheck className="size-3.5 text-ink-muted" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">
                  {textValue(row.action).replaceAll('.', ' · ')}
                </p>
                <p className="mt-1 text-[10px] text-ink-muted">
                  {textValue(row.actor_name, 'System')} ·{' '}
                  {textValue(row.organization_name, 'Platform')} ·{' '}
                  {textValue(row.target_type)}
                </p>
              </div>
              <span className="text-[9px] text-ink-muted">
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
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
          {eyebrow}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          {title}
        </h1>
        <p className="mt-2 max-w-3xl text-xs leading-5 text-ink-muted sm:text-sm">
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
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-muted">
          {label}
        </p>
        <Icon className="size-4 text-primary" />
      </div>
      <p className="mt-4 text-2xl font-semibold tracking-tight">
        {String(value)}
      </p>
      <p className="mt-1 text-[10px] text-ink-muted">{note}</p>
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
      <p className="mt-1 text-[10px] text-ink-muted">{description}</p>
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
      className={`inline-flex rounded-full border px-2 py-1 text-[9px] capitalize ${positive ? 'border-emerald-400/15 bg-emerald-400/7 text-success-text' : warning ? 'border-amber-300/15 bg-amber-300/7 text-warning-text' : 'border-hairline bg-surface-strong text-ink-muted'}`}
    >
      {value.replaceAll('_', ' ')}
    </span>
  );
}

function LoadingState() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="text-center">
        <Loader2 className="mx-auto size-6 animate-spin text-warning-text" />
        <p className="mt-3 text-xs text-ink-muted">
          Loading platform control plane…
        </p>
      </div>
    </div>
  );
}
function ErrorState({ error, retry }: { error: string; retry: () => void }) {
  return (
    <div className="mx-auto mt-20 max-w-md rounded-2xl border border-red-400/15 bg-red-400/5 p-6 text-center">
      <p className="text-sm text-danger-text">{error}</p>
      <Button
        onClick={retry}
        variant="outline"
        className="mt-4 border-hairline bg-transparent"
      >
        <RefreshCcw /> Retry
      </Button>
    </div>
  );
}
/** One place for every PATCH to the platform route, so refusals are shown. */
async function platformAction(
  payload: Record<string, unknown>,
  onChanged: () => Promise<void> | void,
): Promise<string | null> {
  try {
    const response = await fetch('/api/admin/platform', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) return textValue(body.error, 'Action failed.');
    await onChanged();
    return null;
  } catch {
    return 'Action failed.';
  }
}

/**
 * Exchange rates and country prices.
 *
 * `fx_rates` and `price_books` were read by `lib/workspace-pricing.ts` and
 * written by nothing at all, so a workspace billing in anything other than the
 * base currency could not be priced — `priceForWorkspace` refuses rather than
 * charging ₹7,999 as $7,999, which was right, and also meant it always
 * refused. This is the screen that gives it something to read.
 */
function CurrencyRates({
  data,
  onChanged,
}: {
  data: AdminPayload;
  onChanged: () => Promise<void> | void;
}) {
  const [fx, setFx] = useState({ base: 'INR', quote: '', rate: '' });
  const [price, setPrice] = useState({
    productType: 'plan',
    productId: '',
    country: '',
    currency: '',
    amountMinor: '',
  });
  const [notice, setNotice] = useState<string | null>(null);

  const field =
    'h-8 rounded-lg border border-hairline bg-surface px-2.5 text-[11px]';

  return (
    <Panel>
      <PanelHeader
        title="Exchange rates and country prices"
        description="What a workspace outside the base currency is charged. Without a rate or a price-book entry, pricing refuses rather than guessing."
      />
      {notice ? (
        <p role="alert" className="mt-3 text-[10px] text-danger-text">
          {notice}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <input
          aria-label="Base currency"
          value={fx.base}
          onChange={(event) => setFx({ ...fx, base: event.target.value })}
          placeholder="INR"
          className={`${field} w-20`}
        />
        <input
          aria-label="Quote currency"
          value={fx.quote}
          onChange={(event) => setFx({ ...fx, quote: event.target.value })}
          placeholder="USD"
          className={`${field} w-20`}
        />
        <input
          aria-label="Rate"
          value={fx.rate}
          onChange={(event) => setFx({ ...fx, rate: event.target.value })}
          placeholder="0.012"
          className={`${field} w-28`}
        />
        <button
          type="button"
          disabled={!fx.quote.trim() || !fx.rate.trim()}
          onClick={async () =>
            setNotice(
              await platformAction(
                {
                  action: 'fx_rate_set',
                  baseCurrency: fx.base,
                  quoteCurrency: fx.quote,
                  rate: Number(fx.rate),
                },
                onChanged,
              ),
            )
          }
          className="portal-primary h-8 rounded-lg px-3 text-[11px] disabled:opacity-40"
        >
          Set rate
        </button>
      </div>
      <div className="mt-3 space-y-1">
        {(data.fxRates ?? []).length === 0 ? (
          <p className="text-[10px] text-ink-muted">
            No rates yet, so only the base currency can be priced.
          </p>
        ) : null}
        {(data.fxRates ?? []).map((row: Record<string, unknown>) => (
          <p key={textValue(row.id)} className="text-[10px] text-ink-body">
            1 {textValue(row.base_currency)} = {num(row.rate)}{' '}
            {textValue(row.quote_currency)}
            <span className="text-ink-muted">
              {' '}
              · from {textValue(row.effective_from).slice(0, 10)} ·{' '}
              {textValue(row.source, 'manual')}
            </span>
          </p>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-2">
        <select
          aria-label="Product type"
          value={price.productType}
          onChange={(event) =>
            setPrice({ ...price, productType: event.target.value })
          }
          className={`${field} w-32`}
        >
          <option value="plan">Plan</option>
          <option value="credit_package">Credit package</option>
        </select>
        <input
          aria-label="Product id"
          value={price.productId}
          onChange={(event) =>
            setPrice({ ...price, productId: event.target.value })
          }
          placeholder="plan id"
          className={`${field} w-44`}
        />
        <input
          aria-label="Country"
          value={price.country}
          onChange={(event) =>
            setPrice({ ...price, country: event.target.value })
          }
          placeholder="any"
          className={`${field} w-16`}
        />
        <input
          aria-label="Currency"
          value={price.currency}
          onChange={(event) =>
            setPrice({ ...price, currency: event.target.value })
          }
          placeholder="USD"
          className={`${field} w-20`}
        />
        <input
          aria-label="Amount in minor units"
          value={price.amountMinor}
          onChange={(event) =>
            setPrice({ ...price, amountMinor: event.target.value })
          }
          placeholder="4999"
          className={`${field} w-28`}
        />
        <button
          type="button"
          disabled={!price.productId.trim() || !price.currency.trim()}
          onClick={async () =>
            setNotice(
              await platformAction(
                {
                  action: 'price_book_set',
                  productType: price.productType,
                  productId: price.productId,
                  country: price.country,
                  currency: price.currency,
                  amountMinor: Number(price.amountMinor),
                },
                onChanged,
              ),
            )
          }
          className="portal-primary h-8 rounded-lg px-3 text-[11px] disabled:opacity-40"
        >
          Set price
        </button>
      </div>
      <p className="mt-2 text-[10px] text-ink-muted">
        Minor units — 4999 is $49.99. Leave the country blank for anywhere using
        that currency.
      </p>
      <div className="mt-3 space-y-1">
        {(data.priceBooks ?? []).map((row: Record<string, unknown>) => (
          <p key={textValue(row.id)} className="text-[10px] text-ink-body">
            {textValue(row.product_type)} {textValue(row.product_id)} ·{' '}
            {textValue(row.country) || 'any country'} · {num(row.amount_minor)}{' '}
            {textValue(row.currency)}
            {Number(row.active) === 1 ? '' : ' · inactive'}
          </p>
        ))}
      </div>
    </Panel>
  );
}

/**
 * What a minute costs, and whether each plan survives it.
 *
 * The panel above this one divides revenue by cost over the last 30 days — a
 * rear-view mirror. This is the question asked *before* a price is set. Two
 * things it will not do: treat a provider with no rate card as free, and
 * present an assumption as a measurement.
 */
function CostModel({
  data,
  onChanged,
}: {
  data: AdminPayload;
  onChanged: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState({
    provider: '',
    category: 'messaging',
    unit: 'messages',
    model: '',
    priceMicros: '',
  });
  const [notice, setNotice] = useState<string | null>(null);
  // The panel refetches only itself when the target moves, so dragging the
  // margin does not remount the whole admin screen.
  const [override, setOverride] = useState<AdminPayload['costModel'] | null>(
    null,
  );
  const model = override ?? data.costModel;
  const targetMargin = model?.targetMargin ?? 0.7;

  async function retarget(next: number) {
    try {
      const response = await fetch(`/api/admin/overview?targetMargin=${next}`, {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as AdminPayload;
      setOverride(payload.costModel ?? null);
    } catch {
      /* leave the last good model on screen rather than blanking it */
    }
  }

  const field =
    'h-8 rounded-lg border border-hairline bg-surface px-2.5 text-[11px]';

  return (
    <Panel>
      <PanelHeader
        title="What a minute costs"
        description="Built from the rate cards below and this deployment's own measured usage. A provider with no rate card is reported as missing, never as free."
      />
      {notice ? (
        <p role="alert" className="mt-3 text-[10px] text-danger-text">
          {notice}
        </p>
      ) : null}

      {model ? (
        <>
          <p className="mt-4 text-[11px] font-medium text-ink">
            {model.minute.summary}
          </p>
          <div className="mt-3 space-y-1">
            {model.minute.components.map((component) => (
              <p key={component.key} className="text-[10px] text-ink-muted">
                <span className="text-ink-body">{component.label}</span>
                {' · '}
                {component.quantity}
                {' · '}
                {component.micros === null ? (
                  <span className="text-warning-text">no rate card</span>
                ) : (
                  formatMicros(component.micros)
                )}
              </p>
            ))}
          </div>
          <div className="mt-3 space-y-1 text-[10px] text-ink-body">
            <p>{model.call.summary}</p>
            <p>{model.message.summary}</p>
            <p>{model.fixed.summary}</p>
          </div>

          <div className="mt-5 space-y-1.5">
            {model.plans.map((plan) => (
              <p
                key={plan.id}
                className="rounded-lg border border-hairline bg-surface-muted px-3 py-2 text-[10px]"
              >
                <span className="text-[11px] font-medium text-ink">
                  {plan.name}
                </span>
                <span className="text-ink-muted">
                  {' · '}
                  {plan.includedMinutes.toLocaleString('en-IN')} included
                  minutes
                </span>
                <br />
                <span
                  className={
                    plan.summary.startsWith('Loses') ||
                    plan.summary.startsWith('Free plan')
                      ? 'text-danger-text'
                      : 'text-ink-body'
                  }
                >
                  {plan.summary}
                </span>
                <br />
                <span
                  className={
                    (plan.suggestion.shortfallMicros ?? 0) > 0
                      ? 'text-warning-text'
                      : 'text-ink-muted'
                  }
                >
                  {plan.suggestion.summary}
                </span>
              </p>
            ))}
          </div>

          {/* What a minute sells for, next to what it costs. */}
          <div className="mt-4 space-y-1">
            <p className="text-[11px] font-medium text-ink">
              What a minute sells for
            </p>
            {model.credits.map((pack) => (
              <p key={pack.packName} className="text-[10px] text-ink-muted">
                <span className="text-ink-body">{pack.packName}</span>
                {' · '}
                {pack.summary}
              </p>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label
              htmlFor="target-margin"
              className="text-[10px] text-ink-muted"
            >
              Target margin
            </label>
            <input
              id="target-margin"
              type="range"
              min={0}
              max={95}
              step={5}
              value={Math.round(targetMargin * 100)}
              onChange={(event) =>
                void retarget(Number(event.target.value) / 100)
              }
              className="w-48"
            />
            <span className="text-[11px] font-medium text-ink">
              {Math.round(targetMargin * 100)}%
            </span>
          </div>

          {/* An assumption said out loud is worth more than a number that
              looks measured. */}
          <p className="mt-3 text-[9px] leading-4 text-ink-muted">
            {model.assumptions.note}
          </p>
        </>
      ) : null}

      <div className="mt-6 flex flex-wrap items-end gap-2">
        <input
          aria-label="Provider"
          value={draft.provider}
          onChange={(event) =>
            setDraft({ ...draft, provider: event.target.value })
          }
          placeholder="meta"
          className={`${field} w-28`}
        />
        <select
          aria-label="Cost category"
          value={draft.category}
          onChange={(event) =>
            setDraft({ ...draft, category: event.target.value })
          }
          className={`${field} w-36`}
        >
          {[
            'llm',
            'stt',
            'tts',
            'telephony',
            'messaging',
            'storage',
            'payments',
            'infrastructure',
          ].map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
        <select
          aria-label="Unit"
          value={draft.unit}
          onChange={(event) => setDraft({ ...draft, unit: event.target.value })}
          className={`${field} w-40`}
        >
          {USAGE_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </select>
        <input
          aria-label="Model"
          value={draft.model}
          onChange={(event) =>
            setDraft({ ...draft, model: event.target.value })
          }
          placeholder="model (optional)"
          className={`${field} w-36`}
        />
        <input
          aria-label="Price in micros"
          value={draft.priceMicros}
          onChange={(event) =>
            setDraft({ ...draft, priceMicros: event.target.value })
          }
          placeholder="micros per batch"
          className={`${field} w-36`}
        />
        <button
          type="button"
          disabled={!draft.provider.trim() || !draft.priceMicros.trim()}
          onClick={async () =>
            setNotice(
              await platformAction(
                {
                  action: 'rate_card_set',
                  provider: draft.provider,
                  category: draft.category,
                  unit: draft.unit,
                  model: draft.model,
                  priceMicros: Number(draft.priceMicros),
                },
                onChanged,
              ),
            )
          }
          className="portal-primary h-8 rounded-lg px-3 text-[11px] disabled:opacity-40"
        >
          Set rate
        </button>
      </div>
      <p className="mt-2 text-[10px] text-ink-muted">
        Micros of a rupee per batch — a million tokens, a thousand characters,
        an hour of audio, one message, one month. 1,000,000 micros is ₹1.
      </p>

      <div className="mt-3 space-y-1">
        {(data.rateCards ?? []).slice(0, 14).map((row, index) => (
          <p
            key={`${textValue(row.provider)}-${textValue(row.unit)}-${index}`}
            className="text-[10px] text-ink-muted"
          >
            {textValue(row.provider)}
            {row.model ? ` ${textValue(row.model)}` : ''} ·{' '}
            {textValue(row.category)} · {textValue(row.unit)} ·{' '}
            {formatMicros(Number(row.price_micros))}
          </p>
        ))}
      </div>
    </Panel>
  );
}

/** Micros of a rupee, kept readable at the sizes these actually take. */
function formatMicros(micros: number) {
  const rupees = micros / 1_000_000;
  if (rupees === 0) return '₹0';
  if (Math.abs(rupees) < 1) return `₹${rupees.toFixed(rupees < 0.01 ? 4 : 2)}`;
  return `₹${rupees.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function num(value: unknown) {
  return Number(value ?? 0).toLocaleString('en-IN');
}
/** §29's five states, in the semantic colours §4 names. */
const HEALTH_TONE: Record<string, string> = {
  healthy: 'border-[#16A34A]/25 bg-[#16A34A]/8 text-success-text',
  degraded: 'border-[#D97706]/25 bg-[#D97706]/8 text-warning-text',
  unhealthy: 'border-[#DC2626]/25 bg-[#DC2626]/8 text-danger-text',
  unknown: 'border-hairline bg-surface-strong text-ink-muted',
  maintenance: 'border-primary/25 bg-primary/8 text-primary',
};

function money(value: unknown, currency = 'INR') {
  return formatMoney(Math.round(Number(value ?? 0)), currency);
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
