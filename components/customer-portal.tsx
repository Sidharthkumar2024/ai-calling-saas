'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Bot,
  BrainCircuit,
  BookOpenText,
  Cable,
  CircleDollarSign,
  ContactRound,
  CreditCard,
  Database,
  Activity,
  PhoneOutgoing,
  Building2,
  Gauge,
  Globe2,
  GitBranch,
  Headphones,
  LayoutDashboard,
  LifeBuoy,
  Loader2,
  Megaphone,
  Mic2,
  ShieldAlert,
  PhoneCall,
  Radio,
  RefreshCcw,
  Repeat2,
  Settings2,
  Sparkles,
  Target,
  UsersRound,
  Webhook,
  Workflow,
  Zap,
  FileAudio,
  FileBarChart2,
} from 'lucide-react';

import {
  CustomerCrm,
  type LeadTimelineEvent,
  type SavedLeadView,
  type CrmActivity,
  type CrmLead,
} from '@/components/customer-crm';
import {
  CustomerBilling,
  type BillingData,
} from '@/components/customer-billing';
import {
  CustomerIntegrations,
  type ApiKeysData,
  type IntegrationsData,
  type WebhooksData,
} from '@/components/customer-integrations';
import {
  CustomerNumbers,
  type CustomerNumbersData,
} from '@/components/customer-numbers';
import {
  CustomerAgentStudio,
  type AgentsData,
} from '@/components/customer-agent-studio';
import {
  CustomerCommerce,
  type CommerceData,
} from '@/components/customer-commerce';
import { CustomerAgentDesk } from '@/components/customer-agent-desk';
import { CustomerDialer } from '@/components/customer-dialer';
import { CustomerDiagnostics } from '@/components/customer-diagnostics';
import { CustomerOrgStructure } from '@/components/customer-org-structure';
import { CustomerApprovals } from '@/components/customer-approvals';
import { CustomerVoiceProfiles } from '@/components/customer-voice-profiles';
import { PortalShell, type PortalNavGroup } from '@/components/portal-shell';
import {
  CreditWatch,
  NotificationCenter,
} from '@/components/notification-center';
import { CustomerSecurity } from '@/components/customer-security';
import { CustomerGrowth } from '@/components/customer-growth';
import { CustomerWorkflowBuilder } from '@/components/customer-workflow-builder';
import {
  CustomerOperations,
  type OperationsData,
  type OperationsModule,
} from '@/components/customer-operations';
import {
  CustomerTickets,
  type TicketsData,
} from '@/components/customer-tickets';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ActivityAreaChart,
  DistributionChart,
} from '@/components/analytics-charts';
import { CustomerTeam, type TeamData } from '@/components/customer-team';
import {
  CustomerLeadCapture,
  type LeadFormsData,
} from '@/components/customer-lead-capture';

type CustomerSession = {
  name: string;
  email: string;
  organizationName: string;
  workspaceRole: string;
  permissions: string[];
};

type OverviewStats = {
  credits?: number;
  leads?: number;
  qualified?: number;
  pipelineValue?: number;
  opportunities?: number;
  calls?: number;
  queuedCalls?: number;
  averageScore?: number;
};
type LeadSource = { type: string; name: string; status: string };
type RecentLead = {
  id: string;
  name: string;
  phone: string;
  source_name: string;
  score: number;
  intent: string;
  estimated_value: number;
  stage?: string | null;
  status: string;
};
type OverviewData = {
  stats?: OverviewStats;
  sources?: LeadSource[];
  recentLeads?: RecentLead[];
  activitySeries?: Array<Record<string, string | number>>;
  outcomeBreakdown?: Array<Record<string, string | number>>;
  providerReadiness?: Array<{
    adapter: string;
    publicName: string;
    configured: boolean;
    mode: string;
  }>;
};
type RetargetingData = {
  audiences?: Array<{
    id: string;
    name: string;
    destination: string;
    status: string;
    eligible_count: number;
    last_synced_at: string | null;
    rules_json: string;
  }>;
};

export type CustomerData = {
  overview: OverviewData;
  crm: {
    pipeline: CrmLead[];
    activities: CrmActivity[];
    timeline?: Record<string, LeadTimelineEvent[]>;
    savedViews?: SavedLeadView[];
  };
  numbers: CustomerNumbersData;
  integrations: IntegrationsData;
  apiKeys: ApiKeysData;
  webhooks: WebhooksData;
  billing: BillingData;
  agents: AgentsData;
  commerce: CommerceData;
  operations: OperationsData;
  tickets: TicketsData;
  team: TeamData;
  leadForms: LeadFormsData;
  retargeting: RetargetingData;
};

const groups: PortalNavGroup[] = [
  {
    label: 'Operate',
    translationKey: 'nav.group.operate',
    items: [
      {
        id: 'overview',
        label: 'Overview',
        icon: LayoutDashboard,
        translationKey: 'nav.overview',
      },
      {
        id: 'crm',
        label: 'Advanced CRM',
        icon: Target,
        translationKey: 'nav.crm',
      },
      {
        id: 'growth',
        label: 'AI business manager',
        icon: Sparkles,
        translationKey: 'nav.growth',
      },
      {
        id: 'agents',
        label: 'AI agents',
        icon: Bot,
        translationKey: 'nav.agents',
      },
      {
        id: 'voice_profiles',
        label: 'Voice profiles',
        icon: Mic2,
        translationKey: 'nav.voice_profiles',
      },
      {
        id: 'graph_agents',
        label: 'Graph agents',
        icon: GitBranch,
        translationKey: 'nav.graph_agents',
      },
      {
        id: 'workflows',
        label: 'Workflows',
        icon: Workflow,
        translationKey: 'nav.workflows',
      },
      {
        id: 'knowledge',
        label: 'Knowledge base',
        icon: BookOpenText,
        translationKey: 'nav.knowledge',
      },
      {
        id: 'campaigns',
        label: 'Campaigns',
        icon: Radio,
        badge: 'Live',
        translationKey: 'nav.campaigns',
      },
      {
        id: 'numbers',
        label: 'My numbers',
        icon: Globe2,
        translationKey: 'nav.numbers',
      },
      {
        id: 'sip_trunks',
        label: 'SIP trunks',
        icon: Cable,
        translationKey: 'nav.sip_trunks',
      },
    ],
  },
  {
    label: 'Observe',
    items: [
      {
        id: 'call_history',
        label: 'Call history',
        icon: PhoneCall,
        translationKey: 'nav.call_history',
      },
      {
        id: 'live_monitor',
        label: 'Live monitoring',
        icon: Headphones,
        badge: '1',
        translationKey: 'nav.live_monitor',
      },
      {
        id: 'analytics',
        label: 'Analytics',
        icon: BarChart3,
        translationKey: 'nav.analytics',
      },
      {
        id: 'quality',
        label: 'AI quality assurance',
        icon: FileAudio,
        translationKey: 'nav.quality',
      },
      {
        id: 'alerts',
        label: 'Alerts',
        icon: AlertTriangle,
        translationKey: 'nav.alerts',
      },
      {
        id: 'reports',
        label: 'Reports',
        icon: FileBarChart2,
        translationKey: 'nav.reports',
      },
    ],
  },
  {
    label: 'Grow',
    translationKey: 'nav.group.grow',
    items: [
      {
        id: 'lead_capture',
        label: 'Lead capture',
        icon: Megaphone,
        translationKey: 'nav.lead_capture',
      },
      {
        id: 'retargeting',
        label: 'Retargeting',
        icon: Repeat2,
        translationKey: 'nav.retargeting',
      },
      {
        id: 'commerce',
        label: 'AI commerce',
        icon: CircleDollarSign,
        badge: 'New',
        translationKey: 'nav.commerce',
      },
      {
        id: 'integrations',
        label: 'Integrations & API',
        icon: Webhook,
        translationKey: 'nav.integrations',
      },
    ],
  },
  {
    label: 'Manage',
    translationKey: 'nav.group.manage',
    items: [
      {
        id: 'billing',
        label: 'Billing & credits',
        icon: CreditCard,
        translationKey: 'nav.billing',
      },
      {
        id: 'team',
        label: 'Team',
        icon: UsersRound,
        translationKey: 'nav.team',
      },
      {
        id: 'org_structure',
        label: 'Org & routing',
        icon: Building2,
        translationKey: 'nav.org_structure',
      },
      {
        id: 'agent_desk',
        label: 'Agent desk',
        icon: Headphones,
        translationKey: 'nav.agent_desk',
      },
      {
        id: 'dialer',
        label: 'Dialer',
        icon: PhoneOutgoing,
        translationKey: 'nav.dialer',
      },
      {
        id: 'diagnostics',
        label: 'Device & diagnostics',
        icon: Activity,
        translationKey: 'nav.diagnostics',
      },
      {
        id: 'wallboard',
        label: 'Supervisor wallboard',
        icon: Gauge,
        translationKey: 'nav.wallboard',
      },
      {
        id: 'approvals',
        label: 'Approvals & handoff',
        icon: ShieldAlert,
        translationKey: 'nav.approvals',
      },
      {
        id: 'tickets',
        label: 'Support tickets',
        icon: LifeBuoy,
        translationKey: 'nav.tickets',
      },
      {
        id: 'settings',
        label: 'Settings',
        icon: Settings2,
        translationKey: 'nav.settings',
      },
    ],
  },
];

const navPermissions: Record<string, string> = {
  crm: 'crm.manage',
  agents: 'agents.manage',
  voice_profiles: 'agents.manage',
  graph_agents: 'agents.manage',
  workflows: 'agents.manage',
  knowledge: 'agents.manage',
  campaigns: 'campaigns.manage',
  numbers: 'telephony.manage',
  sip_trunks: 'telephony.manage',
  live_monitor: 'calls.monitor',
  growth: 'analytics.view',
  analytics: 'analytics.view',
  quality: 'analytics.view',
  reports: 'analytics.view',
  lead_capture: 'integrations.manage',
  retargeting: 'campaigns.manage',
  commerce: 'billing.manage',
  integrations: 'integrations.manage',
  billing: 'billing.manage',
  team: 'team.manage',
  org_structure: 'workspace.manage',
  agent_desk: 'calls.monitor',
  dialer: 'calls.monitor',
  diagnostics: 'calls.monitor',
  wallboard: 'calls.monitor',
  approvals: 'support.manage',
  tickets: 'support.manage',
  settings: 'workspace.manage',
};

const emptyData: CustomerData = {
  overview: {},
  crm: { pipeline: [], activities: [], timeline: {}, savedViews: [] },
  numbers: { numbers: [] },
  integrations: { integrations: [] },
  apiKeys: { apiKeys: [] },
  webhooks: { webhooks: [] },
  billing: { plans: [], creditPackages: [], invoices: [], ledger: [] },
  agents: { agents: [], testSessions: [] },
  commerce: {
    paymentLinks: [],
    messages: [],
    scheduledActions: [],
    connections: [],
  },
  operations: {
    campaigns: [],
    sipTrunks: [],
    knowledgeBases: [],
    workflows: [],
    graphAgents: [],
    calls: [],
    qualityReviews: [],
    alertRules: [],
    incidents: [],
    reports: [],
  },
  tickets: { tickets: [], messages: [] },
  team: { members: [], invitations: [] },
  leadForms: { forms: [] },
  retargeting: { audiences: [] },
};

export function CustomerPortal({ session }: { session: CustomerSession }) {
  const [active, setActive] = useState('overview');
  const [data, setData] = useState<CustomerData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mfaRequired, setMfaRequired] = useState('');
  const visibleGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => {
            const permission = navPermissions[item.id];
            return !permission || session.permissions.includes(permission);
          }),
        }))
        .filter((group) => group.items.length > 0),
    [session.permissions],
  );

  async function getJson<T>(url: string) {
    const response = await fetch(url, { cache: 'no-store' });
    if (response.status === 401 || response.status === 403) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
      };
      // §14 restricts a privileged account that has no second factor. Bouncing
      // it to /login would loop for ever — the credentials are correct, so the
      // login succeeds and the next request is refused again. The person needs
      // the enrolment screen, not the sign-in screen.
      if (body.code === 'mfa_required') {
        setMfaRequired(body.error ?? '');
        throw new Error(body.error ?? 'Two-factor authentication is required.');
      }
      window.location.assign('/login');
      throw new Error('Session expired.');
    }
    const body = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(body.error ?? `Unable to load ${url}.`);
    return body as T;
  }

  async function load() {
    setError('');
    try {
      const [
        overview,
        crm,
        numbers,
        integrations,
        apiKeys,
        webhooks,
        billing,
        agents,
        commerce,
        operations,
        tickets,
        compliance,
        team,
        leadForms,
        retargeting,
      ] = await Promise.all([
        getJson<OverviewData>('/api/app/overview'),
        getJson<CustomerData['crm']>('/api/app/crm'),
        getJson<CustomerNumbersData>('/api/app/numbers'),
        getJson<IntegrationsData>('/api/app/integrations'),
        getJson<ApiKeysData>('/api/app/api-keys'),
        getJson<WebhooksData>('/api/app/webhooks'),
        getJson<BillingData>('/api/app/billing'),
        getJson<AgentsData>('/api/app/agents'),
        getJson<CommerceData>('/api/app/commerce'),
        getJson<OperationsData>('/api/app/operations'),
        getJson<TicketsData>('/api/app/tickets'),
        getJson<NonNullable<OperationsData['compliance']>>(
          '/api/app/compliance',
        ),
        getJson<TeamData>('/api/app/team'),
        getJson<LeadFormsData>('/api/app/lead-forms'),
        getJson<RetargetingData>('/api/app/retargeting'),
      ]);
      setData({
        overview,
        crm,
        numbers,
        integrations,
        apiKeys,
        webhooks,
        billing,
        agents,
        commerce,
        operations: { ...operations, compliance },
        tickets,
        team,
        leadForms,
        retargeting,
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to load workspace.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function moveLead(lead: CrmLead, stage: string) {
    const response = await fetch('/api/app/crm', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        leadId: lead.id,
        stage,
        estimatedValue: lead.estimated_value,
        owner: lead.owner,
        nextAction:
          stage === 'won'
            ? 'Send confirmation and start onboarding'
            : lead.next_action,
      }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok)
      throw new Error(payload.error || 'Unable to move opportunity.');
    setData((current) => ({
      ...current,
      crm: {
        ...current.crm,
        pipeline: current.crm.pipeline.map((item) =>
          item.id === lead.id ? { ...item, stage } : item,
        ),
      },
    }));
  }

  const credits = Number(
    data.overview.stats?.credits ?? data.billing.wallet?.balance ?? 0,
  );
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
            workspace opens.
          </p>
        </section>
        {/* The security panel is rendered here rather than linked to. It is a
            section of the portal, not a page, and the portal cannot load —
            every one of its requests is refused. `/api/auth/security` is on
            §14's allow-list precisely so this still works. */}
        <div className="w-full max-w-2xl">
          <CustomerSecurity />
        </div>
      </div>
    );

  return (
    <NotificationCenter section={active}>
      <CreditWatch credits={credits} />
      <PortalShell
        mode="customer"
        active={active}
        groups={visibleGroups}
        onNavigate={setActive}
        name={session.name}
        email={`${session.email} · ${session.workspaceRole.replaceAll('_', ' ')}`}
        workspace={session.organizationName}
        credits={credits}
      >
        <div className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
          {loading ? (
            <Loading />
          ) : error ? (
            <ErrorState error={error} retry={load} />
          ) : null}
          {!loading && !error && active === 'overview' ? (
            <CustomerOverview data={data.overview} onNavigate={setActive} />
          ) : null}
          {!loading && !error && active === 'crm' ? (
            <CustomerCrm
              leads={data.crm.pipeline}
              activities={data.crm.activities}
              timeline={data.crm.timeline}
              savedViews={data.crm.savedViews}
              onMove={moveLead}
              onChanged={load}
              onStartFollowUp={() => setActive('campaigns')}
            />
          ) : null}
          {!loading && !error && active === 'growth' ? (
            <CustomerGrowth />
          ) : null}
          {!loading && !error && active === 'workflows' ? (
            <CustomerWorkflowBuilder />
          ) : null}
          {!loading && !error && active === 'agents' ? (
            <CustomerAgentStudio
              data={data.agents}
              businessName={session.organizationName}
              onChanged={load}
            />
          ) : null}
          {!loading &&
          !error &&
          [
            'campaigns',
            'sip_trunks',
            'knowledge',
            'graph_agents',
            'call_history',
            'live_monitor',
            'analytics',
            'quality',
            'alerts',
            'reports',
          ].includes(active) ? (
            <CustomerOperations
              module={active as OperationsModule}
              data={data.operations}
              onChanged={load}
            />
          ) : null}
          {!loading && !error && active === 'voice_profiles' ? (
            <CustomerVoiceProfiles />
          ) : null}
          {!loading && !error && active === 'numbers' ? (
            <CustomerNumbers
              data={data.numbers}
              onChanged={load}
              onNavigate={setActive}
            />
          ) : null}
          {!loading && !error && active === 'lead_capture' ? (
            <CustomerLeadCapture
              data={data.leadForms}
              sources={data.overview.sources ?? []}
              onChanged={load}
              onNavigate={setActive}
            />
          ) : null}
          {!loading && !error && active === 'retargeting' ? (
            <Retargeting data={data.retargeting} onChanged={load} />
          ) : null}
          {!loading && !error && active === 'commerce' ? (
            <CustomerCommerce data={data.commerce} onChanged={load} />
          ) : null}
          {!loading && !error && active === 'integrations' ? (
            <CustomerIntegrations
              apiKeys={data.apiKeys}
              webhooks={data.webhooks}
              onChanged={load}
            />
          ) : null}
          {!loading && !error && active === 'billing' ? (
            <CustomerBilling data={data.billing} onChanged={load} />
          ) : null}
          {!loading && !error && active === 'team' ? (
            <CustomerTeam data={data.team} onChanged={load} />
          ) : null}
          {!loading && !error && active === 'org_structure' ? (
            <CustomerOrgStructure />
          ) : null}
          {!loading && !error && active === 'dialer' ? (
            <CustomerDialer />
          ) : null}
          {!loading && !error && active === 'diagnostics' ? (
            <CustomerDiagnostics />
          ) : null}
          {!loading && !error && active === 'agent_desk' ? (
            <CustomerAgentDesk view="desk" />
          ) : null}
          {!loading && !error && active === 'wallboard' ? (
            <CustomerAgentDesk view="wallboard" />
          ) : null}
          {!loading && !error && active === 'approvals' ? (
            <CustomerApprovals />
          ) : null}
          {!loading && !error && active === 'tickets' ? (
            <CustomerTickets data={data.tickets} onChanged={load} />
          ) : null}
          {!loading && !error && active === 'settings' ? (
            <CustomerOperations
              module="settings"
              data={data.operations}
              onChanged={load}
            />
          ) : null}
        </div>
      </PortalShell>
    </NotificationCenter>
  );
}

function CustomerOverview({
  data,
  onNavigate,
}: {
  data: OverviewData;
  onNavigate: (id: string) => void;
}) {
  const stats = data.stats ?? {};
  const leads = data.recentLeads ?? [];
  return (
    <div className="space-y-6">
      <Header
        eyebrow="Revenue command center"
        title="Good evening, your AI team is working"
        description="Leads, conversations, appointments and revenue actions—measured from tenant-owned records."
        action={
          <Button
            onClick={() => onNavigate('campaigns')}
            className="portal-primary"
          >
            <PhoneCall /> Launch campaign
          </Button>
        }
      />
      <section className="portal-panel overflow-hidden p-0">
        <div className="grid xl:grid-cols-[1.2fr_0.8fr]">
          <div className="relative overflow-hidden border-b border-hairline p-6 sm:p-7 xl:border-b-0 xl:border-r">
            <div
              aria-hidden="true"
              className="absolute -right-16 -top-20 size-64 rounded-full bg-indigo-400/12 blur-3xl"
            />
            <div className="relative flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-success-text">
                  <span className="size-1.5 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,.8)]" />{' '}
                  Revenue pipeline live
                </div>
                <p className="mt-5 text-[10px] uppercase tracking-[0.14em] text-ink-muted">
                  Open pipeline value
                </p>
                <p className="mt-2 text-4xl font-semibold tracking-[-0.04em] text-ink sm:text-5xl">
                  {money(stats.pipelineValue)}
                </p>
                <p className="mt-3 text-xs text-ink-muted">
                  {num(stats.opportunities)} active opportunities ·{' '}
                  {num(stats.qualified)} high-intent leads
                </p>
              </div>
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl border border-indigo-200/15 bg-indigo-300/10 shadow-[0_18px_50px_-24px_rgba(129,140,248,.9)]">
                <Target className="size-5 text-[#bdc7ff]" />
              </span>
            </div>
            <div className="relative mt-7 flex flex-wrap gap-2">
              <Button
                onClick={() => onNavigate('crm')}
                size="sm"
                className="portal-primary"
              >
                Open CRM <ArrowUpRight />
              </Button>
              <Button
                onClick={() => onNavigate('lead_capture')}
                size="sm"
                variant="outline"
                className="border-hairline bg-surface-muted"
              >
                Capture leads
              </Button>
              <Button
                onClick={() => onNavigate('live_monitor')}
                size="sm"
                variant="outline"
                className="border-hairline bg-surface-muted"
              >
                Live monitor
              </Button>
            </div>
          </div>
          <div className="p-6 sm:p-7">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">System readiness</p>
                <p className="mt-1 text-[10px] text-ink-muted">
                  Private provider adapters
                </p>
              </div>
              <Zap className="size-4 text-primary" />
            </div>
            <div className="mt-5 space-y-3">
              {(data.providerReadiness ?? []).slice(0, 5).map((provider) => (
                <div
                  key={provider.adapter}
                  className="flex items-center gap-3 rounded-xl border border-hairline bg-surface-muted px-3 py-2.5"
                >
                  <span
                    className={`size-1.5 rounded-full ${provider.configured ? 'bg-emerald-300' : 'bg-primary'}`}
                  />
                  <span className="min-w-0 flex-1 truncate text-[10px] text-ink-body">
                    {provider.publicName}
                  </span>
                  <span
                    className={`text-[8px] uppercase tracking-wider ${provider.configured ? 'text-success-text' : 'text-warning-text'}`}
                  >
                    {provider.configured ? 'connected' : 'sandbox'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Credits available"
          value={num(stats.credits)}
          note="Wallet balance"
          icon={CircleDollarSign}
          tone="indigo"
          progress={72}
        />
        <Metric
          label="Captured leads"
          value={num(stats.leads)}
          note={`${num(stats.qualified)} high intent`}
          icon={ContactRound}
          tone="cyan"
          progress={Math.min(
            100,
            Number(stats.leads || 0)
              ? (Number(stats.qualified || 0) / Number(stats.leads || 1)) * 100
              : 0,
          )}
        />
        <Metric
          label="Call jobs"
          value={num(stats.calls)}
          note={`${num(stats.queuedCalls)} queued`}
          icon={PhoneCall}
          tone="violet"
          progress={Math.min(100, Number(stats.calls || 0) * 12)}
        />
        <Metric
          label="AI lead score"
          value={`${num(stats.averageScore)}/100`}
          note="Average buyer intent"
          icon={BrainCircuit}
          tone="emerald"
          progress={Number(stats.averageScore || 0)}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Panel>
          <PanelTitle
            title="Lead-to-revenue velocity"
            note="14 days · leads, calls and conversions"
          />
          <ActivityAreaChart data={data.activitySeries ?? []} />
        </Panel>
        <Panel>
          <PanelTitle
            title="Outcome intelligence"
            note="Every recorded conversation outcome"
          />
          <DistributionChart data={data.outcomeBreakdown ?? []} />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <Panel className="overflow-hidden">
          <PanelTitle
            title="Priority leads"
            note="AI-scored across ads, forms and CRM"
          />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-xs">
              <thead className="border-y border-hairline text-[9px] uppercase tracking-wider text-ink-muted">
                <tr>
                  {['Lead', 'Source', 'Score', 'Intent', 'Value', 'Stage'].map(
                    (h) => (
                      <th key={h} className="px-3 py-3 font-medium">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/7">
                {leads.map((lead) => (
                  <tr key={lead.id}>
                    <td className="px-3 py-4">
                      <p className="font-medium">{lead.name}</p>
                      <p className="mt-1 font-mono text-[9px] text-ink-muted">
                        {lead.phone}
                      </p>
                    </td>
                    <td className="px-3 py-4 text-ink-muted">
                      {lead.source_name}
                    </td>
                    <td className="px-3 py-4">
                      <span className="rounded-lg border border-hairline bg-surface-strong px-2 py-1 font-mono text-ink">
                        {lead.score}
                      </span>
                    </td>
                    <td className="px-3 py-4 text-ink-muted">
                      {String(lead.intent).replaceAll('_', ' ')}
                    </td>
                    <td className="px-3 py-4 text-ink-body">
                      {money(lead.estimated_value)}
                    </td>
                    <td className="px-3 py-4">
                      <Status value={lead.stage || lead.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel>
          <PanelTitle
            title="Connected lead sources"
            note="Capture readiness by channel"
          />
          <div className="mt-4 space-y-4">
            {(data.sources ?? []).map((source) => (
              <div key={source.type} className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-xl bg-surface-strong">
                  {source.type === 'meta_ads' ? (
                    <Megaphone className="size-4 text-blue-300" />
                  ) : source.type === 'google_ads' ? (
                    <BarChart3 className="size-4 text-warning-text" />
                  ) : source.type === 'website_form' ? (
                    <Globe2 className="size-4 text-cyan-700" />
                  ) : (
                    <Database className="size-4 text-violet-700" />
                  )}
                </span>
                <div className="flex-1">
                  <p className="text-xs font-medium">{source.name}</p>
                  <p className="mt-1 text-[9px] text-ink-muted">
                    {source.status.replaceAll('_', ' ')}
                  </p>
                </div>
                <Status value={source.status} />
              </div>
            ))}
          </div>
          <Button
            onClick={() => onNavigate('lead_capture')}
            variant="outline"
            className="mt-5 w-full border-hairline bg-transparent"
          >
            Manage lead capture
          </Button>
        </Panel>
      </div>
    </div>
  );
}

function Retargeting({
  data,
  onChanged,
}: {
  data: RetargetingData;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('Hot leads · no booking');
  const [destination, setDestination] = useState('meta_ads');
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  async function post(body: Record<string, unknown>, key: string) {
    setLoading(key);
    setError('');
    try {
      const response = await fetch('/api/app/retargeting', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(payload.error || 'Audience action failed.');
      setOpen(false);
      await onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Audience action failed.',
      );
    } finally {
      setLoading('');
    }
  }
  const audiences = data.audiences ?? [];
  return (
    <div className="space-y-6">
      <Header
        eyebrow="Revenue recovery"
        title="Consent-aware retargeting audiences"
        description="Call outcomes continuously refresh Meta and Google audience segments without revealing conversation transcripts."
        action={
          <Button onClick={() => setOpen(true)} className="portal-primary">
            <Repeat2 /> Build audience
          </Button>
        }
      />
      {error ? (
        <p className="rounded-xl border border-red-400/15 bg-red-400/5 p-3 text-xs text-danger-text">
          {error}
        </p>
      ) : null}
      {open ? (
        <Panel>
          <div className="grid gap-3 sm:grid-cols-[1fr_220px_auto]">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Audience name"
              className="h-10 border-hairline bg-surface-muted"
            />
            <select
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              className="h-10 rounded-lg border border-hairline bg-surface px-3 text-xs"
            >
              <option value="meta_ads">Meta Ads</option>
              <option value="google_ads">Google Ads</option>
            </select>
            <Button
              onClick={() =>
                void post(
                  {
                    action: 'create',
                    name,
                    destination,
                    rules: { scoreMin: 75, excludeBooked: true },
                  },
                  'create',
                )
              }
              disabled={Boolean(loading)}
              className="portal-primary"
            >
              {loading === 'create' ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Target />
              )}
              Create
            </Button>
          </div>
        </Panel>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        {audiences.map((audience) => (
          <Panel key={audience.id}>
            <div className="flex items-center justify-between">
              <Target className="size-4 text-primary" />
              <Status value={audience.status} />
            </div>
            <h2 className="mt-5 text-sm font-semibold">{audience.name}</h2>
            <p className="mt-2 min-h-10 text-xs leading-5 text-ink-muted">
              Hashed identifiers only; revoked consent and booked outcomes are
              suppressed before sync.
            </p>
            <div className="mt-5 flex items-end justify-between border-t border-hairline pt-4">
              <div>
                <p className="text-xl font-semibold">
                  {num(audience.eligible_count)}
                </p>
                <p className="text-[9px] text-ink-muted">eligible contacts</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void post(
                    { action: 'sync', audienceId: audience.id },
                    audience.id,
                  )
                }
                disabled={Boolean(loading) || audience.status === 'syncing'}
                className="border-hairline bg-transparent"
              >
                <RefreshCcw
                  className={loading === audience.id ? 'animate-spin' : ''}
                />
                {audience.status === 'syncing' ? 'Syncing' : 'Sync'}
              </Button>
            </div>
          </Panel>
        ))}
        {!audiences.length ? (
          <Panel>
            <p className="text-sm font-medium">No audiences yet</p>
            <p className="mt-2 text-xs text-ink-muted">
              Build the first consent-aware Meta or Google audience.
            </p>
          </Panel>
        ) : null}
      </div>
      <Panel>
        <PanelTitle
          title="Always-on audience loop"
          note="Outcome → eligibility → sync → suppression"
        />
        <div className="mt-5 flex flex-col items-stretch gap-2 md:flex-row md:items-center">
          {[
            'Call outcome',
            'Consent check',
            'Segment rule',
            'Hashed audience sync',
            'CRM suppression',
          ].map((item, index) => (
            <div key={item} className="contents">
              <div className="flex-1 rounded-xl border border-hairline bg-surface-muted p-4 text-center text-xs">
                {item}
              </div>
              {index < 4 ? (
                <span className="text-center text-ink-muted">→</span>
              ) : null}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function Header({
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
function Metric({
  label,
  value,
  note,
  icon: Icon,
  tone = 'indigo',
  progress = 0,
}: {
  label: string;
  value: string;
  note: string;
  icon: typeof Gauge;
  tone?: 'indigo' | 'cyan' | 'violet' | 'emerald';
  progress?: number;
}) {
  const tones = {
    indigo:
      'from-indigo-300 to-blue-300 text-indigo-700 bg-indigo-300/8 border-indigo-200/12',
    cyan: 'from-cyan-300 to-sky-300 text-cyan-700 bg-cyan-300/8 border-cyan-200/12',
    violet:
      'from-violet-300 to-fuchsia-300 text-violet-700 bg-violet-300/8 border-violet-200/12',
    emerald:
      'from-emerald-300 to-teal-300 text-success-text bg-emerald-300/8 border-emerald-200/12',
  }[tone];
  return (
    <div className="portal-stat group overflow-hidden p-4">
      <div className="flex items-center justify-between">
        <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-ink-muted">
          {label}
        </p>
        <span
          className={`grid size-9 place-items-center rounded-xl border ${tones}`}
        >
          <Icon className="size-[17px]" />
        </span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-2xl font-semibold tracking-tight text-ink">
            {value}
          </p>
          <p className="mt-1 text-[9px] text-ink-muted">{note}</p>
        </div>
        <ArrowUpRight className="mb-1 size-3.5 text-ink-muted" />
      </div>
      <div className="mt-4 h-1 overflow-hidden rounded-full bg-surface-strong">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${tones.split(' ').slice(0, 2).join(' ')}`}
          style={{ width: `${Math.max(4, Math.min(100, progress))}%` }}
        />
      </div>
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
function PanelTitle({ title, note }: { title: string; note: string }) {
  return (
    <div>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-[10px] text-ink-muted">{note}</p>
    </div>
  );
}
function Status({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const positive = [
    'active',
    'approved',
    'connected',
    'paid',
    'verified',
    'live',
  ].some((item) => normalized.includes(item));
  const warning = ['pending', 'ready', 'sync', 'scheduled', 'required'].some(
    (item) => normalized.includes(item),
  );
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-1 text-[9px] capitalize ${positive ? 'border-emerald-400/15 bg-emerald-400/7 text-success-text' : warning ? 'border-amber-300/15 bg-amber-300/7 text-warning-text' : 'border-hairline bg-surface-strong text-ink-muted'}`}
    >
      {value.replaceAll('_', ' ')}
    </span>
  );
}
function Loading() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="text-center">
        <Loader2 className="mx-auto size-6 animate-spin text-warning-text" />
        <p className="mt-3 text-xs text-ink-muted">
          Loading your revenue workspace…
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
function num(value: unknown) {
  return Number(value ?? 0).toLocaleString('en-IN');
}
function money(value: unknown) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}
