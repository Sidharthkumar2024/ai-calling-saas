'use client';

import {
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  Filter,
  Gauge,
  Layers3,
  LockKeyhole,
  Map,
  Rocket,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UsersRound,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type DeliveryStatus =
  | 'Backend ready'
  | 'Interactive demo'
  | 'To build'
  | 'Phase 2'
  | 'Later';

type RoadmapModule = {
  name: string;
  status: DeliveryStatus;
  available: string;
  next: string;
};

const statusTone: Record<DeliveryStatus, string> = {
  'Backend ready': 'border-emerald-400/20 bg-emerald-400/8 text-emerald-300',
  'Interactive demo': 'border-sky-400/20 bg-sky-400/8 text-sky-300',
  'To build': 'border-amber-400/20 bg-amber-400/8 text-amber-300',
  'Phase 2': 'border-violet-400/20 bg-violet-400/8 text-violet-300',
  Later: 'border-border bg-muted/45 text-muted-foreground',
};

const roadmapModules: RoadmapModule[] = [
  {
    name: 'Tenant, auth & roles',
    status: 'Backend ready',
    available: 'Tenant-aware workspace context and customer/admin role views.',
    next: 'Production auth, invitations, RBAC matrix, MFA and session controls.',
  },
  {
    name: 'Lead capture & attribution',
    status: 'Backend ready',
    available:
      'Meta, Google, website-form and manual lead ingestion with source data.',
    next: 'Signed provider webhooks, field mapping UI, dedupe and consent evidence.',
  },
  {
    name: 'AI lead intelligence & CRM',
    status: 'Backend ready',
    available:
      'Intent, score, summary, opportunity and pipeline value are persisted.',
    next: 'Configurable scoring, owner routing, tasks, stages and conversion feedback.',
  },
  {
    name: 'Agent Studio',
    status: 'Interactive demo',
    available: 'Agent list, personas, goals, language and guardrail surfaces.',
    next: 'Versioned agent config, simulation, evaluation gates and publish workflow.',
  },
  {
    name: 'Realtime voice & telephony',
    status: 'To build',
    available: 'Live-call operations UI and provider-health presentation.',
    next: 'Vaani Sara and Vaani Connect adapters, streaming orchestration, barge-in and transfers.',
  },
  {
    name: 'Campaigns & dialer',
    status: 'Interactive demo',
    available: 'Campaign KPIs, progress, outcomes and quick-create journey.',
    next: 'CSV audience import, schedules, retry rules, pacing and suppression engine.',
  },
  {
    name: 'Callbacks & durable workflows',
    status: 'Interactive demo',
    available: 'Callback queue and operations views.',
    next: 'Durable jobs, idempotency, retry/dead-letter queues and SLA escalation.',
  },
  {
    name: 'Contacts & sales workspace',
    status: 'Interactive demo',
    available: 'Contacts, CRM stages, appointments and lead-source views.',
    next: 'Timeline, notes, ownership, tasks, bulk actions and import/export.',
  },
  {
    name: 'Audience retargeting',
    status: 'Phase 2',
    available: 'Segment and closed-loop sync blueprint in this workspace.',
    next: 'Meta CAPI, Google Customer Match, consent filters and recurring refresh.',
  },
  {
    name: 'WhatsApp & shared inbox',
    status: 'Interactive demo',
    available: 'Conversation and follow-up surfaces.',
    next: 'WhatsApp BSP connection, templates, opt-in, routing and human takeover.',
  },
  {
    name: 'Appointments & receptionist',
    status: 'Interactive demo',
    available: 'Booking outcomes and appointment module.',
    next: 'Calendar availability, conflict handling, reminders and rescheduling.',
  },
  {
    name: 'Knowledge & RAG',
    status: 'Interactive demo',
    available: 'Website, PDF, FAQ and product source inventory.',
    next: 'Ingestion pipeline, chunk approval, citations, freshness and retrieval tests.',
  },
  {
    name: 'Flow builder & business tools',
    status: 'To build',
    available: 'Scripts, guardrails and webhook surfaces.',
    next: 'Visual nodes, forms, sheets, APIs, webhooks, test runs and execution logs.',
  },
  {
    name: 'Calls, recordings & QA',
    status: 'Interactive demo',
    available:
      'Call status, transcript, sentiment, recordings and live-monitor views.',
    next: 'Storage lifecycle, transcript search, scorecards, redaction and disputes.',
  },
  {
    name: 'Analytics & attribution',
    status: 'Interactive demo',
    available: 'Operational KPIs, charts and campaign outcomes.',
    next: 'Source-to-sale funnel, cohort reports, saved views and scheduled exports.',
  },
  {
    name: 'Wallet, billing & invoices',
    status: 'Interactive demo',
    available: 'Plan, usage and spend surfaces.',
    next: 'Wallet ledger, pricing rules, payment gateway, taxes, invoices and dunning.',
  },
  {
    name: 'Super Admin & support',
    status: 'Interactive demo',
    available:
      'Platform KPIs, tenant directory and provider-level operations UI.',
    next: 'Tenant actions, support impersonation controls, jobs and incident tooling.',
  },
  {
    name: 'API, integrations & webhooks',
    status: 'To build',
    available: 'Lead endpoints and webhook-oriented product surfaces.',
    next: 'API keys, scoped tokens, event catalog, delivery logs and CRM connectors.',
  },
  {
    name: 'Security, consent & audit',
    status: 'To build',
    available: 'Consent-first messaging in lead and campaign flows.',
    next: 'DND/suppression, audit log, encryption policy, retention and compliance export.',
  },
  {
    name: 'Android & iOS apps',
    status: 'Phase 2',
    available: 'Product scope and release plan defined.',
    next: 'React Native app, push alerts, handoff, inbox, offline queue and store release.',
  },
  {
    name: 'Reliability & observability',
    status: 'Later',
    available: 'Provider-health and capacity UI patterns.',
    next: 'SLOs, tracing, cost telemetry, disaster recovery and multi-region capacity.',
  },
];

const phases = [
  {
    phase: 'Phase 1 · Commercial web core',
    timing: 'Now → launch',
    progress: 38,
    tone: 'text-emerald-300',
    items: [
      'Production tenant auth, RBAC and onboarding',
      'Agent Studio + real telephony + durable callbacks',
      'Lead-to-CRM-to-call-to-sale closed loop',
      'Billing, consent, audit and Super Admin controls',
    ],
  },
  {
    phase: 'Phase 2 · Growth + mobile',
    timing: 'After web launch',
    progress: 8,
    tone: 'text-violet-300',
    items: [
      'Always-on Meta and Google audience retargeting',
      'Android and iOS sales companion',
      'Shared inbox, push handoff and offline lead queue',
      'Advanced attribution and workflow automation',
    ],
  },
  {
    phase: 'Phase 3 · Enterprise scale',
    timing: 'After product-market fit',
    progress: 0,
    tone: 'text-sky-300',
    items: [
      'SSO, advanced approvals and compliance exports',
      'Multi-region voice capacity and disaster recovery',
      'Enterprise data controls and custom SLAs',
      'Marketplace-grade integration ecosystem',
    ],
  },
];

const mobileFeatures = [
  [
    'Today dashboard',
    'Calls, leads, bookings, SLA alerts and spend at a glance.',
  ],
  [
    'Priority lead queue',
    'Hot leads, follow-up reason, source and next-best action.',
  ],
  [
    'AI-to-human handoff',
    'Push alert with transcript summary and one-tap takeover.',
  ],
  ['Call detail', 'Recording, transcript, disposition, QA and CRM timeline.'],
  [
    'Shared inbox',
    'WhatsApp/customer messages with assignment and quick replies.',
  ],
  [
    'Campaign controls',
    'Pause/resume, health alerts and limited launch controls.',
  ],
  [
    'Secure access',
    'Biometric unlock, MFA, role limits and remote session revoke.',
  ],
  [
    'Offline readiness',
    'Cached leads and queued notes that sync when back online.',
  ],
];

const auditPatterns = [
  { icon: Gauge, label: 'KPI-first modules', detail: 'Status before detail' },
  { icon: Filter, label: 'Search + filters', detail: 'Before dense tables' },
  { icon: Layers3, label: 'Module sub-tabs', detail: 'Keep context visible' },
  {
    icon: CircleDashed,
    label: 'Clear empty states',
    detail: 'Explain the next action',
  },
  {
    icon: ShieldCheck,
    label: 'Provider health',
    detail: 'Admin-only operations',
  },
];

export function ProductRoadmapPanel({
  onNotice,
}: {
  onNotice: (message: string) => void;
}) {
  return (
    <div className="space-y-5 xl:space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Map className="size-3.5 text-primary" /> Product planning
            <span className="text-border">/</span> Source-audited roadmap
          </div>
          <h2 className="text-2xl font-semibold tracking-[-0.025em] sm:text-[28px]">
            Product roadmap & feature inventory
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            One honest view of what works in the backend, what is an interactive
            product demo, and what must be built before customers can rely on
            it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="h-8 border-amber-400/20 bg-amber-400/8 px-3 text-amber-300"
          >
            White-label removed from scope
          </Badge>
          <Button
            onClick={() =>
              onNotice(
                'Next sprint focused: production auth, telephony adapter and durable callback pipeline.',
              )
            }
          >
            <Rocket /> Focus next sprint
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          [
            'Backend-ready modules',
            '3',
            'Persisted and tenant-aware',
            CheckCircle2,
          ],
          [
            'Interactive modules',
            '11',
            'UX is testable; engine pending',
            Sparkles,
          ],
          [
            'Core build gaps',
            '4',
            'Needed before production launch',
            ClipboardCheck,
          ],
          ['Phase 2 tracks', '2', 'Retargeting + Android/iOS', Smartphone],
        ].map(([label, value, note, Icon]) => (
          <Card key={label as string} size="sm" className="metric-card">
            <CardHeader>
              <CardDescription className="flex items-center gap-2 text-xs">
                <Icon className="size-3.5" /> {label as string}
              </CardDescription>
              <CardTitle className="pt-2 font-mono text-2xl font-semibold">
                {value as string}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-[11px] text-muted-foreground">
              {note as string}
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="overview" className="gap-5">
        <TabsList
          variant="line"
          className="max-w-full justify-start overflow-x-auto border-b border-border"
        >
          <TabsTrigger value="overview" className="px-3 py-2">
            Roadmap overview
          </TabsTrigger>
          <TabsTrigger value="inventory" className="px-3 py-2">
            Complete feature list
          </TabsTrigger>
          <TabsTrigger value="mobile" className="px-3 py-2">
            Android & iOS · Phase 2
          </TabsTrigger>
          <TabsTrigger value="audit" className="px-3 py-2">
            UI audit decisions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-3">
            {phases.map((item) => (
              <Card key={item.phase} className="h-full">
                <CardHeader>
                  <CardTitle>{item.phase}</CardTitle>
                  <CardDescription>{item.timing}</CardDescription>
                  <CardAction>
                    <span className={`font-mono text-xs ${item.tone}`}>
                      {item.progress}%
                    </span>
                  </CardAction>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Progress value={item.progress} />
                  <div className="space-y-2.5">
                    {item.items.map((feature) => (
                      <div
                        key={feature}
                        className="flex gap-2.5 text-xs leading-5"
                      >
                        <ArrowRight className="mt-1 size-3 shrink-0 text-primary" />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="border-amber-400/18 bg-[linear-gradient(105deg,color-mix(in_oklab,var(--color-amber-400)_5%,var(--card)),var(--card)_62%)]">
            <CardContent className="flex flex-col gap-4 py-0 sm:flex-row sm:items-center">
              <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-amber-400/10 text-amber-300">
                <LockKeyhole className="size-5" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">Current scope boundary</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Partner portals, reseller controls and tenant branding are not
                  part of this roadmap. Reconsider them only after the core
                  commercial product has real usage, reliability and unit
                  economics.
                </p>
              </div>
              <Badge variant="outline" className="w-fit text-muted-foreground">
                0 partner features planned
              </Badge>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inventory" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">21 product modules</p>
              <p className="mt-1 text-xs text-muted-foreground">
                “Available” describes the current Vaani build; “Next gate” is
                the work required for a dependable production product.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(statusTone) as DeliveryStatus[]).map((status) => (
                <Badge
                  key={status}
                  variant="outline"
                  className={statusTone[status]}
                >
                  {status}
                </Badge>
              ))}
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            {roadmapModules.map((module) => (
              <Card key={module.name} size="sm">
                <CardHeader>
                  <CardTitle>{module.name}</CardTitle>
                  <CardAction>
                    <Badge
                      variant="outline"
                      className={statusTone[module.status]}
                    >
                      {module.status}
                    </Badge>
                  </CardAction>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-border/75 bg-muted/30 p-3">
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300">
                      Available now
                    </p>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {module.available}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/75 bg-muted/30 p-3">
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-300">
                      Next production gate
                    </p>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {module.next}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="mobile" className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Smartphone className="size-4 text-primary" /> Mobile sales
                  companion
                </CardTitle>
                <CardDescription>
                  One React Native product for Android and iOS, scheduled only
                  after the Phase 1 web APIs and handoff model are stable.
                </CardDescription>
                <CardAction>
                  <Badge
                    variant="outline"
                    className="border-violet-400/20 bg-violet-400/8 text-violet-300"
                  >
                    Phase 2
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                {mobileFeatures.map(([title, detail]) => (
                  <div
                    key={title}
                    className="rounded-xl border border-border/75 bg-muted/30 p-3.5"
                  >
                    <p className="text-sm font-medium">{title}</p>
                    <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                      {detail}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <div className="space-y-5">
              {[
                {
                  title: 'Android release gate',
                  badge: 'Play Store',
                  items: [
                    'FCM push and deep links',
                    'Background sync + battery testing',
                    'Device matrix and call handoff QA',
                    'Privacy disclosure and store review',
                  ],
                },
                {
                  title: 'iOS release gate',
                  badge: 'App Store',
                  items: [
                    'APNs push and universal links',
                    'Biometric and background-mode review',
                    'iPhone device + accessibility QA',
                    'Privacy manifest and store review',
                  ],
                },
              ].map((platform) => (
                <Card key={platform.title} size="sm">
                  <CardHeader>
                    <CardTitle>{platform.title}</CardTitle>
                    <CardAction>
                      <Badge variant="secondary">{platform.badge}</Badge>
                    </CardAction>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {platform.items.map((item) => (
                      <p
                        key={item}
                        className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"
                      >
                        <CheckCircle2 className="mt-1 size-3 shrink-0 text-primary" />
                        {item}
                      </p>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="audit" className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>AgentLabs reference audit → Vaani decisions</CardTitle>
              <CardDescription>
                Customer and admin panels were reviewed module by module in
                Safari. We kept the useful interaction patterns while protecting
                Vaani’s clearer operations hierarchy.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {auditPatterns.map((pattern) => (
                <div
                  key={pattern.label}
                  className="rounded-xl border border-border/75 bg-muted/30 p-3.5"
                >
                  <pattern.icon className="size-4 text-primary" />
                  <p className="mt-3 text-sm font-medium">{pattern.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {pattern.detail}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-300" /> Adopted
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs leading-5 text-muted-foreground">
                <p>
                  KPI-first module headers, visible create actions and useful
                  empty states.
                </p>
                <p>
                  Search/filter controls before lists, plus focused sub-tabs
                  inside modules.
                </p>
                <p>
                  Admin-only provider health, capacity and operational controls.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UsersRound className="size-4 text-amber-300" /> Deliberately
                  changed
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs leading-5 text-muted-foreground">
                <p>
                  Fewer top-level admin tabs; Vaani groups work by operator
                  intent.
                </p>
                <p>
                  No raw model keys, long prompts or provider configuration in
                  customer views.
                </p>
                <p>
                  No partner/branding portal until the core SaaS is commercially
                  proven.
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
