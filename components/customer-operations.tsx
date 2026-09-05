'use client';

/* oxlint-disable jsx-a11y/media-has-caption -- call transcripts and QA summaries are available beside authenticated recordings */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SUPPORTED_LANGUAGE_CODES, languagesForRegion } from '@/lib/languages';
import { SoundSettings } from '@/components/notification-center';
import {
  Activity,
  AlertTriangle,
  BookOpenText,
  Bot,
  Cable,
  CheckCircle2,
  FileAudio,
  FileBarChart2,
  GitBranch,
  Headphones,
  Loader2,
  Network,
  PhoneCall,
  Plus,
  Radio,
  RefreshCcw,
  ShieldCheck,
  UsersRound,
  Workflow,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  ActivityAreaChart,
  DistributionChart,
} from '@/components/analytics-charts';
import { CustomerSecurity } from '@/components/customer-security';
import { CustomerImport } from '@/components/customer-import';
import { SupervisorMonitor } from '@/components/supervisor-monitor';
import { useT } from '@/components/locale-provider';
import type { TranslationKey } from '@/lib/i18n';
import { RECORDING_PRESENT } from '@/lib/call-history';
import { parseOpening, previewOpening } from '@/lib/campaign-opening';
import {
  describeSchedule,
  isReportSchedule,
  MAX_RECIPIENTS,
  nextRunAt,
  REPORT_SCHEDULES,
} from '@/lib/report-schedules';

export type OperationsData = {
  campaigns: Record<string, unknown>[];
  sipTrunks: Record<string, unknown>[];
  knowledgeBases: Record<string, unknown>[];
  workflows: Record<string, unknown>[];
  graphAgents: Record<string, unknown>[];
  calls: Record<string, unknown>[];
  qualityReviews: Record<string, unknown>[];
  alertRules: Record<string, unknown>[];
  incidents: Record<string, unknown>[];
  reports: Record<string, unknown>[];
  options?: {
    agents: Record<string, unknown>[];
    phoneNumbers: Record<string, unknown>[];
    workflows: Record<string, unknown>[];
  };
  settings?: Record<string, unknown> | null;
  stats?: Record<string, unknown> | null;
  compliance?: {
    consents: Record<string, unknown>[];
    suppressions: Record<string, unknown>[];
    kycDocuments: Record<string, unknown>[];
  };
};

export type OperationsModule =
  | 'campaigns'
  | 'sip_trunks'
  | 'knowledge'
  | 'graph_agents'
  | 'call_history'
  | 'live_monitor'
  | 'analytics'
  | 'quality'
  | 'alerts'
  | 'reports'
  | 'settings';

export function CustomerOperations({
  module,
  data,
  onChanged,
}: {
  module: OperationsModule;
  data: OperationsData;
  onChanged: () => Promise<void> | void;
}) {
  if (module === 'call_history') return <CallHistory data={data} />;
  if (module === 'live_monitor') return <LiveMonitor data={data} />;
  if (module === 'analytics') return <Analytics />;
  if (module === 'quality') return <Quality data={data} />;
  if (module === 'settings')
    return <WorkspaceSettings data={data} onChanged={onChanged} />;
  return <ResourceModule module={module} data={data} onChanged={onChanged} />;
}

const resourceMap = {
  campaigns: {
    i18n: 'campaigns',
    key: 'campaigns',
    action: 'create_campaign',
    icon: Radio,
  },
  sip_trunks: {
    i18n: 'sip_trunks',
    key: 'sipTrunks',
    action: 'create_sip_trunk',
    icon: Cable,
  },
  knowledge: {
    i18n: 'knowledge',
    key: 'knowledgeBases',
    action: 'create_knowledge_base',
    icon: BookOpenText,
  },
  graph_agents: {
    i18n: 'graph_agents',
    key: 'graphAgents',
    action: 'create_graph_agent',
    icon: GitBranch,
  },
  alerts: {
    i18n: 'alerts',
    key: 'alertRules',
    action: 'create_alert',
    icon: AlertTriangle,
  },
  reports: {
    i18n: 'reports',
    key: 'reports',
    action: 'create_report',
    icon: FileBarChart2,
  },
} as const;

function ResourceModule({
  module,
  data,
  onChanged,
}: {
  module: Exclude<
    OperationsModule,
    'call_history' | 'live_monitor' | 'analytics' | 'quality' | 'settings'
  >;
  data: OperationsData;
  onChanged: () => Promise<void> | void;
}) {
  const t = useT();
  const config = resourceMap[module];
  const Icon = config.icon;
  const rows = data[config.key] as Record<string, unknown>[];
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [creatorOpen, setCreatorOpen] = useState(false);

  async function create(payloadOverride?: Record<string, unknown>) {
    setLoading('create');
    setError('');
    const timestamp = new Date().toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const payload: Record<string, unknown> = payloadOverride ?? {
      action: config.action,
      name: `${t(`screen.${config.i18n}.title` as TranslationKey).replace(/s$/, '')} ${timestamp}`,
    };
    if (!payloadOverride) {
      if (module === 'sip_trunks')
        Object.assign(payload, {
          gatewayUri: 'sip:gateway.example.com:5061',
          transport: 'tls',
          mediaEncryption: 'sdes',
        });
      if (module === 'campaigns')
        Object.assign(payload, { audienceSize: 250, concurrency: 5 });
      if (module === 'knowledge')
        Object.assign(payload, {
          description: 'Approved product and support content',
          language: 'Hindi + English + Haryanvi',
        });
      if (module === 'alerts')
        Object.assign(payload, { metric: 'call_failure_rate', threshold: 10 });
    }
    try {
      await mutate(payload);
      await onChanged();
      setCreatorOpen(false);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to create resource.',
      );
    } finally {
      setLoading('');
    }
  }

  async function generate(id: string) {
    setLoading(id);
    setError('');
    try {
      await mutate({ action: 'generate_report', reportId: id });
      await onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to generate report.',
      );
    } finally {
      setLoading('');
    }
  }

  async function validateTrunk(id: string) {
    setLoading(id);
    setError('');
    try {
      await mutate({ action: 'validate_sip_trunk', trunkId: id });
      await onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to validate SIP trunk.',
      );
    } finally {
      setLoading('');
    }
  }

  const hasStructuredCreator =
    module === 'campaigns' || module === 'sip_trunks' || module === 'reports';
  return (
    <div className="space-y-6">
      <Header
        eyebrow={t(`screen.${config.i18n}.eyebrow` as TranslationKey)}
        title={t(`screen.${config.i18n}.title` as TranslationKey)}
        description={t(`screen.${config.i18n}.description` as TranslationKey)}
        action={
          <Button
            onClick={() =>
              hasStructuredCreator ? setCreatorOpen(true) : void create()
            }
            disabled={Boolean(loading)}
            className="portal-primary"
          >
            {loading === 'create' ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Plus />
            )}
            {t(`screen.${config.i18n}.button` as TranslationKey)}
          </Button>
        }
      />
      {hasStructuredCreator ? (
        <OperationsCreator
          module={module}
          data={data}
          open={creatorOpen}
          setOpen={setCreatorOpen}
          loading={loading === 'create'}
          submit={create}
        />
      ) : null}
      {error ? (
        <p className="rounded-xl border border-red-400/15 bg-red-400/5 p-3 text-xs text-danger-text">
          {error}
        </p>
      ) : null}
      {module === 'campaigns' ? (
        <CustomerImport
          campaigns={rows.map((row) => ({
            id: str(row.id),
            name: str(row.name, 'Untitled campaign'),
          }))}
          onChanged={onChanged}
        />
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => (
          <section
            key={str(row.id)}
            className="rounded-2xl border border-hairline bg-surface p-5 shadow-[0_18px_50px_-38px_rgba(55,189,248,0.45)]"
          >
            <div className="flex items-start justify-between">
              <span className="grid size-10 place-items-center rounded-xl border border-cyan-300/10 bg-cyan-300/[0.055]">
                <Icon className="size-4 text-cyan-700" />
              </span>
              <Status value={str(row.status, 'ready')} />
            </div>
            <h2 className="mt-5 text-sm font-semibold">{str(row.name)}</h2>
            <p className="mt-2 min-h-10 text-[10px] leading-5 text-ink-muted">
              {resourceDescription(module, row)}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2 border-t border-hairline pt-4 text-[9px] text-ink-muted">
              {resourceFacts(module, row).map(([label, value]) => (
                <div key={label}>
                  <p>{label}</p>
                  <p className="mt-1 text-xs font-medium text-ink">{value}</p>
                </div>
              ))}
            </div>
            {module === 'reports' ? (
              <Button
                variant="outline"
                onClick={() => generate(str(row.id))}
                disabled={Boolean(loading)}
                className="mt-4 w-full border-hairline bg-transparent text-[10px]"
              >
                {loading === str(row.id) ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RefreshCcw />
                )}
                Generate now
              </Button>
            ) : null}
            {module === 'sip_trunks' ? (
              <Button
                variant="outline"
                onClick={() => validateTrunk(str(row.id))}
                disabled={
                  Boolean(loading) ||
                  str(row.status) === 'provider_test_pending'
                }
                className="mt-4 w-full border-hairline bg-transparent text-[10px]"
              >
                {loading === str(row.id) ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <ShieldCheck />
                )}
                Validate & queue provider test
              </Button>
            ) : null}
          </section>
        ))}
      </div>
      {!rows.length ? (
        <Empty
          icon={Icon}
          label={`${t('state.empty')} ${t(
            `screen.${config.i18n}.title` as TranslationKey,
          )}`}
        />
      ) : null}
      {module === 'alerts' && data.incidents.length ? (
        <section className="rounded-2xl border border-hairline bg-surface p-5">
          <h2 className="text-sm font-semibold">Recent incidents</h2>
          <div className="mt-4 divide-y divide-white/7">
            {data.incidents.map((item) => (
              <div
                key={str(item.id)}
                className="flex items-center gap-3 py-3 text-xs"
              >
                <AlertTriangle className="size-4 text-warning-text" />
                <span className="flex-1">
                  {str(item.rule_name)} · current {str(item.current_value)}
                </span>
                <Status value={str(item.status)} />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function OperationsCreator({
  module,
  data,
  open,
  setOpen,
  loading,
  submit,
}: {
  module: 'campaigns' | 'sip_trunks' | 'reports';
  data: OperationsData;
  open: boolean;
  setOpen: (open: boolean) => void;
  loading: boolean;
  submit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const t = useT();
  const agents = data.options?.agents ?? [];
  const numbers = data.options?.phoneNumbers ?? [];
  const workflows = data.options?.workflows ?? [];
  const [campaign, setCampaign] = useState({
    name: '',
    objective: 'lead_qualification',
    agentId: str(agents[0]?.id, ''),
    workflowId: str(workflows[0]?.id, ''),
    workflowVersion: '1',
    openingMode: 'agent_default',
    openingTeam: '',
    openingExecutive: '',
    openingReason: '',
    fromNumberId: str(numbers[0]?.id, ''),
    concurrency: '5',
    maxAttempts: '3',
    retryMinutes: '120, 1440',
    windowStart: '10:00',
    windowEnd: '19:00',
    timezone: 'Asia/Kolkata',
    contacts: '',
  });
  const [trunk, setTrunk] = useState({
    name: '',
    provider: 'custom',
    gatewayUri: '',
    authType: 'userpass',
    username: '',
    password: '',
    transport: 'tls',
    mediaEncryption: 'sdes',
    codecs: 'PCMU, PCMA',
  });
  const [report, setReport] = useState({
    name: '',
    reportType: 'call_performance',
    schedule: 'weekly',
    recipients: '',
  });

  async function create() {
    if (module === 'campaigns') {
      const contacts = campaign.contacts
        .split(/[\n,]+/)
        .map((item) => item.trim())
        .filter(Boolean);
      await submit({
        action: 'create_campaign',
        ...campaign,
        opening: {
          mode: campaign.openingMode,
          team: campaign.openingTeam,
          executive: campaign.openingExecutive,
          reason: campaign.openingReason,
        },
        contacts,
        concurrency: Number(campaign.concurrency),
        maxAttempts: Number(campaign.maxAttempts),
        retryMinutes: campaign.retryMinutes
          .split(',')
          .map((item) => Number(item.trim()))
          .filter(Number.isFinite),
      });
      return;
    }
    if (module === 'sip_trunks') {
      await submit({
        action: 'create_sip_trunk',
        ...trunk,
        codecs: trunk.codecs
          .split(',')
          .map((item) => item.trim().toUpperCase())
          .filter(Boolean),
      });
      return;
    }
    await submit({
      action: 'create_report',
      ...report,
      recipients: report.recipients
        .split(/[\n,;]/)
        .map((item) => item.trim())
        .filter(Boolean),
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border border-hairline bg-surface p-0 text-ink shadow-2xl sm:max-w-3xl">
        <DialogHeader className="border-b border-hairline px-6 py-5">
          <DialogTitle>
            {module === 'campaigns'
              ? 'Create outbound campaign'
              : module === 'sip_trunks'
                ? 'Register SIP trunk'
                : 'Create report'}
          </DialogTitle>
          <DialogDescription className="text-xs leading-5 text-ink-muted">
            {module === 'campaigns'
              ? 'Configure the agent, workflow version, consent-aware contacts, retry policy and legal calling window.'
              : module === 'sip_trunks'
                ? 'Credentials are encrypted before storage. Activation remains locked until the connectivity test passes.'
                : 'Choose what it measures, how often it runs, and who receives it.'}
          </DialogDescription>
        </DialogHeader>

        {module === 'campaigns' ? (
          <div className="grid gap-5 p-6 sm:grid-cols-2">
            <CreatorField label={t('field.campaignName')}>
              <Input
                value={campaign.name}
                onChange={(event) =>
                  setCampaign({ ...campaign, name: event.target.value })
                }
                placeholder="September COD confirmations"
              />
            </CreatorField>
            <CreatorField label={t('field.objective')}>
              <select
                value={campaign.objective}
                onChange={(event) =>
                  setCampaign({ ...campaign, objective: event.target.value })
                }
              >
                <option value="lead_qualification">Lead qualification</option>
                <option value="cod_confirmation">COD confirmation</option>
                <option value="appointment_booking">Appointment booking</option>
                <option value="payment_collection">Payment collection</option>
                <option value="customer_support">Customer support</option>
              </select>
            </CreatorField>
            <CreatorField label={t('field.aiAgent')}>
              <select
                value={campaign.agentId}
                onChange={(event) =>
                  setCampaign({ ...campaign, agentId: event.target.value })
                }
              >
                <option value="">Choose an agent</option>
                {agents.map((item) => (
                  <option key={str(item.id)} value={str(item.id)}>
                    {str(item.name)} · {str(item.status)}
                  </option>
                ))}
              </select>
            </CreatorField>
            {/* §19: a campaign may say who it is, rather than every campaign
                opening with the agent's single welcome message. */}
            <CreatorField label="How this campaign introduces itself">
              <select
                value={campaign.openingMode}
                onChange={(event) =>
                  setCampaign({ ...campaign, openingMode: event.target.value })
                }
              >
                <option value="agent_default">The agent’s own welcome</option>
                <option value="company">From the company</option>
                <option value="team">From a team inside it</option>
                <option value="executive">On behalf of a person</option>
                <option value="customer">Greet the customer by name</option>
              </select>
              {campaign.openingMode === 'team' ? (
                <Input
                  value={campaign.openingTeam}
                  onChange={(event) =>
                    setCampaign({
                      ...campaign,
                      openingTeam: event.target.value,
                    })
                  }
                  placeholder="admissions"
                  className="mt-2"
                />
              ) : null}
              {campaign.openingMode === 'executive' ? (
                <Input
                  value={campaign.openingExecutive}
                  onChange={(event) =>
                    setCampaign({
                      ...campaign,
                      openingExecutive: event.target.value,
                    })
                  }
                  placeholder="Mr Rana"
                  className="mt-2"
                />
              ) : null}
              {campaign.openingMode !== 'agent_default' ? (
                <>
                  <Input
                    value={campaign.openingReason}
                    onChange={(event) =>
                      setCampaign({
                        ...campaign,
                        openingReason: event.target.value,
                      })
                    }
                    placeholder="about your recent enquiry (optional)"
                    className="mt-2"
                  />
                  {/* Shown, not described. The one that matters is `customer`:
                      a contact with no name gets the company line instead of
                      "Hello , this is" — the failure any template system
                      produces by default. */}
                  <p className="mt-2 text-[9px] text-ink-muted">
                    A contact will hear:{' '}
                    <span className="text-ink">
                      {previewOpening({
                        config: parseOpening({
                          mode: campaign.openingMode,
                          team: campaign.openingTeam,
                          executive: campaign.openingExecutive,
                          reason: campaign.openingReason,
                        }),
                        businessName: 'your company',
                        agentName: 'your agent',
                      }).text ?? ''}
                    </span>
                  </p>
                </>
              ) : null}
            </CreatorField>
            <CreatorField label={t('field.workflowPublished')}>
              <div className="grid grid-cols-[1fr_88px] gap-2">
                <select
                  value={campaign.workflowId}
                  onChange={(event) =>
                    setCampaign({ ...campaign, workflowId: event.target.value })
                  }
                >
                  <option value="">No post-call workflow</option>
                  {workflows.map((item) => (
                    <option key={str(item.id)} value={str(item.id)}>
                      {str(item.name)}
                    </option>
                  ))}
                </select>
                <Input
                  type="number"
                  min="1"
                  value={campaign.workflowVersion}
                  onChange={(event) =>
                    setCampaign({
                      ...campaign,
                      workflowVersion: event.target.value,
                    })
                  }
                  aria-label={t('field.workflowVersion')}
                />
              </div>
            </CreatorField>
            <CreatorField label={t('field.callingNumber')}>
              <select
                value={campaign.fromNumberId}
                onChange={(event) =>
                  setCampaign({ ...campaign, fromNumberId: event.target.value })
                }
              >
                <option value="">Auto-select an approved number</option>
                {numbers.map((item) => (
                  <option key={str(item.id)} value={str(item.id)}>
                    {str(item.phone_number)} · {str(item.status)}
                  </option>
                ))}
              </select>
            </CreatorField>
            <CreatorField label={t('field.concurrency')}>
              <Input
                type="number"
                min="1"
                max="50"
                value={campaign.concurrency}
                onChange={(event) =>
                  setCampaign({ ...campaign, concurrency: event.target.value })
                }
              />
            </CreatorField>
            <CreatorField label={t('field.maxAttempts')}>
              <Input
                type="number"
                min="1"
                max="8"
                value={campaign.maxAttempts}
                onChange={(event) =>
                  setCampaign({ ...campaign, maxAttempts: event.target.value })
                }
              />
            </CreatorField>
            <CreatorField label={t('field.retryAfter')}>
              <Input
                value={campaign.retryMinutes}
                onChange={(event) =>
                  setCampaign({ ...campaign, retryMinutes: event.target.value })
                }
                placeholder="120, 1440"
              />
            </CreatorField>
            <CreatorField label={t('field.callingWindow')}>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="time"
                  value={campaign.windowStart}
                  onChange={(event) =>
                    setCampaign({
                      ...campaign,
                      windowStart: event.target.value,
                    })
                  }
                />
                <Input
                  type="time"
                  value={campaign.windowEnd}
                  onChange={(event) =>
                    setCampaign({ ...campaign, windowEnd: event.target.value })
                  }
                />
              </div>
            </CreatorField>
            <CreatorField label={t('field.timezone')}>
              <Input
                value={campaign.timezone}
                onChange={(event) =>
                  setCampaign({ ...campaign, timezone: event.target.value })
                }
              />
            </CreatorField>
            <div className="sm:col-span-2">
              <CreatorField label={t('field.contacts')}>
                <Textarea
                  value={campaign.contacts}
                  onChange={(event) =>
                    setCampaign({ ...campaign, contacts: event.target.value })
                  }
                  placeholder={'+919876543210\n+919811122233'}
                  className="min-h-28"
                />
              </CreatorField>
              <p className="mt-2 flex items-center gap-2 text-[9px] text-ink-muted">
                <ShieldCheck className="size-3 text-success-text" /> Duplicates
                are removed; consent and suppression are checked again before
                any call is queued.
              </p>
            </div>
          </div>
        ) : null}

        {module === 'sip_trunks' ? (
          <div className="grid gap-5 p-6 sm:grid-cols-2">
            <CreatorField label={t('field.trunkName')}>
              <Input
                value={trunk.name}
                onChange={(event) =>
                  setTrunk({ ...trunk, name: event.target.value })
                }
                placeholder="Mumbai primary trunk"
              />
            </CreatorField>
            <CreatorField label={t('field.provider')}>
              <Input
                value={trunk.provider}
                onChange={(event) =>
                  setTrunk({ ...trunk, provider: event.target.value })
                }
                placeholder="Exotel / Airtel / custom"
              />
            </CreatorField>
            <div className="sm:col-span-2">
              <CreatorField label={t('field.gatewayUri')}>
                <Input
                  value={trunk.gatewayUri}
                  onChange={(event) =>
                    setTrunk({ ...trunk, gatewayUri: event.target.value })
                  }
                  placeholder="sip:gateway.example.com:5061"
                />
              </CreatorField>
            </div>
            <CreatorField label={t('field.authentication')}>
              <select
                value={trunk.authType}
                onChange={(event) =>
                  setTrunk({ ...trunk, authType: event.target.value })
                }
              >
                <option value="userpass">Username + password</option>
                <option value="ip">IP allowlist</option>
              </select>
            </CreatorField>
            <CreatorField label={t('field.transport')}>
              <select
                value={trunk.transport}
                onChange={(event) =>
                  setTrunk({ ...trunk, transport: event.target.value })
                }
              >
                <option value="tls">TLS</option>
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
              </select>
            </CreatorField>
            {trunk.authType === 'userpass' ? (
              <>
                <CreatorField label={t('field.username')}>
                  <Input
                    value={trunk.username}
                    onChange={(event) =>
                      setTrunk({ ...trunk, username: event.target.value })
                    }
                    autoComplete="off"
                  />
                </CreatorField>
                <CreatorField label={t('field.password')}>
                  <Input
                    type="password"
                    value={trunk.password}
                    onChange={(event) =>
                      setTrunk({ ...trunk, password: event.target.value })
                    }
                    autoComplete="new-password"
                  />
                </CreatorField>
              </>
            ) : null}
            <CreatorField label={t('field.mediaEncryption')}>
              <select
                value={trunk.mediaEncryption}
                onChange={(event) =>
                  setTrunk({ ...trunk, mediaEncryption: event.target.value })
                }
              >
                <option value="sdes">SRTP · SDES</option>
                <option value="dtls">SRTP · DTLS</option>
                <option value="none">None (not recommended)</option>
              </select>
            </CreatorField>
            <CreatorField label={t('field.codecs')}>
              <Input
                value={trunk.codecs}
                onChange={(event) =>
                  setTrunk({ ...trunk, codecs: event.target.value })
                }
              />
            </CreatorField>
          </div>
        ) : null}

        {module === 'reports' ? (
          <div className="grid gap-5 p-6 sm:grid-cols-2">
            <CreatorField label="Report name">
              <Input
                value={report.name}
                onChange={(event) =>
                  setReport({ ...report, name: event.target.value })
                }
                placeholder="Weekly call performance"
              />
            </CreatorField>
            <CreatorField label="What it reports on">
              <select
                value={report.reportType}
                onChange={(event) =>
                  setReport({ ...report, reportType: event.target.value })
                }
              >
                <option value="call_performance">Call performance</option>
                <option value="agent_productivity">Agent productivity</option>
                <option value="lead_conversion">Lead conversion</option>
                <option value="campaign_outcomes">Campaign outcomes</option>
                <option value="spend">Spend</option>
              </select>
            </CreatorField>
            <CreatorField label="How often">
              <select
                value={report.schedule}
                onChange={(event) =>
                  setReport({ ...report, schedule: event.target.value })
                }
              >
                {REPORT_SCHEDULES.map((option) => (
                  <option key={option} value={option}>
                    {describeSchedule(option)}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-[9px] text-ink-muted">
                {/* The cadence used to be a free-text field that ran daily
                    whatever it said. It is a closed set now, and the scheduler
                    honours it. */}
                A report that has never run goes out on the next cron tick, so a
                weekly report does not sit idle for a week before its first one.
              </p>
            </CreatorField>
            <CreatorField label="Email it to">
              <Input
                value={report.recipients}
                onChange={(event) =>
                  setReport({ ...report, recipients: event.target.value })
                }
                placeholder="ops@yourcompany.com, finance@yourcompany.com"
              />
              <p className="mt-2 text-[9px] text-ink-muted">
                Up to {MAX_RECIPIENTS}. Leave it empty and the report is
                generated for download only — it will say so rather than
                implying it was sent.
              </p>
            </CreatorField>
          </div>
        ) : null}

        <DialogFooter className="m-0 border-hairline bg-surface-muted px-6 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            className="border-hairline bg-transparent"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void create()}
            disabled={loading}
            className="portal-primary"
          >
            {loading ? (
              <Loader2 className="animate-spin" />
            ) : module === 'campaigns' ? (
              <UsersRound />
            ) : module === 'sip_trunks' ? (
              <Cable />
            ) : (
              <Workflow />
            )}
            {module === 'campaigns'
              ? 'Create draft campaign'
              : module === 'sip_trunks'
                ? 'Save encrypted configuration'
                : 'Create report'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreatorField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-[10px] font-medium text-ink-muted">
      {label}
      <div className="mt-2 [&_input]:h-10 [&_input]:border-hairline [&_input]:bg-surface-strong [&_input]:text-xs [&_select]:h-10 [&_select]:w-full [&_select]:rounded-lg [&_select]:border [&_select]:border-hairline [&_select]:bg-surface [&_select]:px-3 [&_select]:text-xs [&_textarea]:border-hairline [&_textarea]:bg-surface-strong [&_textarea]:text-xs">
        {children}
      </div>
    </label>
  );
}

/**
 * Call history (§19: campaign/date/duration/outcome/recording/transcript/cost
 * filters).
 *
 * This was a flat table of the last hundred calls with no filters and no
 * total, so a workspace with thousands of them saw a hundred and had no way to
 * know the rest existed.
 *
 * The filter choices come from the workspace's own rows, not from a list in
 * this file. `outcome` holds two vocabularies written at different times plus
 * free prose from an older path, and a hardcoded dropdown would hide every row
 * whose outcome nobody predicted — the screen would look complete and be
 * wrong.
 */
function CallHistory({ data }: { data: OperationsData }) {
  const t = useT();
  const [openCallId, setOpenCallId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<CallHistoryResult | null>(null);
  const [loading, setLoading] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters))
      if (value) params.set(key, value);
    params.set('page', String(page));
    return params.toString();
  }, [filters, page]);

  useEffect(() => {
    let live = true;
    // Everything is deferred a tick, the loading flag included: setting state
    // synchronously in an effect body cascades renders, which is the same
    // reason the other loaders in this file use a timeout.
    const timer = window.setTimeout(async () => {
      if (live) setLoading(true);
      try {
        const response = await fetch(`/api/app/call-history?${query}`);
        if (!response.ok) return;
        const payload = (await response.json()) as CallHistoryResult;
        if (live) setResult(payload);
      } finally {
        if (live) setLoading(false);
      }
    }, 150);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const set = (key: string, value: string) => {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  };
  const options = result?.options;
  const calls = result?.calls ?? [];

  return (
    <div className="space-y-6">
      <Header
        eyebrow={t('screen.call_history.eyebrow')}
        title={t('screen.call_history.title')}
        description={t('screen.call_history.description')}
      />
      <Stats data={data} />

      <section className="rounded-2xl border border-hairline bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={filters.search ?? ''}
            onChange={(event) => set('search', event.target.value)}
            placeholder="Name or number"
            aria-label="Search calls by name or number"
            className="h-8 min-w-[170px] flex-1 rounded-lg border border-hairline bg-surface px-2.5 text-[10px]"
          />
          <Choice
            label="Outcome"
            value={filters.outcome ?? ''}
            values={options?.outcomes ?? []}
            onChange={(value) => set('outcome', value)}
          />
          <Choice
            label="Channel"
            value={filters.channel ?? ''}
            values={options?.channels ?? []}
            onChange={(value) => set('channel', value)}
          />
          <Choice
            label="Direction"
            value={filters.direction ?? ''}
            values={options?.directions ?? []}
            onChange={(value) => set('direction', value)}
          />
          <Choice
            label="Sentiment"
            value={filters.sentiment ?? ''}
            values={options?.sentiments ?? []}
            onChange={(value) => set('sentiment', value)}
          />
          <Named
            label="Campaign"
            value={filters.campaign ?? ''}
            values={options?.campaigns ?? []}
            onChange={(value) => set('campaign', value)}
          />
          <Named
            label="Agent"
            value={filters.agent ?? ''}
            values={options?.agents ?? []}
            onChange={(value) => set('agent', value)}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-[10px] text-ink-muted">
            From
            <input
              type="date"
              value={filters.from ?? ''}
              onChange={(event) => set('from', event.target.value)}
              className="h-8 rounded-lg border border-hairline bg-surface px-2 text-[10px]"
            />
          </label>
          <label className="flex items-center gap-1 text-[10px] text-ink-muted">
            To
            <input
              type="date"
              value={filters.to ?? ''}
              onChange={(event) => set('to', event.target.value)}
              className="h-8 rounded-lg border border-hairline bg-surface px-2 text-[10px]"
            />
          </label>
          <label className="flex items-center gap-1 text-[10px] text-ink-muted">
            Seconds
            <input
              type="number"
              min={0}
              value={filters.minSeconds ?? ''}
              onChange={(event) => set('minSeconds', event.target.value)}
              placeholder="min"
              className="h-8 w-16 rounded-lg border border-hairline bg-surface px-2 text-[10px]"
            />
            <input
              type="number"
              min={0}
              value={filters.maxSeconds ?? ''}
              onChange={(event) => set('maxSeconds', event.target.value)}
              placeholder="max"
              className="h-8 w-16 rounded-lg border border-hairline bg-surface px-2 text-[10px]"
            />
          </label>
          <label className="flex items-center gap-1 text-[10px] text-ink-muted">
            Credits
            <input
              type="number"
              min={0}
              value={filters.minCredits ?? ''}
              onChange={(event) => set('minCredits', event.target.value)}
              placeholder="min"
              className="h-8 w-16 rounded-lg border border-hairline bg-surface px-2 text-[10px]"
            />
            <input
              type="number"
              min={0}
              value={filters.maxCredits ?? ''}
              onChange={(event) => set('maxCredits', event.target.value)}
              placeholder="max"
              className="h-8 w-16 rounded-lg border border-hairline bg-surface px-2 text-[10px]"
            />
          </label>
          <TriState
            label="Recording"
            value={filters.recording ?? 'any'}
            onChange={(value) => set('recording', value)}
          />
          <TriState
            label="Transcript"
            value={filters.transcript ?? 'any'}
            onChange={(value) => set('transcript', value)}
          />
          {result?.filtered ? (
            <button
              type="button"
              onClick={() => {
                setFilters({});
                setPage(1);
              }}
              className="h-8 rounded-lg border border-hairline px-2.5 text-[10px]"
            >
              Clear
            </button>
          ) : null}
        </div>
        <p className="mt-2 text-[10px] text-ink-muted">
          {/* The total, so nobody reads a page of fifty as the whole history —
              and the cost of what is selected, not of the whole workspace. */}
          {loading ? 'Loading…' : (result?.range ?? '')}
          {result && result.total > 0
            ? ` · ${result.selection.credits} credits · ${duration(result.selection.seconds)}`
            : ''}
        </p>
      </section>

      <section className="overflow-hidden rounded-2xl border border-hairline bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-xs">
            <thead className="border-b border-hairline bg-surface-muted text-[9px] uppercase tracking-wider text-ink-muted">
              <tr>
                {[
                  'Customer',
                  'Agent',
                  'Campaign',
                  'Channel',
                  'Status',
                  'Outcome',
                  'Duration',
                  'Sentiment',
                  'Credits',
                  'Transcript',
                  'Recording',
                ].map((item) => (
                  <th key={item} className="px-4 py-3 font-medium">
                    {item}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/7">
              {calls.map((call) => (
                <tr key={str(call.id)}>
                  <td className="px-4 py-4">
                    <p className="font-medium">
                      {str(call.customer_name, 'Unknown')}
                    </p>
                    <p className="mt-1 font-mono text-[9px] text-ink-muted">
                      {str(call.channel, 'phone') === 'playground'
                        ? 'browser test'
                        : str(call.to_number)}
                    </p>
                  </td>
                  <td className="px-4 py-4 text-ink-body">
                    {str(call.agent_name)}
                  </td>
                  <td className="px-4 py-4 text-ink-body">
                    {str(call.campaign_name, '—')}
                  </td>
                  <td className="px-4 py-4">
                    {/* A playground conversation is real telemetry but not a
                        phone call, so it is labelled rather than blended in. */}
                    <span
                      className={`rounded-md px-2 py-1 text-[9px] uppercase tracking-wide ${
                        str(call.channel, 'phone') === 'playground'
                          ? 'bg-sky-400/12 text-sky-700'
                          : 'bg-surface-strong text-ink-muted'
                      }`}
                    >
                      {str(call.channel, 'phone') === 'playground'
                        ? 'Playground'
                        : str(call.direction, 'phone')}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <Status value={str(call.status)} />
                  </td>
                  <td className="px-4 py-4 text-ink-body">
                    {str(call.outcome).replaceAll('_', ' ')}
                  </td>
                  <td className="px-4 py-4">
                    {duration(call.duration_seconds)}
                  </td>
                  <td className="px-4 py-4 capitalize">
                    {str(call.sentiment)}
                  </td>
                  <td className="px-4 py-4">{str(call.cost_credits)}</td>
                  <td className="px-4 py-4">
                    {Number(call.has_transcript ?? 0) > 0 ? (
                      <button
                        type="button"
                        onClick={() => setOpenCallId(str(call.id))}
                        className="rounded-lg border border-hairline px-2.5 py-1.5 text-[10px] text-ink"
                      >
                        Read
                      </button>
                    ) : (
                      <span className="text-ink-muted">No transcript</span>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    {RECORDING_PRESENT.includes(str(call.recording_status)) ? (
                      <audio
                        controls
                        preload="none"
                        className="h-8 w-48"
                        src={`/api/app/recordings/${encodeURIComponent(str(call.id))}`}
                      />
                    ) : (
                      <span className="text-ink-muted">
                        {str(call.channel, 'phone') === 'playground'
                          ? 'No audio captured'
                          : str(call.recording_status) === 'pending'
                            ? 'Still arriving'
                            : 'Recording unavailable'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {result?.empty ? (
          /* The two blank screens look identical and mean opposite things. */
          <p className="px-4 py-8 text-center text-[11px] text-ink-muted">
            {result.empty === 'no_matches'
              ? 'No calls match these filters. Clear one and try again.'
              : 'No calls yet. They appear here as soon as your agent takes or places one.'}
          </p>
        ) : null}
      </section>

      {result && result.totalPages > 1 ? (
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="rounded-lg border border-hairline px-3 py-1.5 text-[10px] disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-[10px] text-ink-muted">
            Page {result.page} of {result.totalPages}
          </span>
          <button
            type="button"
            disabled={page >= result.totalPages}
            onClick={() => setPage((current) => current + 1)}
            className="rounded-lg border border-hairline px-3 py-1.5 text-[10px] disabled:opacity-40"
          >
            Next
          </button>
        </div>
      ) : null}

      {openCallId ? (
        <CallDetail callId={openCallId} onClose={() => setOpenCallId(null)} />
      ) : null}
    </div>
  );
}

type CallHistoryResult = {
  calls: Record<string, unknown>[];
  page: number;
  total: number;
  totalPages: number;
  range: string;
  empty: 'no_calls' | 'no_matches' | null;
  filtered: boolean;
  selection: { credits: number; seconds: number };
  options: {
    outcomes: string[];
    channels: string[];
    directions: string[];
    sentiments: string[];
    agents: Array<{ id: string; name: string }>;
    campaigns: Array<{ id: string; name: string }>;
  };
};

/** A dropdown of values the workspace has actually recorded. */
function Choice({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
}) {
  if (values.length === 0) return null;
  return (
    <select
      aria-label={`Filter by ${label}`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 rounded-lg border border-hairline bg-surface px-2 text-[10px]"
    >
      <option value="">{label} · All</option>
      {values.map((entry) => (
        <option key={entry} value={entry}>
          {entry.replaceAll('_', ' ')}
        </option>
      ))}
    </select>
  );
}

function Named({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: Array<{ id: string; name: string }>;
  onChange: (value: string) => void;
}) {
  if (values.length === 0) return null;
  return (
    <select
      aria-label={`Filter by ${label}`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 rounded-lg border border-hairline bg-surface px-2 text-[10px]"
    >
      <option value="">{label} · All</option>
      {values.map((entry) => (
        <option key={entry.id} value={entry.id}>
          {entry.name}
        </option>
      ))}
    </select>
  );
}

function TriState({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label={`Filter by ${label}`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 rounded-lg border border-hairline bg-surface px-2 text-[10px]"
    >
      <option value="any">{label} · Any</option>
      <option value="yes">Has {label.toLowerCase()}</option>
      <option value="no">No {label.toLowerCase()}</option>
    </select>
  );
}

/** Transcript, post-call intelligence, QA and tool timeline for one call. */
function CallDetail({
  callId,
  onClose,
}: {
  callId: string;
  onClose: () => void;
}) {
  const t = useT();
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(
          `/api/app/calls/${encodeURIComponent(callId)}`,
        );
        const payload = (await response.json()) as Record<string, unknown>;
        if (!active) return;
        if (!response.ok) {
          setError(str(payload.error, 'Could not load this call.'));
          return;
        }
        setDetail(payload);
      } catch {
        if (active) setError('Could not load this call.');
      }
    })();
    return () => {
      active = false;
    };
  }, [callId]);

  const call = (detail?.call ?? {}) as Record<string, unknown>;
  const summary = (detail?.summary ?? null) as Record<string, unknown> | null;
  const review = (detail?.qualityReview ?? null) as Record<
    string,
    unknown
  > | null;
  const turns = (detail?.turns ?? []) as Array<Record<string, unknown>>;
  const transport = (detail?.transport ?? []) as Array<Record<string, unknown>>;
  const objections = (() => {
    try {
      const parsed = JSON.parse(str(summary?.objections_json, '[]')) as unknown;
      return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
    } catch {
      return [];
    }
  })();
  const intelligence = str(call.intelligence_status);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/55 p-0 sm:p-4">
      <button
        type="button"
        aria-label={t('aria.closeCallDetail')}
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <section className="relative flex h-full w-full max-w-2xl flex-col overflow-hidden rounded-none border border-hairline bg-surface sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
          <div>
            <p className="text-[9px] uppercase tracking-wider text-ink-muted">
              Call detail
            </p>
            <h2 className="mt-1 text-sm font-semibold">
              {str(call.customer_name, 'Unknown caller')}
            </h2>
            <p className="mt-1 text-[10px] text-ink-muted">
              {str(call.agent_name)} · {callTimestamp(call.started_at)} ·{' '}
              {duration(call.duration_seconds)} · {str(call.latency_ms, '—')}ms
              avg
            </p>
          </div>
          <Button onClick={onClose} className="shrink-0">
            Close
          </Button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {error ? (
            <p className="text-[11px] text-danger-text">{error}</p>
          ) : null}
          {!detail && !error ? (
            <p className="text-[11px] text-ink-muted">Loading…</p>
          ) : null}
          {detail ? (
            <>
              <div className="rounded-xl border border-hairline bg-surface-muted p-4">
                <p className="text-[9px] uppercase tracking-wider text-ink-muted">
                  Post-call intelligence
                </p>
                {summary ? (
                  <>
                    <p className="mt-2 text-[12px] leading-relaxed text-ink">
                      {str(summary.summary)}
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <Mini
                        label={t('field.intent')}
                        value={str(summary.intent, '—')}
                      />
                      <Mini
                        label={t('field.sentiment')}
                        value={str(summary.sentiment, '—')}
                      />
                      <Mini
                        label={t('field.outcome')}
                        value={str(summary.outcome, '—').replaceAll('_', ' ')}
                      />
                    </div>
                    {objections.length ? (
                      <p className="mt-3 text-[11px] text-ink-body">
                        <span className="text-ink-muted">Objections: </span>
                        {objections.join(', ')}
                      </p>
                    ) : null}
                    {str(summary.next_action) ? (
                      <p className="mt-2 text-[11px] text-ink-body">
                        <span className="text-ink-muted">Next action: </span>
                        {str(summary.next_action)}
                      </p>
                    ) : null}
                    <p className="mt-3 text-[9px] text-ink-muted">
                      Generated by {str(summary.model, 'the configured model')}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-[11px] text-ink-muted">
                    {intelligence === 'queued'
                      ? 'Queued — runs on the next job tick.'
                      : intelligence === 'unavailable'
                        ? 'Not generated: no reasoning provider was reachable.'
                        : intelligence === 'no_transcript'
                          ? 'Nothing was said on this call.'
                          : 'No summary has been generated for this call.'}
                  </p>
                )}
              </div>

              {review ? (
                <div className="rounded-xl border border-hairline bg-surface-muted p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[9px] uppercase tracking-wider text-ink-muted">
                      AI quality review
                    </p>
                    <Status value={str(review.status)} />
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-5">
                    <Mini
                      label={t('field.overall')}
                      value={str(review.overall_score)}
                    />
                    <Mini
                      label={t('field.resolution')}
                      value={str(review.resolution_score)}
                    />
                    <Mini
                      label={t('field.knowledge')}
                      value={str(review.knowledge_score)}
                    />
                    <Mini
                      label={t('field.natural')}
                      value={str(review.naturalness_score)}
                    />
                    <Mini
                      label={t('field.policy')}
                      value={str(review.policy_score)}
                    />
                  </div>
                </div>
              ) : null}

              {transport.length ? (
                <div className="rounded-xl border border-hairline bg-surface-muted p-4">
                  <p className="text-[9px] uppercase tracking-wider text-ink-muted">
                    {t('field.audioPath')}
                  </p>
                  <p className="mt-1 text-[10px] text-ink-muted">
                    {t('field.audioPathNote')}
                  </p>
                  {transport.map((leg, legIndex) => {
                    let warnings: Array<{ code?: string; message?: string }> =
                      [];
                    try {
                      const parsed = JSON.parse(
                        str(leg.warnings_json, '[]'),
                      ) as unknown;
                      warnings = Array.isArray(parsed) ? parsed : [];
                    } catch {
                      warnings = [];
                    }
                    return (
                      <div key={legIndex} className="mt-3">
                        <p className="text-[10px] text-ink-muted">
                          {str(leg.leg_role, 'agent')} ·{' '}
                          {str(leg.transport, 'websocket')} ·{' '}
                          {str(leg.band, '—')} {str(leg.score)}/100
                        </p>
                        <div className="mt-2 grid gap-3 sm:grid-cols-4">
                          <Mini
                            raw
                            label={t('dialer.upstream')}
                            value={`${str(leg.send_kbps, '—')} kbps`}
                          />
                          <Mini
                            raw
                            label={t('dialer.downstream')}
                            value={`${str(leg.receive_kbps, '—')} kbps`}
                          />
                          <Mini
                            raw
                            label={t('dialer.pacing')}
                            value={`${str(leg.pacing_jitter_ms, '—')} ms`}
                          />
                          <Mini
                            raw
                            label={t('dialer.socketRtt')}
                            value={
                              leg.socket_rtt_ms
                                ? `${str(leg.socket_rtt_ms)} ms`
                                : '—'
                            }
                          />
                          <Mini
                            raw
                            label={t('dialer.dropouts')}
                            value={str(leg.underruns, '0')}
                          />
                          <Mini
                            raw
                            label={t('dialer.worstGap')}
                            value={`${str(leg.worst_gap_ms, '0')} ms`}
                          />
                          <Mini
                            raw
                            label={t('dialer.framesSent')}
                            value={str(leg.frames_sent, '0')}
                          />
                          <Mini
                            raw
                            label={t('dialer.framesReceived')}
                            value={str(leg.frames_received, '0')}
                          />
                          <Mini
                            raw
                            label={t('dialer.longestSilence')}
                            value={`${str(leg.longest_silence_ms, '0')} ms`}
                          />
                        </div>
                        {warnings.length ? (
                          <ul className="mt-2 space-y-1">
                            {warnings.map((warning, index) => (
                              <li
                                key={`${legIndex}-${index}`}
                                className="text-[10px] text-warning-text"
                              >
                                {str(warning.message)}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <div>
                <p className="text-[9px] uppercase tracking-wider text-ink-muted">
                  Transcript · {turns.length} turns
                </p>
                <div className="mt-3 space-y-2">
                  {turns.map((turn) => {
                    const isCustomer = str(turn.role) === 'customer';
                    let tools: Array<Record<string, unknown>> = [];
                    try {
                      const parsed = JSON.parse(
                        str(turn.tool_calls_json, '[]'),
                      ) as unknown;
                      tools = Array.isArray(parsed)
                        ? (parsed as Array<Record<string, unknown>>)
                        : [];
                    } catch {
                      tools = [];
                    }
                    return (
                      <div
                        key={str(turn.turn_index)}
                        className={`rounded-xl border px-3 py-2.5 ${
                          isCustomer
                            ? 'border-hairline bg-surface-muted'
                            : 'border-emerald-400/15 bg-emerald-400/[0.05]'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-ink-muted">
                          <span>{isCustomer ? 'Customer' : 'Agent'}</span>
                          <span>
                            {turn.latency_ms ? `${str(turn.latency_ms)}ms` : ''}
                          </span>
                        </div>
                        <p className="mt-1.5 text-[12px] leading-relaxed text-ink">
                          {str(turn.content)}
                        </p>
                        {tools.length ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {tools.map((tool, index) => (
                              <span
                                key={`${str(turn.turn_index)}-${index}`}
                                className="rounded-md bg-amber-400/12 px-2 py-1 text-[9px] text-warning-text"
                              >
                                {str(tool.name).replaceAll('_', ' ')}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function LiveMonitor({ data }: { data: OperationsData }) {
  const t = useT();
  const live = data.calls.filter((call) => call.status === 'in_progress');
  const [openCallId, setOpenCallId] = useState<string | null>(null);
  // Live audio monitoring works now that the media gateway carries browser
  // legs, so a supervisor can listen, whisper or join for real.
  const [monitorCallId, setMonitorCallId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function takeOver(callId: string) {
    setBusy(callId);
    setNotice(null);
    try {
      const response = await fetch('/api/app/queues', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'request_takeover', callId }),
      });
      const body = (await response.json()) as {
        error?: string;
        message?: string;
        transferred?: boolean;
        agent?: { name?: string };
      };
      setNotice(
        body.error ??
          (body.transferred
            ? `Assigned to ${body.agent?.name ?? 'an available agent'}.`
            : (body.message ??
              'Queued for a human — nobody is available right now.')),
      );
    } catch {
      setNotice('Could not request a takeover.');
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="space-y-6">
      <Header
        eyebrow={t('screen.live_monitor.eyebrow')}
        title={t('screen.live_monitor.title')}
        description={t('screen.live_monitor.description')}
        action={
          <Button variant="outline" className="border-hairline bg-transparent">
            <Radio className="text-success-text" />
            {live.length} live
          </Button>
        }
      />
      <Stats data={data} />
      {notice ? (
        <p className="rounded-lg border border-hairline bg-surface-muted px-3 py-2 text-[11px] text-ink">
          {notice}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {live.map((call) => (
          <section
            key={str(call.id)}
            className="rounded-2xl border border-emerald-400/12 bg-[linear-gradient(145deg,rgba(52,211,153,0.055),#ffffff_55%)] p-5"
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-[10px] text-success-text">
                <span className="size-2 animate-pulse rounded-full bg-emerald-400" />{' '}
                Live conversation
              </span>
              <span className="font-mono text-[10px] text-ink-muted">
                {duration(call.duration_seconds)}
              </span>
            </div>
            <h2 className="mt-5 text-lg font-semibold">
              {str(call.customer_name)}
            </h2>
            <p className="mt-2 text-xs leading-5 text-ink-muted">
              {str(call.summary)}
            </p>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <Mini label={t('field.agent')} value={str(call.agent_name)} />
              <Mini
                label={t('field.latency')}
                value={`${str(call.latency_ms)}ms`}
              />
              <Mini label={t('field.sentiment')} value={str(call.sentiment)} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-hairline bg-transparent text-[9px]"
                onClick={() => setOpenCallId(str(call.id))}
              >
                <Headphones /> Transcript
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-hairline bg-transparent text-[9px]"
                onClick={() =>
                  setMonitorCallId(
                    monitorCallId === str(call.id) ? null : str(call.id),
                  )
                }
              >
                <Radio />
                {monitorCallId === str(call.id) ? 'Hide audio' : 'Audio'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-hairline bg-transparent text-[9px]"
                disabled={busy === str(call.id)}
                onClick={() => void takeOver(str(call.id))}
              >
                {busy === str(call.id) ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <PhoneCall />
                )}
                Take over
              </Button>
            </div>
            {monitorCallId === str(call.id) ? (
              <SupervisorMonitor
                callId={str(call.id)}
                onClose={() => setMonitorCallId(null)}
              />
            ) : null}
          </section>
        ))}
        {!live.length ? (
          <Empty icon={Radio} label={t('state.noLiveCalls')} />
        ) : null}
      </div>
      {openCallId ? (
        <CallDetail callId={openCallId} onClose={() => setOpenCallId(null)} />
      ) : null}
    </div>
  );
}

type AnalyticsPayload = {
  windowDays: number;
  totals: {
    calls: number;
    leads: number;
    totalMinutes: number;
    credits: number;
    avgLatencyMs: number;
    resolutionRate: number;
    transferRate: number;
    failureRate: number;
  };
  series: Array<{
    day: string;
    calls: number;
    conversions: number;
    leads: number;
    avgLatency: number;
  }>;
  outcomes: Array<{ name: string; value: number }>;
  sentiments: Array<{ name: string; value: number }>;
  tools?: Array<{
    toolName: string;
    calls: number;
    succeeded: number;
    answeredNo: number;
    rejectedInput: number;
    failed: number;
    failureRate: number | null;
    medianLatencyMs: number | null;
    p95LatencyMs: number | null;
  }>;
  byLanguage: Array<{
    language: string;
    label: string;
    calls: number;
    avgLatencyMs: number;
    transferred: number;
    avgQuality: number;
  }>;
  byAgent: Array<{
    agent: string;
    calls: number;
    avgLatencyMs: number;
    resolved: number;
  }>;
};

/**
 * Analytics now reads server-side aggregates over the whole window. It used to
 * compute everything in the browser from the last 100 call rows and reported
 * `leads: 0` because it had no lead data at all.
 */
function Analytics() {
  const t = useT();
  const [days, setDays] = useState(30);
  const [payload, setPayload] = useState<AnalyticsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/app/analytics?days=${days}`);
          const body = (await response.json()) as AnalyticsPayload & {
            error?: string;
          };
          if (!active) return;
          if (!response.ok) {
            setError(body.error ?? 'Could not load analytics.');
            return;
          }
          setPayload(body);
          setError(null);
        } catch {
          if (active) setError('Could not load analytics.');
        }
      })();
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [days]);

  const totals = payload?.totals;
  return (
    <div className="space-y-6">
      <Header
        eyebrow={t('screen.analytics.eyebrow')}
        title={t('screen.analytics.title')}
        description={t('screen.analytics.description')}
      />
      <div className="flex flex-wrap items-center gap-2">
        {[7, 30, 90].map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setDays(option)}
            className={`rounded-lg border px-3 py-1.5 text-[11px] transition ${
              days === option
                ? 'border-hairline bg-surface-strong text-ink'
                : 'border-hairline bg-surface-strong text-ink-body hover:text-ink'
            }`}
          >
            Last {option} days
          </button>
        ))}
        {payload ? (
          <span className="text-[10px] text-ink-muted">
            {payload.totals.calls} calls in window
          </span>
        ) : null}
      </div>
      {error ? <p className="text-[11px] text-danger-text">{error}</p> : null}
      {!payload && !error ? (
        <p className="text-[11px] text-ink-muted">Loading aggregates…</p>
      ) : null}

      {totals ? (
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <Mini label={t('field.calls')} value={String(totals.calls)} />
          <Mini label={t('field.leadsCreated')} value={String(totals.leads)} />
          <Mini
            label={t('field.talkMinutes')}
            value={String(totals.totalMinutes)}
          />
          <Mini
            label={t('field.resolution')}
            value={`${totals.resolutionRate}%`}
          />
          <Mini
            label={t('field.transferred')}
            value={`${totals.transferRate}%`}
          />
          <Mini
            label={t('field.avgLatency')}
            value={
              totals.avgLatencyMs ? `${totals.avgLatencyMs}ms` : 'not measured'
            }
          />
        </div>
      ) : null}

      {payload ? (
        <>
          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <section className="portal-panel p-5">
              <h2 className="text-sm font-semibold">Conversation trend</h2>
              <p className="mt-1 text-[10px] text-ink-muted">
                {payload.windowDays} days · calls, conversions and leads
              </p>
              <ActivityAreaChart data={payload.series} />
            </section>
            <section className="portal-panel p-5">
              <h2 className="text-sm font-semibold">Outcome distribution</h2>
              <p className="mt-1 text-[10px] text-ink-muted">
                Every recorded outcome in the window
              </p>
              <DistributionChart
                data={payload.outcomes.map((row) => ({
                  name: row.name.replaceAll('_', ' '),
                  value: row.value,
                }))}
              />
            </section>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="portal-panel p-5">
              <h2 className="text-sm font-semibold">Performance by language</h2>
              <p className="mt-1 text-[10px] text-ink-muted">
                A drop in one language is invisible in a blended average
              </p>
              <div className="mt-4 space-y-2">
                {payload.byLanguage.length === 0 ? (
                  <p className="text-[11px] text-ink-muted">
                    No calls in this window.
                  </p>
                ) : null}
                {payload.byLanguage.map((row) => (
                  <div
                    key={row.language}
                    className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-surface-muted px-3 py-2.5 text-[11px]"
                  >
                    <span className="font-medium">{row.label}</span>
                    <span className="text-ink-muted">{row.calls} calls</span>
                    <span className="text-ink-muted">
                      {row.avgLatencyMs ? `${row.avgLatencyMs}ms` : '—'}
                    </span>
                    <span className="text-ink-muted">
                      {row.transferred} transferred
                    </span>
                    <span className="ml-auto text-[9px] text-ink-muted">
                      {row.avgQuality ? `QA ${row.avgQuality}` : 'not reviewed'}
                    </span>
                  </div>
                ))}
              </div>
            </section>
            <section className="portal-panel p-5">
              <h2 className="text-sm font-semibold">Performance by agent</h2>
              <p className="mt-1 text-[10px] text-ink-muted">
                Calls, latency and resolved conversations
              </p>
              <div className="mt-4 space-y-2">
                {payload.byAgent.length === 0 ? (
                  <p className="text-[11px] text-ink-muted">
                    No calls in this window.
                  </p>
                ) : null}
                {payload.byAgent.map((row) => (
                  <div
                    key={row.agent}
                    className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-surface-muted px-3 py-2.5 text-[11px]"
                  >
                    <span className="font-medium">{row.agent}</span>
                    <span className="text-ink-muted">{row.calls} calls</span>
                    <span className="text-ink-muted">
                      {row.avgLatencyMs ? `${row.avgLatencyMs}ms` : '—'}
                    </span>
                    <span className="ml-auto text-[9px] text-ink-muted">
                      {row.resolved} resolved
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
          {payload.tools?.length ? (
            <section className="portal-panel p-5">
              <h2 className="text-sm font-semibold">Actions the agent took</h2>
              <p className="mt-1 text-[10px] text-ink-muted">
                Every tool call is recorded; this is what your agents actually
                used in this window
              </p>
              <div className="mt-4 space-y-2">
                {payload.tools.map((tool) => (
                  <div
                    key={tool.toolName}
                    className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-surface-muted px-3 py-2.5 text-[11px]"
                  >
                    <span className="font-medium">
                      {tool.toolName.replaceAll('_', ' ')}
                    </span>
                    <span className="text-ink-muted">{tool.calls} calls</span>
                    <span className="text-ink-muted">
                      {tool.medianLatencyMs === null
                        ? 'no timing'
                        : `${tool.medianLatencyMs}ms median`}
                    </span>
                    {tool.p95LatencyMs !== null ? (
                      <span className="text-ink-muted">
                        {tool.p95LatencyMs}ms p95
                      </span>
                    ) : null}
                    <span
                      className={`ml-auto text-[9px] ${
                        tool.failed > 0
                          ? 'text-danger-text'
                          : 'text-success-text'
                      }`}
                    >
                      {/* Never "0% failed" for a tool nobody called — that is a
                          green tick on an untested action. */}
                      {tool.failureRate === null
                        ? 'not used'
                        : tool.failed === 0
                          ? 'all succeeded'
                          : `${tool.failed} failed · ${Math.round(tool.failureRate * 100)}%`}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          <ObjectionLibrary />
        </>
      ) : null}
    </div>
  );
}

type ObjectionEntry = {
  id: string;
  objection: string;
  count: number;
  rebuttal: string | null;
  status: string;
  firstHeardAt: string;
  lastHeardAt: string;
};

/**
 * The objection library (§10).
 *
 * Every call has always extracted the objections the caller raised, and every
 * one of them went into a JSON column nothing read. This is the screen that
 * reads them — and, more to the point, the screen where a workspace writes back
 * the answer it wants used, which is what then reaches a live call.
 */
function ObjectionLibrary() {
  const [entries, setEntries] = useState<ObjectionEntry[]>([]);
  const [briefed, setBriefed] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/app/objections');
      const body = (await response.json()) as {
        objections?: ObjectionEntry[];
        briefed?: number;
      };
      setEntries(body.objections ?? []);
      setBriefed(Number(body.briefed ?? 0));
    } catch {
      setEntries([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // Deferred a tick for the same reason as Analytics above: setting state
    // synchronously in an effect body cascades renders.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const send = async (body: Record<string, unknown>) => {
    setSaving(true);
    try {
      await fetch('/api/app/objections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      setEditing(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  return (
    <section className="portal-panel p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-semibold">Objection library</h2>
        <span className="text-[10px] text-ink-muted">
          {entries.length
            ? `${briefed} of ${entries.length} briefed to your agents`
            : 'Built from what callers actually said'}
        </span>
      </div>
      <p className="mt-1 text-[10px] text-ink-muted">
        An objection reaches your agents once it has been heard more than once,
        or as soon as you write an approved answer for it. Agents are never
        given an answer you did not write.
      </p>
      {entries.length === 0 ? (
        <p className="mt-4 text-[11px] text-ink-muted">
          Nothing recorded yet. Objections are collected automatically after
          each analysed call.
        </p>
      ) : null}
      <div className="mt-4 space-y-2">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="rounded-xl border border-hairline bg-surface-muted px-3 py-2.5 text-[11px]"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{entry.objection}</span>
              <span className="text-ink-muted">
                heard {entry.count}
                {entry.count === 1 ? ' time' : ' times'}
              </span>
              {entry.rebuttal ? (
                <span className="text-[9px] text-success-text">
                  approved answer in use
                </span>
              ) : entry.count > 1 ? (
                <span className="text-[9px] text-warning-text">
                  no approved answer
                </span>
              ) : null}
              <span className="ml-auto flex gap-2">
                <button
                  type="button"
                  className="text-[10px] text-ink-body underline-offset-2 hover:underline"
                  onClick={() => {
                    setEditing(entry.id);
                    setDraft(entry.rebuttal ?? '');
                  }}
                >
                  {entry.rebuttal ? 'Edit answer' : 'Write answer'}
                </button>
                <button
                  type="button"
                  className="text-[10px] text-ink-muted underline-offset-2 hover:underline"
                  onClick={() =>
                    void send({ action: 'dismiss', objectionId: entry.id })
                  }
                >
                  Dismiss
                </button>
              </span>
            </div>
            {entry.rebuttal && editing !== entry.id ? (
              <p className="mt-2 text-[10px] text-ink-body">{entry.rebuttal}</p>
            ) : null}
            {editing === entry.id ? (
              <div className="mt-2 space-y-2">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={3}
                  maxLength={1200}
                  placeholder="What should the agent say back? Your agents will use this wording."
                  className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[11px]"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    className="portal-primary rounded-lg px-3 py-1.5 text-[10px] disabled:opacity-60"
                    onClick={() =>
                      void send({
                        action: 'set_rebuttal',
                        objectionId: entry.id,
                        rebuttal: draft,
                      })
                    }
                  >
                    Save answer
                  </button>
                  <button
                    type="button"
                    className="text-[10px] text-ink-muted"
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function Quality({ data }: { data: OperationsData }) {
  const t = useT();
  const average = data.qualityReviews.length
    ? Math.round(
        data.qualityReviews.reduce(
          (sum, item) => sum + Number(item.overall_score ?? 0),
          0,
        ) / data.qualityReviews.length,
      )
    : 0;
  return (
    <div className="space-y-6">
      <Header
        eyebrow={t('screen.quality.eyebrow')}
        title={t('screen.quality.title')}
        description={t('screen.quality.description')}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric
          label={t('field.averageQa')}
          value={`${average}/100`}
          icon={ShieldCheck}
        />
        <Metric
          label={t('field.reviewedCalls')}
          value={String(data.qualityReviews.length)}
          icon={Headphones}
        />
        <Metric
          label={t('field.openFindings')}
          value={String(
            data.qualityReviews.filter((item) => item.status !== 'passed')
              .length,
          )}
          icon={AlertTriangle}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.qualityReviews.map((review) => (
          <section
            key={str(review.id)}
            className="rounded-2xl border border-hairline bg-surface p-5"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">
                  {str(review.customer_name)}
                </p>
                <p className="mt-1 text-[10px] text-ink-muted">
                  {str(review.outcome).replaceAll('_', ' ')}
                </p>
              </div>
              <span className="text-2xl font-semibold text-cyan-700">
                {str(review.overall_score)}
              </span>
            </div>
            <div className="mt-5 grid grid-cols-4 gap-2">
              <Mini
                label={t('field.resolution')}
                value={str(review.resolution_score)}
              />
              <Mini
                label={t('field.knowledge')}
                value={str(review.knowledge_score)}
              />
              <Mini
                label={t('field.natural')}
                value={str(review.naturalness_score)}
              />
              <Mini
                label={t('field.policy')}
                value={str(review.policy_score)}
              />
            </div>
            <div className="mt-4 flex gap-2 text-[9px] text-ink-muted">
              <span className="rounded-lg bg-surface-strong px-2 py-1">
                Hallucinations {str(review.hallucination_count)}
              </span>
              <span className="rounded-lg bg-surface-strong px-2 py-1">
                Overlaps {str(review.overlap_count)}
              </span>
              <Status value={str(review.status)} />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function WorkspaceSettings({
  data,
  onChanged,
}: {
  data: OperationsData;
  onChanged: () => Promise<void> | void;
}) {
  const t = useT();
  const current = data.settings ?? {};
  const [language, setLanguage] = useState(
    str(current.default_language, 'hinglish'),
  );
  const [recording, setRecording] = useState(
    str(current.recording_policy, 'record_with_consent'),
  );
  // The stored set drives the agent's allowed languages; it used to be
  // unreachable from the UI, so Punjabi could only be added straight in the DB.
  const [enabledLanguages, setEnabledLanguages] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(
        str(current.enabled_languages_json, '[]'),
      ) as unknown;
      const codes = Array.isArray(parsed)
        ? parsed.map((item) => String(item))
        : [];
      return codes.filter((code) => SUPPORTED_LANGUAGE_CODES.has(code));
    } catch {
      return [];
    }
  });
  // Retention, QA sampling and redaction used to be hardcoded in save(), so
  // changing a language silently reset them. They are editable and preserved.
  const [recordingDays, setRecordingDays] = useState(
    str(current.recording_retention_days, '90'),
  );
  const [transcriptDays, setTranscriptDays] = useState(
    str(current.transcript_retention_days, '180'),
  );
  const [qaSampleRate, setQaSampleRate] = useState(
    str(current.qa_sample_rate, '100'),
  );
  const [redact, setRedact] = useState(
    Number(current.redact_sensitive_data ?? 1) !== 0,
  );
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  function toggleLanguage(code: string) {
    setEnabledLanguages((previous) =>
      previous.includes(code)
        ? previous.filter((item) => item !== code)
        : [...previous, code],
    );
  }
  async function save() {
    setLoading(true);
    setNotice(null);
    try {
      await mutate({
        action: 'update_settings',
        defaultLanguage: language,
        // The default is always allowed, so the agent cannot be told to speak
        // a language the workspace has switched off.
        enabledLanguages: Array.from(new Set([language, ...enabledLanguages])),
        recordingPolicy: recording,
        timezone: str(current.timezone, 'Asia/Kolkata'),
        qaSampleRate: Number(qaSampleRate),
        recordingRetentionDays: Number(recordingDays),
        transcriptRetentionDays: Number(transcriptDays),
        redactSensitiveData: redact,
      });
      await onChanged();
      setNotice('Settings saved.');
    } catch {
      setNotice('Could not save settings.');
    } finally {
      setLoading(false);
    }
  }
  const compliance = data.compliance ?? {
    consents: [],
    suppressions: [],
    kycDocuments: [],
  };
  return (
    <div className="space-y-6">
      <Header
        eyebrow={t('screen.settings.eyebrow')}
        title={t('screen.settings.title')}
        description={t('screen.settings.description')}
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_0.72fr]">
        <section className="portal-panel p-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={t('field.defaultLanguage')}>
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              >
                {/* Grouped because the catalog is no longer India-only (§11);
                    eighteen flat entries hide where the global ones start. */}
                <optgroup label="India">
                  {languagesForRegion('india').map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Global">
                  {languagesForRegion('global').map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.label}
                    </option>
                  ))}
                </optgroup>
              </select>
            </Field>
            <Field label={t('field.recordingPolicy')}>
              <select
                value={recording}
                onChange={(event) => setRecording(event.target.value)}
              >
                <option value="record_with_consent">
                  {t('settings.recording.consent')}
                </option>
                <option value="disabled">
                  {t('settings.recording.disabled')}
                </option>
                <option value="always_record">
                  {t('settings.recording.always')}
                </option>
              </select>
            </Field>
          </div>
          <div className="mt-5">
            <p className="text-[11px] font-semibold text-ink">
              {t('settings.languages.title')}
            </p>
            <p className="mt-1 text-[10px] text-ink-muted">
              {t('settings.languages.hint')}
            </p>
            {(['india', 'global'] as const).map((region) => (
              <div key={region} className="mt-3">
                <p className="text-[9px] uppercase tracking-wide text-ink-muted">
                  {region === 'india' ? 'India' : 'Global'}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {languagesForRegion(region).map((item) => {
                    const isDefault = item.code === language;
                    const active =
                      isDefault || enabledLanguages.includes(item.code);
                    return (
                      <button
                        key={item.code}
                        type="button"
                        disabled={isDefault}
                        onClick={() => toggleLanguage(item.code)}
                        title={`${item.nativeName} · needs ${item.engines.join(' or ')}`}
                        className={`rounded-lg border px-3 py-1.5 text-[11px] transition ${
                          active
                            ? 'border-emerald-400/40 bg-emerald-400/12 text-success-text'
                            : 'border-hairline bg-surface-strong text-ink-body hover:text-ink'
                        } ${isDefault ? 'cursor-default opacity-80' : ''}`}
                      >
                        {item.label}
                        {isDefault
                          ? ` · ${t('settings.languages.defaultSuffix')}`
                          : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5">
            <p className="text-[11px] font-semibold text-ink">
              Notification sound
            </p>
            <p className="mt-1 text-[10px] text-ink-muted">
              Plays for ringing, transfers, payments and credit warnings (§33)
            </p>
            <div className="mt-3">
              <SoundSettings />
            </div>
          </div>
          <div className="mt-5 grid gap-5 sm:grid-cols-3">
            <Field label={t('field.recordingRetention')}>
              <input
                type="number"
                min={1}
                max={3650}
                value={recordingDays}
                onChange={(event) => setRecordingDays(event.target.value)}
              />
            </Field>
            <Field label={t('field.transcriptRetention')}>
              <input
                type="number"
                min={1}
                max={3650}
                value={transcriptDays}
                onChange={(event) => setTranscriptDays(event.target.value)}
              />
            </Field>
            <Field label={t('field.qaSampleRate')}>
              <input
                type="number"
                min={0}
                max={100}
                value={qaSampleRate}
                onChange={(event) => setQaSampleRate(event.target.value)}
              />
            </Field>
          </div>
          <label className="mt-4 flex items-center gap-2 text-[11px] text-ink">
            <input
              type="checkbox"
              checked={redact}
              onChange={(event) => setRedact(event.target.checked)}
            />
            {t('settings.redact')}
          </label>
          <Button
            onClick={save}
            disabled={loading}
            className="portal-primary mt-5"
          >
            {loading ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
            {t('settings.saveButton')}
          </Button>
          {notice ? (
            <p className="mt-3 text-[11px] text-ink-body">{notice}</p>
          ) : null}
        </section>
        <section className="portal-panel p-5">
          <h2 className="text-sm font-semibold">
            {t('settings.compliance.title')}
          </h2>
          <p className="mt-1 text-[10px] text-ink-muted">
            {t('settings.compliance.hint')}
          </p>
          <div className="mt-5 grid gap-3">
            <Mini
              label={t('field.activeConsent')}
              value={String(
                compliance.consents.filter((item) => item.status === 'granted')
                  .length,
              )}
            />
            <Mini
              label={t('field.suppressedContacts')}
              value={String(compliance.suppressions.length)}
            />
            <Mini
              label={t('field.kycDocuments')}
              value={String(compliance.kycDocuments.length)}
            />
          </div>
          <p className="mt-4 text-[9px] leading-4 text-ink-muted">
            Outbound call creation is rejected unless consent is valid, the
            number is not suppressed and at least 10 credits remain.
          </p>
        </section>
      </div>
      <CustomerSecurity />
    </div>
  );
}

function Stats({ data }: { data: OperationsData }) {
  const t = useT();
  const stats = data.stats ?? {};
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Metric
        label={t('field.totalCalls')}
        value={str(stats.total_calls, '0')}
        icon={PhoneCall}
      />
      <Metric
        label={t('field.live')}
        value={str(stats.live_calls, '0')}
        icon={Radio}
      />
      <Metric
        label={t('field.avgDuration')}
        value={duration(stats.average_duration)}
        icon={Activity}
      />
      <Metric
        label={t('field.avgLatency')}
        value={`${str(stats.average_latency, '0')}ms`}
        icon={Network}
      />
      <Metric
        label={t('field.recordings')}
        value={str(stats.recordings, '0')}
        icon={FileAudio}
      />
    </div>
  );
}
function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Bot;
}) {
  return (
    <section className="portal-stat group p-4">
      <span className="grid size-9 place-items-center rounded-xl border border-indigo-200/10 bg-indigo-300/[0.07] transition group-hover:border-indigo-200/20">
        <Icon className="size-[17px] text-[#bdc7ff]" />
      </span>
      <p className="mt-3 text-2xl font-semibold text-ink">{value}</p>
      <p className="mt-1 text-[9px] font-medium uppercase tracking-wider text-ink-muted">
        {label}
      </p>
    </section>
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
        <p className="mt-2 max-w-3xl text-xs leading-5 text-ink-muted">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}
function Status({ value }: { value: string }) {
  const good =
    /active|ready|live|completed|passed|resolved|connected|operational/.test(
      value.toLowerCase(),
    );
  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-[8px] capitalize ${good ? 'bg-emerald-400/8 text-success-text' : 'bg-amber-300/8 text-warning-text'}`}
    >
      {value.replaceAll('_', ' ')}
    </span>
  );
}
/**
 * `capitalize` is right for the enum-ish values this was built for
 * ("site_visit" → "Site visit") and wrong for measurements, where it turns
 * "15.5 kbps" into "15.5 Kbps". `raw` opts out.
 */
function Mini({
  label,
  value,
  raw = false,
}: {
  label: string;
  value: string;
  raw?: boolean;
}) {
  return (
    <div className="rounded-xl border border-hairline bg-surface-muted p-3">
      <p className="text-[8px] uppercase tracking-wider text-ink-muted">
        {label}
      </p>
      <p
        className={`mt-1 truncate text-[10px] font-medium text-ink-body ${raw ? '' : 'capitalize'}`}
      >
        {value}
      </p>
    </div>
  );
}
function Empty({ icon: Icon, label }: { icon: typeof Bot; label: string }) {
  return (
    <div className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-hairline bg-surface-muted text-center">
      <div>
        <Icon className="mx-auto size-6 text-ink-muted" />
        <p className="mt-3 text-xs text-ink-muted">{label}</p>
      </div>
    </div>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="text-xs text-ink-body">
      {label}
      <div className="mt-2 [&_select]:h-11 [&_select]:w-full [&_select]:rounded-xl [&_select]:border [&_select]:border-hairline [&_select]:bg-surface [&_select]:px-3 [&_select]:text-xs">
        {children}
      </div>
    </label>
  );
}
function str(value: unknown, fallback = '—') {
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
/** Timestamps are stored as UTC text; show them in the reader's local time. */
function callTimestamp(value: unknown) {
  const raw = str(value);
  if (!raw) return '—';
  const parsed = new Date(raw.includes('T') ? raw : `${raw}Z`);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
function duration(value: unknown) {
  const seconds = Number(value ?? 0);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
async function mutate(payload: Record<string, unknown>) {
  const response = await fetch('/api/app/operations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Request failed.');
  return body;
}
function resourceDescription(module: string, row: Record<string, unknown>) {
  if (module === 'sip_trunks')
    return `${str(row.gateway_uri)} · ${str(row.transport).toUpperCase()} · ${str(row.media_encryption).toUpperCase()}`;
  if (module === 'knowledge') return str(row.description);
  if (module === 'workflows')
    return `${str(row.trigger_type).replaceAll('_', ' ')} · ${str(row.run_count, '0')} runs`;
  if (module === 'graph_agents')
    return `Entry: ${str(row.entry_node)} · version ${str(row.version)}`;
  if (module === 'campaigns')
    return `${str(row.attempted, '0')} of ${str(row.audience_size, '0')} contacts attempted`;
  if (module === 'alerts')
    return `${str(row.metric).replaceAll('_', ' ')} ${str(row.comparator)} ${str(row.threshold)}`;
  const schedule = str(row.schedule, 'manual');
  const cadence = isReportSchedule(schedule)
    ? describeSchedule(schedule)
    : `${schedule} — not a schedule this build runs`;
  return `${str(row.report_type).replaceAll('_', ' ')} · ${cadence}`;
}
function resourceFacts(module: string, row: Record<string, unknown>) {
  if (module === 'campaigns')
    return [
      ['Connected', str(row.connected, '0')],
      ['Converted', str(row.converted, '0')],
    ];
  if (module === 'sip_trunks')
    return [
      ['Auth', str(row.auth_type)],
      ['Codecs', safeArray(row.codecs_json).join(', ')],
    ];
  if (module === 'knowledge')
    return [
      ['Sources', str(row.source_count, '0')],
      ['Chunks', str(row.chunk_count, '0')],
    ];
  if (module === 'workflows')
    return [
      ['Runs', str(row.run_count, '0')],
      ['Failures', str(row.failure_count, '0')],
    ];
  if (module === 'graph_agents')
    return [
      ['Version', str(row.version)],
      ['Entry', str(row.entry_node)],
    ];
  if (module === 'alerts')
    return [
      ['Window', `${str(row.window_minutes)} min`],
      ['Frequency', `${str(row.frequency_minutes)} min`],
    ];
  const schedule = str(row.schedule, 'manual');
  const next = isReportSchedule(schedule)
    ? nextRunAt({
        schedule,
        lastGeneratedAt: str(row.last_generated_at, '') || null,
      })
    : null;
  const recipients = safeArray(row.recipients_json);
  return [
    // "Not yet" was the whole story before; a scheduled report that has never
    // gone out and one that goes out tonight looked identical.
    ['Next run', next ? next.toLocaleString('en-IN') : 'Only when you ask'],
    [
      'Emailed to',
      recipients.length ? recipients.join(', ') : 'Nobody — download only',
    ],
  ];
}
function safeArray(value: unknown) {
  try {
    const parsed = JSON.parse(str(value, '[]'));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
