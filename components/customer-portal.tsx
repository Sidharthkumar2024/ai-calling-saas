'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Bot,
  BrainCircuit,
  BookOpenText,
  Cable,
  CircleDollarSign,
  ContactRound,
  CreditCard,
  Database,
  Gauge,
  Globe2,
  GitBranch,
  Headphones,
  LayoutDashboard,
  LifeBuoy,
  Loader2,
  Megaphone,
  PhoneCall,
  Radio,
  RefreshCcw,
  Repeat2,
  Settings2,
  Target,
  UsersRound,
  Webhook,
  Workflow,
  FileAudio,
  FileBarChart2,
} from 'lucide-react';

import {
  CustomerCrm,
  type CrmActivity,
  type CrmLead,
} from '@/components/customer-crm';
import { CustomerBilling, type BillingData } from '@/components/customer-billing';
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
import { PortalShell, type PortalNavGroup } from '@/components/portal-shell';
import { CustomerOperations, type OperationsData, type OperationsModule } from '@/components/customer-operations';
import { CustomerTickets, type TicketsData } from '@/components/customer-tickets';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type CustomerSession = {
  name: string;
  email: string;
  organizationName: string;
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
};

export type CustomerData = {
  overview: OverviewData;
  crm: { pipeline: CrmLead[]; activities: CrmActivity[] };
  numbers: CustomerNumbersData;
  integrations: IntegrationsData;
  apiKeys: ApiKeysData;
  webhooks: WebhooksData;
  billing: BillingData;
  agents: AgentsData;
  commerce: CommerceData;
  operations: OperationsData;
  tickets: TicketsData;
};

const groups: PortalNavGroup[] = [
  {
    label: 'Operate',
    items: [
      { id: 'overview', label: 'Overview', icon: LayoutDashboard },
      { id: 'crm', label: 'Advanced CRM', icon: Target },
      { id: 'agents', label: 'AI agents', icon: Bot },
      { id: 'graph_agents', label: 'Graph agents', icon: GitBranch },
      { id: 'workflows', label: 'Workflows', icon: Workflow },
      { id: 'knowledge', label: 'Knowledge base', icon: BookOpenText },
      { id: 'campaigns', label: 'Campaigns', icon: Radio, badge: 'Live' },
      { id: 'numbers', label: 'My numbers', icon: Globe2 },
      { id: 'sip_trunks', label: 'SIP trunks', icon: Cable },
    ],
  },
  {
    label: 'Observe',
    items: [
      { id: 'call_history', label: 'Call history', icon: PhoneCall },
      { id: 'live_monitor', label: 'Live monitoring', icon: Headphones, badge: '1' },
      { id: 'analytics', label: 'Analytics', icon: BarChart3 },
      { id: 'quality', label: 'AI quality assurance', icon: FileAudio },
      { id: 'alerts', label: 'Alerts', icon: AlertTriangle },
      { id: 'reports', label: 'Reports', icon: FileBarChart2 },
    ],
  },
  {
    label: 'Grow',
    items: [
      { id: 'lead_capture', label: 'Lead capture', icon: Megaphone },
      { id: 'retargeting', label: 'Retargeting', icon: Repeat2 },
      { id: 'commerce', label: 'AI commerce', icon: CircleDollarSign, badge: 'New' },
      { id: 'integrations', label: 'Integrations & API', icon: Webhook },
    ],
  },
  {
    label: 'Manage',
    items: [
      { id: 'billing', label: 'Billing & credits', icon: CreditCard },
      { id: 'team', label: 'Team', icon: UsersRound },
      { id: 'tickets', label: 'Support tickets', icon: LifeBuoy },
      { id: 'settings', label: 'Settings', icon: Settings2 },
    ],
  },
];

const emptyData: CustomerData = {
  overview: {},
  crm: { pipeline: [], activities: [] },
  numbers: { numbers: [] },
  integrations: { integrations: [] },
  apiKeys: { apiKeys: [] },
  webhooks: { webhooks: [] },
  billing: { plans: [], creditPackages: [], invoices: [], ledger: [] },
  agents: { agents: [], testSessions: [] },
  commerce: { paymentLinks: [], messages: [], scheduledActions: [], connections: [] },
  operations: { campaigns: [], sipTrunks: [], knowledgeBases: [], workflows: [], graphAgents: [], calls: [], qualityReviews: [], alertRules: [], incidents: [], reports: [] },
  tickets: { tickets: [], messages: [] },
};

export function CustomerPortal({ session }: { session: CustomerSession }) {
  const [active, setActive] = useState('overview');
  const [data, setData] = useState<CustomerData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function getJson<T>(url: string) {
    const response = await fetch(url, { cache: 'no-store' });
    if (response.status === 401 || response.status === 403) {
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
      const [overview, crm, numbers, integrations, apiKeys, webhooks, billing, agents, commerce, operations, tickets] = await Promise.all([
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
      ]);
      setData({ overview, crm, numbers, integrations, apiKeys, webhooks, billing, agents, commerce, operations, tickets });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load workspace.');
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
        nextAction: stage === 'won' ? 'Send confirmation and start onboarding' : lead.next_action,
      }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(payload.error || 'Unable to move opportunity.');
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

  const credits = Number(data.overview.stats?.credits ?? data.billing.wallet?.balance ?? 0);
  return (
    <PortalShell mode="customer" active={active} groups={groups} onNavigate={setActive} name={session.name} email={session.email} workspace={session.organizationName} credits={credits}>
      <div className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
        {loading ? <Loading /> : error ? <ErrorState error={error} retry={load} /> : null}
        {!loading && !error && active === 'overview' ? <CustomerOverview data={data.overview} onNavigate={setActive} /> : null}
        {!loading && !error && active === 'crm' ? <CustomerCrm leads={data.crm.pipeline} activities={data.crm.activities} onMove={moveLead} /> : null}
        {!loading && !error && active === 'agents' ? <CustomerAgentStudio data={data.agents} businessName={session.organizationName} onChanged={load} /> : null}
        {!loading && !error && ['campaigns','sip_trunks','knowledge','workflows','graph_agents','call_history','live_monitor','analytics','quality','alerts','reports'].includes(active) ? <CustomerOperations module={active as OperationsModule} data={data.operations} onChanged={load} /> : null}
        {!loading && !error && active === 'numbers' ? <CustomerNumbers data={data.numbers} onChanged={load} /> : null}
        {!loading && !error && active === 'lead_capture' ? <LeadCapture data={data.overview} /> : null}
        {!loading && !error && active === 'retargeting' ? <Retargeting /> : null}
        {!loading && !error && active === 'commerce' ? <CustomerCommerce data={data.commerce} onChanged={load} /> : null}
        {!loading && !error && active === 'integrations' ? <CustomerIntegrations integrations={data.integrations} apiKeys={data.apiKeys} webhooks={data.webhooks} onChanged={load} /> : null}
        {!loading && !error && active === 'billing' ? <CustomerBilling data={data.billing} onChanged={load} /> : null}
        {!loading && !error && active === 'team' ? <Team /> : null}
        {!loading && !error && active === 'tickets' ? <CustomerTickets data={data.tickets} onChanged={load} /> : null}
        {!loading && !error && active === 'settings' ? <CustomerOperations module="settings" data={data.operations} onChanged={load} /> : null}
      </div>
    </PortalShell>
  );
}

function CustomerOverview({ data, onNavigate }: { data: OverviewData; onNavigate: (id: string) => void }) {
  const stats = data.stats ?? {};
  const leads = data.recentLeads ?? [];
  return (
    <div className="space-y-6">
      <Header eyebrow="Revenue command center" title="Good evening, your AI team is working" description="Leads, conversations, appointments and revenue actions from the last 30 days." action={<Button onClick={() => onNavigate('campaigns')} className="bg-amber-300 text-[#17120a] hover:bg-amber-200"><PhoneCall /> Launch campaign</Button>} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Credits" value={num(stats.credits)} note="Wallet balance" icon={CircleDollarSign} />
        <Metric label="Captured leads" value={num(stats.leads)} note={`${num(stats.qualified)} high intent`} icon={ContactRound} />
        <Metric label="Pipeline" value={money(stats.pipelineValue)} note={`${num(stats.opportunities)} opportunities`} icon={Target} />
        <Metric label="Call jobs" value={num(stats.calls)} note={`${num(stats.queuedCalls)} queued`} icon={PhoneCall} />
        <Metric label="AI lead score" value={`${num(stats.averageScore)}/100`} note="Average intent" icon={BrainCircuit} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Panel><PanelTitle title="Lead-to-revenue velocity" note="Qualified leads and completed AI actions" /><div className="mt-7 grid h-56 grid-cols-14 items-end gap-2">{[22,34,28,46,52,39,62,57,71,64,78,72,86,92].map((height,index)=><div key={index} className="flex h-full items-end"><div className="w-full rounded-t bg-gradient-to-t from-cyan-300/12 via-violet-300/30 to-amber-300/80" style={{height:`${height}%`}} /></div>)}</div><div className="mt-3 flex justify-between text-[9px] text-white/25"><span>19 Aug</span><span>23 Aug</span><span>27 Aug</span><span>Today</span></div></Panel>
        <Panel><PanelTitle title="AI work queue" note="Next actions selected from customer intent" /><div className="mt-4 space-y-3">{[['Call hot Meta lead','Due now','hot'],['Send pricing after call','3 contacts','warm'],['Book site-visit slots','2 buyers','hot'],['Retarget no-answer leads','18 contacts','cool']].map(([title,note,tone])=><div key={title} className="flex items-center gap-3 rounded-xl border border-white/7 bg-white/[0.025] p-3"><span className={`size-2 rounded-full ${tone==='hot'?'bg-amber-300':tone==='warm'?'bg-violet-300':'bg-cyan-300'}`} /><div className="flex-1"><p className="text-xs font-medium">{title}</p><p className="mt-1 text-[9px] text-white/30">{note}</p></div><Button size="sm" variant="ghost" className="text-[9px] text-white/42">Open</Button></div>)}</div></Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <Panel className="overflow-hidden"><PanelTitle title="Priority leads" note="AI-scored across ads, forms and CRM" /><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead className="border-y border-white/8 text-[9px] uppercase tracking-wider text-white/25"><tr>{['Lead','Source','Score','Intent','Value','Stage'].map((h)=><th key={h} className="px-3 py-3 font-medium">{h}</th>)}</tr></thead><tbody className="divide-y divide-white/7">{leads.map((lead)=><tr key={lead.id}><td className="px-3 py-4"><p className="font-medium">{lead.name}</p><p className="mt-1 font-mono text-[9px] text-white/28">{lead.phone}</p></td><td className="px-3 py-4 text-white/48">{lead.source_name}</td><td className="px-3 py-4"><span className="rounded-lg bg-amber-300/10 px-2 py-1 font-mono text-amber-200">{lead.score}</span></td><td className="px-3 py-4 text-white/48">{String(lead.intent).replaceAll('_',' ')}</td><td className="px-3 py-4 text-white/58">{money(lead.estimated_value)}</td><td className="px-3 py-4"><Status value={lead.stage || lead.status} /></td></tr>)}</tbody></table></div></Panel>
        <Panel><PanelTitle title="Connected lead sources" note="Capture readiness by channel" /><div className="mt-4 space-y-4">{(data.sources??[]).map((source)=><div key={source.type} className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-white/5">{source.type==='meta_ads'?<Megaphone className="size-4 text-blue-300" />:source.type==='google_ads'?<BarChart3 className="size-4 text-amber-300" />:source.type==='website_form'?<Globe2 className="size-4 text-cyan-300" />:<Database className="size-4 text-violet-300" />}</span><div className="flex-1"><p className="text-xs font-medium">{source.name}</p><p className="mt-1 text-[9px] text-white/30">{source.status.replaceAll('_',' ')}</p></div><Status value={source.status} /></div>)}</div><Button onClick={() => onNavigate('lead_capture')} variant="outline" className="mt-5 w-full border-white/10 bg-transparent">Manage lead capture</Button></Panel>
      </div>
    </div>
  );
}

function LeadCapture({ data }: { data: OverviewData }) {
  return <div className="space-y-6"><Header eyebrow="Lead command center" title="Capture every source into one CRM" description="Meta, Google, website popup forms and direct API events are normalized, deduplicated and AI-scored." action={<Button className="bg-amber-300 text-[#17120a] hover:bg-amber-200"><Megaphone /> Connect source</Button>} /><div className="grid gap-4 md:grid-cols-2">{(data.sources??[]).map((source)=><Panel key={source.type}><div className="flex items-start justify-between"><span className="grid size-10 place-items-center rounded-xl bg-white/5"><Database className="size-4 text-amber-200" /></span><Status value={source.status} /></div><h2 className="mt-5 text-sm font-semibold">{source.name}</h2><p className="mt-2 text-xs leading-5 text-white/35">{source.type==='website_form'?'Embed the Vaani popup or send your existing form to the public form endpoint.':'OAuth/API connection with consent fields and campaign attribution.'}</p><Button variant="outline" className="mt-5 w-full border-white/10 bg-transparent">Configure</Button></Panel>)}</div><Panel><PanelTitle title="Website form integration" note="Drop-in endpoint for any form builder" /><pre className="mt-4 overflow-x-auto rounded-xl border border-white/7 bg-black/25 p-4 font-mono text-[10px] leading-5 text-cyan-100/75">{`POST /api/forms/form_urbannest/leads\nContent-Type: application/json\n\n{\n  "name": "Aarav Khanna",\n  "phone": "+919876544210",\n  "email": "aarav@example.com",\n  "productInterest": "3BHK property"\n}`}</pre></Panel></div>;
}

function Retargeting() {
  return <div className="space-y-6"><Header eyebrow="Revenue recovery" title="Consent-aware retargeting audiences" description="Call outcomes continuously refresh Meta and Google audience segments without revealing conversation transcripts." action={<Button className="bg-amber-300 text-[#17120a] hover:bg-amber-200"><Repeat2 /> Build audience</Button>} /><div className="grid gap-4 lg:grid-cols-3">{[['Hot · no booking','High-intent callers who did not choose a slot','218','Meta + Google'],['No answer · 3 attempts','Consent-valid leads who missed all calls','1,042','Google'],['Price objection','Qualified leads needing offer education','386','Meta']].map(([name,note,size,destination])=><Panel key={name}><div className="flex items-center justify-between"><Target className="size-4 text-amber-200" /><Status value="syncing" /></div><h2 className="mt-5 text-sm font-semibold">{name}</h2><p className="mt-2 min-h-10 text-xs leading-5 text-white/35">{note}</p><div className="mt-5 flex items-end justify-between border-t border-white/7 pt-4"><div><p className="text-xl font-semibold">{size}</p><p className="text-[9px] text-white/28">eligible contacts</p></div><Badge variant="outline" className="border-white/8 text-[9px] text-white/38">{destination}</Badge></div></Panel>)}</div><Panel><PanelTitle title="Always-on audience loop" note="Outcome → eligibility → sync → suppression" /><div className="mt-5 flex flex-col items-stretch gap-2 md:flex-row md:items-center">{['Call outcome','Consent check','Segment rule','Hashed audience sync','CRM suppression'].map((item,index)=><div key={item} className="contents"><div className="flex-1 rounded-xl border border-white/8 bg-white/[0.02] p-4 text-center text-xs">{item}</div>{index<4?<span className="text-center text-white/20">→</span>:null}</div>)}</div></Panel></div>;
}

function Team() { return <SimpleModule eyebrow="Workspace access" title="Team and permissions" description="Invite owners, sales managers and agents with least-privilege roles." cards={[['Owner','Full customer workspace','1 member'],['Sales manager','CRM, campaigns and analytics','2 members'],['Agent','Assigned leads and tasks only','4 members']]} />; }
function SimpleModule({eyebrow,title,description,cards}:{eyebrow:string;title:string;description:string;cards:string[][]}) { return <div className="space-y-6"><Header eyebrow={eyebrow} title={title} description={description} /> <div className="grid gap-4 md:grid-cols-2">{cards.map(([name,note,status])=><Panel key={name}><h2 className="text-sm font-semibold">{name}</h2><p className="mt-2 text-xs text-white/35">{note}</p><div className="mt-5"><Status value={status} /></div></Panel>)}</div></div>; }

function Header({eyebrow,title,description,action}:{eyebrow:string;title:string;description:string;action?:React.ReactNode}) { return <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300/80">{eyebrow}</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1><p className="mt-2 max-w-3xl text-xs leading-5 text-white/38 sm:text-sm">{description}</p></div>{action}</div>; }
function Metric({label,value,note,icon:Icon}:{label:string;value:string;note:string;icon:typeof Gauge}) { return <div className="rounded-2xl border border-white/8 bg-[#0e1119] p-4"><div className="flex items-center justify-between"><p className="text-[10px] uppercase tracking-[0.12em] text-white/28">{label}</p><Icon className="size-4 text-amber-300/65" /></div><p className="mt-4 text-2xl font-semibold">{value}</p><p className="mt-1 text-[10px] text-white/30">{note}</p></div>; }
function Panel({children,className=''}:{children:React.ReactNode;className?:string}) { return <section className={`rounded-2xl border border-white/8 bg-[#0e1119] p-5 ${className}`}>{children}</section>; }
function PanelTitle({title,note}:{title:string;note:string}) { return <div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-[10px] text-white/32">{note}</p></div>; }
function Status({value}:{value:string}) { const normalized=value.toLowerCase(); const positive=['active','approved','connected','paid','verified','live'].some((item)=>normalized.includes(item)); const warning=['pending','ready','sync','scheduled','required'].some((item)=>normalized.includes(item)); return <span className={`inline-flex rounded-full border px-2 py-1 text-[9px] capitalize ${positive?'border-emerald-400/15 bg-emerald-400/7 text-emerald-300':warning?'border-amber-300/15 bg-amber-300/7 text-amber-200':'border-white/10 bg-white/5 text-white/45'}`}>{value.replaceAll('_',' ')}</span>; }
function Loading() { return <div className="grid min-h-[60vh] place-items-center"><div className="text-center"><Loader2 className="mx-auto size-6 animate-spin text-amber-300" /><p className="mt-3 text-xs text-white/35">Loading your revenue workspace…</p></div></div>; }
function ErrorState({error,retry}:{error:string;retry:()=>void}) { return <div className="mx-auto mt-20 max-w-md rounded-2xl border border-red-400/15 bg-red-400/5 p-6 text-center"><p className="text-sm text-red-100">{error}</p><Button onClick={retry} variant="outline" className="mt-4 border-white/10 bg-transparent"><RefreshCcw /> Retry</Button></div>; }
function num(value: unknown) { return Number(value ?? 0).toLocaleString('en-IN'); }
function money(value: unknown) { return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Number(value ?? 0)); }
