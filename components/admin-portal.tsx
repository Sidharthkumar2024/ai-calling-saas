'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
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
  PhoneCall,
  Radio,
  RefreshCcw,
  ServerCog,
  SlidersHorizontal,
  ShieldCheck,
  UsersRound,
  Webhook,
} from 'lucide-react';

import { PortalShell, type PortalNavGroup } from '@/components/portal-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

type AdminSession = { name: string; email: string };

type AdminPayload = {
  stats?: Record<string, number>;
  revenue?: Record<string, number>;
  customers?: Record<string, unknown>[];
  plans?: Record<string, unknown>[];
  numbers?: Record<string, unknown>[];
  audits?: Record<string, unknown>[];
  integrations?: Record<string, unknown>[];
  commerce?: Record<string, unknown>[];
  system?: Record<string, string>;
  authProviders?: Record<string, unknown>[];
  platformProviders?: Record<string, unknown>[];
  tickets?: Record<string, unknown>[];
  ticketMessages?: Record<string, unknown>[];
};

const groups: PortalNavGroup[] = [
  {
    label: 'Platform',
    items: [
      { id: 'overview', label: 'Command center', icon: Gauge },
      { id: 'customers', label: 'Customers', icon: Building2 },
      { id: 'call_ops', label: 'Call operations', icon: Radio, badge: '12 live' },
      { id: 'voice_engines', label: 'Voice engines', icon: Activity },
    ],
  },
  {
    label: 'Commercial',
    items: [
      { id: 'numbers_kyc', label: 'Numbers & KYC', icon: FileCheck2 },
      { id: 'plans_billing', label: 'Plans & billing', icon: CreditCard },
      { id: 'trials_commerce', label: 'Trials & commerce', icon: CircleDollarSign, badge: 'New' },
      { id: 'integrations', label: 'API & integrations', icon: Network },
      { id: 'platform_apis', label: 'Provider & auth config', icon: SlidersHorizontal },
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

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [response, platformResponse] = await Promise.all([
        fetch('/api/admin/overview', { cache: 'no-store' }),
        fetch('/api/admin/platform', { cache: 'no-store' }),
      ]);
      if (response.status === 401 || response.status === 403 || platformResponse.status === 401 || platformResponse.status === 403) {
        window.location.assign('/admin/login');
        return;
      }
      const payload = (await response.json()) as AdminPayload & { error?: string };
      const platform = (await platformResponse.json()) as AdminPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Unable to load admin data.');
      if (!platformResponse.ok) throw new Error(platform.error || 'Unable to load platform configuration.');
      setData({ ...payload, ...platform });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load admin data.');
    } finally {
      setLoading(false);
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
        {loading ? <LoadingState /> : error ? <ErrorState error={error} retry={load} /> : null}
        {!loading && !error && active === 'overview' ? <AdminOverview data={data} /> : null}
        {!loading && !error && active === 'customers' ? <Customers data={data} /> : null}
        {!loading && !error && active === 'call_ops' ? <CallOperations /> : null}
        {!loading && !error && active === 'voice_engines' ? <VoiceEngines /> : null}
        {!loading && !error && active === 'numbers_kyc' ? <NumbersKyc data={data} /> : null}
        {!loading && !error && active === 'plans_billing' ? <PlansBilling data={data} /> : null}
        {!loading && !error && active === 'trials_commerce' ? <TrialsCommerce data={data} /> : null}
        {!loading && !error && active === 'integrations' ? <Integrations data={data} /> : null}
        {!loading && !error && active === 'platform_apis' ? <PlatformApis data={data} onChanged={load} /> : null}
        {!loading && !error && active === 'system_audit' ? <SystemAudit data={data} /> : null}
        {!loading && !error && active === 'support_tickets' ? <SupportDesk data={data} onChanged={load} /> : null}
      </div>
    </PortalShell>
  );
}

function AdminOverview({ data }: { data: AdminPayload }) {
  const stats = data.stats ?? {};
  const revenue = data.revenue ?? {};
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Platform command center"
        title="Everything that keeps Vaani running"
        description="Tenant activity, revenue, calling capacity and compliance signals in one operator view."
        action={<Button className="bg-amber-300 text-[#17120a] hover:bg-amber-200"><RefreshCcw /> Refresh health</Button>}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Active customers" value={num(stats.customers)} note={`${num(stats.users)} active users`} icon={Building2} />
        <Stat label="Platform calls" value={num(stats.calls)} note={`${num(stats.leads)} CRM leads`} icon={PhoneCall} />
        <Stat label="Collected revenue" value={money(revenue.total)} note={`${num(revenue.paid_invoices)} paid invoices`} icon={CircleDollarSign} />
        <Stat label="Active numbers" value={num(stats.active_numbers)} note={`${num(stats.pending_kyc)} pending KYC`} icon={FileCheck2} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <Panel>
          <PanelHeader title="Network activity" description="Calls and quality signals · last 24 hours" />
          <div className="grid min-h-[260px] grid-cols-12 items-end gap-2 pt-7">
            {[28, 34, 26, 42, 56, 49, 68, 73, 62, 82, 76, 91].map((height, index) => (
              <div key={index} className="group flex h-full items-end">
                <div className="w-full rounded-t bg-gradient-to-t from-amber-300/18 to-amber-300/75 transition group-hover:to-amber-200" style={{ height: `${height}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-between text-[9px] text-white/25"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>Now</span></div>
        </Panel>
        <Panel>
          <PanelHeader title="Service health" description="Provider details stay private" />
          <div className="mt-5 space-y-4">
            {[
              ['Voice gateway', 'Operational', 99],
              ['AI orchestration', 'Operational', 98],
              ['Telephony routes', 'Operational', 97],
              ['Event delivery', 'Operational', 100],
            ].map(([label, status, progress]) => (
              <div key={String(label)}>
                <div className="mb-2 flex items-center justify-between text-xs"><span className="text-white/68">{label}</span><span className="text-emerald-300">{status}</span></div>
                <Progress value={Number(progress)} className="h-1 bg-white/6" />
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-xl border border-white/8 bg-white/[0.025] p-4">
            <p className="text-[10px] uppercase tracking-[0.16em] text-white/30">P95 conversation latency</p>
            <p className="mt-2 text-2xl font-semibold">1.2s</p>
            <p className="mt-1 text-[10px] text-emerald-300">Within 1.5s target</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <CustomersTable rows={(data.customers ?? []).slice(0, 6)} />
        <Panel>
          <PanelHeader title="Operator queue" description="Items needing platform attention" />
          <div className="mt-3 divide-y divide-white/7">
            {[
              ['KYC review', `${num(stats.pending_kyc)} number requests`, 'Review'],
              ['Open invoices', `${num(revenue.open_invoices)} payment items`, 'Inspect'],
              ['Webhook health', `${num(stats.webhooks)} active endpoints`, 'Monitor'],
              ['Capacity', '38 of 120 channels reserved', 'Healthy'],
            ].map(([title, note, action]) => (
              <div key={title} className="flex items-center gap-3 py-4">
                <span className="grid size-9 place-items-center rounded-xl bg-white/5"><Clock3 className="size-4 text-white/45" /></span>
                <div className="min-w-0 flex-1"><p className="text-xs font-medium">{title}</p><p className="mt-1 text-[10px] text-white/35">{note}</p></div>
                <Button variant="outline" size="sm" className="border-white/10 bg-transparent text-[10px]">{action}</Button>
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
      <SectionHeader eyebrow="Tenant management" title="Customer accounts" description="Plan, wallet, numbers and lead volume stay scoped to each organization." action={<Button className="bg-amber-300 text-[#17120a] hover:bg-amber-200"><UsersRound /> Invite customer</Button>} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Organizations" value={num(data.stats?.customers)} note="Active tenants" icon={Building2} />
        <Stat label="Customer users" value={num(data.stats?.users)} note="Owners and agents" icon={UsersRound} />
        <Stat label="CRM records" value={num(data.stats?.leads)} note="Tenant-isolated" icon={BarChart3} />
      </div>
      <CustomersTable rows={data.customers ?? []} />
    </div>
  );
}

function CustomersTable({ rows }: { rows: Record<string, unknown>[] }) {
  return (
    <Panel className="overflow-hidden">
      <PanelHeader title="Customers" description="Current plan, credits and activity" />
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="border-y border-white/8 text-[9px] uppercase tracking-[0.13em] text-white/28">
            <tr><th className="px-3 py-3 font-medium">Organization</th><th className="px-3 py-3 font-medium">Plan</th><th className="px-3 py-3 font-medium">Credits</th><th className="px-3 py-3 font-medium">Leads</th><th className="px-3 py-3 font-medium">Numbers</th><th className="px-3 py-3 font-medium">Status</th></tr>
          </thead>
          <tbody className="divide-y divide-white/7">
            {rows.map((row) => (
              <tr key={String(row.id)} className="hover:bg-white/[0.025]">
                <td className="px-3 py-4"><p className="font-medium">{textValue(row.name)}</p><p className="mt-1 text-[10px] text-white/32">{textValue(row.owner_email, 'No owner')}</p></td>
                <td className="px-3 py-4 text-white/60">{textValue(row.plan_name, 'Free')}</td>
                <td className="px-3 py-4 font-mono text-amber-200">{num(row.balance)}</td>
                <td className="px-3 py-4 text-white/60">{num(row.leads)}</td>
                <td className="px-3 py-4 text-white/60">{num(row.numbers)}</td>
                <td className="px-3 py-4"><Status value={textValue(row.status, 'active')} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function CallOperations() {
  const live = [
    ['UrbanNest Realty', 'Maya · Sales', '+91 98••• 4210', 'Site visit', '03:12', '1.1s'],
    ['Northwind Services', 'Meera · Support', '+91 99••• 8184', 'Price objection', '02:08', '1.3s'],
    ['Apex Education', 'Arjun · Admissions', '+91 97••• 3309', 'Course enquiry', '01:44', '0.9s'],
    ['BrightSmile Dental', 'Maya · Reception', '+91 88••• 7062', 'Human transfer', '04:26', '1.4s'],
  ];
  return (
    <div className="space-y-6">
      <SectionHeader eyebrow="Realtime operations" title="Platform call monitor" description="Observe tenant capacity, latency and failure signals without exposing conversation content across tenants." action={<Button className="bg-amber-300 text-[#17120a] hover:bg-amber-200"><Radio /> Open live monitor</Button>} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Live calls" value="12" note="of 120 channels" icon={Radio} />
        <Stat label="Queued jobs" value="38" note="p95 wait 4.2s" icon={Clock3} />
        <Stat label="P95 latency" value="1.2s" note="target < 1.5s" icon={Activity} />
        <Stat label="Success rate" value="98.4%" note="last 24 hours" icon={CheckCircle2} />
      </div>
      <Panel className="overflow-hidden">
        <PanelHeader title="Live conversations" description="PII masked at platform level" />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-xs"><thead className="border-y border-white/8 text-[9px] uppercase tracking-[0.13em] text-white/28"><tr>{['Customer','Agent','Caller','Intent','Duration','Latency'].map((item)=><th key={item} className="px-3 py-3 font-medium">{item}</th>)}</tr></thead><tbody className="divide-y divide-white/7">{live.map((row)=><tr key={row[2]}>{row.map((cell,index)=><td key={cell} className={`px-3 py-4 ${index===0?'font-medium':'text-white/55'}`}>{index===4?<span className="inline-flex items-center gap-2"><span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />{cell}</span>:cell}</td>)}</tr>)}</tbody></table>
        </div>
      </Panel>
    </div>
  );
}

function VoiceEngines() {
  const engines = [
    ['Vaani Voice', 'Speech generation', 'Operational', '12 languages', '183ms'],
    ['Vaani Sense', 'Understanding & scoring', 'Operational', '24 models', '94ms'],
    ['Vaani Flow', 'Workflow orchestration', 'Operational', '38 tenants', '31ms'],
    ['Vaani Connect', 'Telephony routing', 'Operational', '6 regions', '82ms'],
  ];
  return (
    <div className="space-y-6">
      <SectionHeader eyebrow="Private engine layer" title="Vaani engine control" description="Provider credentials and vendor names live only in secure backend configuration—not in customer-facing screens." />
      <div className="grid gap-4 md:grid-cols-2">
        {engines.map(([name,purpose,status,capacity,latency])=><Panel key={name}><div className="flex items-start justify-between"><span className="grid size-10 place-items-center rounded-xl bg-amber-300/10"><ServerCog className="size-4 text-amber-200" /></span><Status value={status} /></div><h3 className="mt-5 text-base font-semibold">{name}</h3><p className="mt-1 text-xs text-white/38">{purpose}</p><div className="mt-6 grid grid-cols-2 gap-3"><div className="rounded-xl bg-white/[0.03] p-3"><p className="text-[9px] uppercase tracking-wider text-white/25">Capacity</p><p className="mt-2 text-sm">{capacity}</p></div><div className="rounded-xl bg-white/[0.03] p-3"><p className="text-[9px] uppercase tracking-wider text-white/25">P95</p><p className="mt-2 text-sm">{latency}</p></div></div></Panel>)}
      </div>
    </div>
  );
}

function NumbersKyc({ data }: { data: AdminPayload }) {
  return (
    <div className="space-y-6">
      <SectionHeader eyebrow="Telephony governance" title="Numbers, ownership and KYC" description="Platform-rented and customer-connected numbers follow the same ownership, use-case and test-call gates." />
      <div className="grid gap-3 sm:grid-cols-3"><Stat label="Active numbers" value={num(data.stats?.active_numbers)} note="Dedicated assignments" icon={PhoneCall} /><Stat label="Pending KYC" value={num(data.stats?.pending_kyc)} note="Needs review" icon={FileCheck2} /><Stat label="Provider routes" value="6" note="Hidden behind Vaani Connect" icon={Network} /></div>
      <Panel className="overflow-hidden"><PanelHeader title="Number inventory" description="One organization per dedicated caller identity" /><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="border-y border-white/8 text-[9px] uppercase tracking-[0.13em] text-white/28"><tr>{['Number','Customer','Model','Public route','KYC','Status'].map((h)=><th key={h} className="px-3 py-3 font-medium">{h}</th>)}</tr></thead><tbody className="divide-y divide-white/7">{(data.numbers??[]).map((row)=><tr key={String(row.id)}><td className="px-3 py-4 font-mono">{String(row.phone_number)}</td><td className="px-3 py-4 text-white/62">{String(row.organization_name)}</td><td className="px-3 py-4 text-white/48">{String(row.acquisition_type).replaceAll('_',' ')}</td><td className="px-3 py-4 text-white/48">{String(row.public_provider_name)}</td><td className="px-3 py-4"><Status value={String(row.kyc_status)} /></td><td className="px-3 py-4"><Status value={String(row.status)} /></td></tr>)}</tbody></table></div></Panel>
    </div>
  );
}

function PlansBilling({ data }: { data: AdminPayload }) {
  return (
    <div className="space-y-6">
      <SectionHeader eyebrow="Commercial control" title="Plans, credits and invoices" description="Plan limits are controlled centrally while every wallet change remains traceable in the immutable ledger." action={<Button className="bg-amber-300 text-[#17120a] hover:bg-amber-200"><Coins /> New credit package</Button>} />
      <div className="grid gap-4 lg:grid-cols-3">{(data.plans??[]).map((plan)=><Panel key={String(plan.id)}><div className="flex items-center justify-between"><Badge variant="outline" className="border-white/10 text-white/45">{String(plan.code)}</Badge><Status value={String(plan.status)} /></div><h3 className="mt-5 text-xl font-semibold">{String(plan.name)}</h3><p className="mt-2 text-3xl font-semibold">{money(plan.monthly_price)}<span className="text-xs font-normal text-white/35"> / month</span></p><div className="mt-5 space-y-2 text-xs text-white/52"><p>{num(plan.included_credits)} included credits</p><p>{num(plan.max_agents)} agents · {num(plan.max_numbers)} numbers</p><p>{num(plan.concurrency)} concurrent calls</p></div><Button variant="outline" className="mt-6 w-full border-white/10 bg-transparent">Edit plan</Button></Panel>)}</div>
      <div className="grid gap-3 sm:grid-cols-3"><Stat label="Revenue collected" value={money(data.revenue?.total)} note="GST-inclusive invoices" icon={CircleDollarSign} /><Stat label="Paid invoices" value={num(data.revenue?.paid_invoices)} note="Webhook-confirmed" icon={CheckCircle2} /><Stat label="Open invoices" value={num(data.revenue?.open_invoices)} note="Requires follow-up" icon={CreditCard} /></div>
    </div>
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
        <Stat label="Trial workspaces" value={num(stats.trials)} note="100 credits · 10 per test turn" icon={Coins} />
        <Stat label="Voice agents" value={num(stats.voice_agents)} note="Draft and active" icon={Activity} />
        <Stat label="Agent tests" value={num(stats.agent_tests)} note="Text and browser voice" icon={PhoneCall} />
        <Stat label="Commerce collected" value={money(collected)} note={`${num(stats.payment_links)} payment links`} icon={CircleDollarSign} />
      </div>
      <Panel className="overflow-hidden">
        <PanelHeader title="Recent payment-link activity" description="Instant and scheduled WhatsApp delivery with webhook-confirmed status" />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-xs">
            <thead className="border-y border-white/8 text-[9px] uppercase tracking-[0.13em] text-white/28">
              <tr>{['Reference','Workspace','Customer','Amount','Delivery','Provider','Status','Created'].map((heading)=><th key={heading} className="px-3 py-3 font-medium">{heading}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-white/7">
              {rows.map((row)=><tr key={textValue(row.id)}>
                <td className="px-3 py-4 font-mono text-amber-200">{textValue(row.reference_id)}</td>
                <td className="px-3 py-4 text-white/62">{textValue(row.organization_name)}</td>
                <td className="px-3 py-4 text-white/62">{textValue(row.customer_name)}</td>
                <td className="px-3 py-4">{money(row.amount)}</td>
                <td className="px-3 py-4 text-white/48">{textValue(row.delivery_mode).replaceAll('_',' ')}</td>
                <td className="px-3 py-4 text-white/48">{textValue(row.provider).replaceAll('_',' ')}</td>
                <td className="px-3 py-4"><Status value={textValue(row.status)} /></td>
                <td className="px-3 py-4 text-[10px] text-white/32">{formatDate(row.created_at)}</td>
              </tr>)}
            </tbody>
          </table>
          {rows.length === 0 ? <p className="py-10 text-center text-xs text-white/30">No payment links yet.</p> : null}
        </div>
      </Panel>
    </div>
  );
}

function Integrations({ data }: { data: AdminPayload }) {
  return (
    <div className="space-y-6">
      <SectionHeader eyebrow="Integration control plane" title="API, webhooks and provider adapters" description="Customers see Vaani products; raw infrastructure credentials remain encrypted and admin-only." />
      <div className="grid gap-4 lg:grid-cols-2">{(data.integrations??[]).map((item)=><Panel key={`${textValue(item.type)}-${textValue(item.status)}`}><div className="flex items-start gap-4"><span className="grid size-10 place-items-center rounded-xl bg-violet-400/10"><Webhook className="size-4 text-violet-200" /></span><div className="flex-1"><p className="text-sm font-medium">{textValue(item.name)}</p><p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-white/28">{textValue(item.type).replaceAll('_',' ')}</p></div><Status value={textValue(item.status)} /></div><div className="mt-5 flex items-center justify-between rounded-xl bg-white/[0.025] p-3 text-xs"><span className="text-white/35">Connected tenants</span><span>{num(item.tenants)}</span></div></Panel>)}</div>
      <Panel><PanelHeader title="Public API controls" description="Hash-only keys, scoped permissions and webhook signatures" /><div className="mt-5 grid gap-3 sm:grid-cols-3">{[['API keys','SHA-256 hashes',KeyRound],['Secrets','AES-GCM at rest',ShieldCheck],['Webhooks','HMAC SHA-256',Webhook]].map(([title,note,Icon])=><div key={String(title)} className="rounded-xl border border-white/8 bg-white/[0.02] p-4"><Icon className="size-4 text-amber-200" /><p className="mt-4 text-xs font-medium">{String(title)}</p><p className="mt-1 text-[10px] text-white/32">{String(note)}</p></div>)}</div></Panel>
    </div>
  );
}

function PlatformApis({ data, onChanged }: { data: AdminPayload; onChanged: () => Promise<void> | void }) {
  const [busy, setBusy] = useState('');
  async function patch(payload: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const response = await fetch('/api/admin/platform', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Unable to update platform setting.');
      await onChanged();
    } finally { setBusy(''); }
  }
  return <div className="space-y-6"><SectionHeader eyebrow="Admin-only configuration" title="Identity, APIs and cloud requirements" description="Customer screens use Vaani product names. Provider credentials, readiness and health remain inside this operator console." />
    <Panel><PanelHeader title="Customer sign-in providers" description="Google is visible but inactive until credentials and callback verification are complete." /><div className="mt-4 grid gap-3 md:grid-cols-2">{(data.authProviders ?? []).map((provider) => { const visible = Boolean(provider.button_visible); return <div key={textValue(provider.provider)} className="rounded-xl border border-white/8 bg-white/[0.02] p-4"><div className="flex items-center justify-between"><div><p className="text-sm font-medium">{textValue(provider.display_name)}</p><p className="mt-1 text-[9px] text-white/30">{textValue(provider.status).replaceAll('_',' ')}</p></div><Status value={visible ? 'button visible' : 'hidden'} /></div><Button variant="outline" disabled={busy === textValue(provider.provider)} onClick={() => patch({ action: 'auth_visibility', provider: provider.provider, buttonVisible: !visible }, textValue(provider.provider))} className="mt-4 w-full border-white/10 bg-transparent text-[10px]">{busy === textValue(provider.provider) ? <Loader2 className="animate-spin" /> : <SlidersHorizontal />}{visible ? 'Hide button' : 'Show button'}</Button></div>; })}</div></Panel>
    <div className="grid gap-4 lg:grid-cols-2">{(data.platformProviders ?? []).map((provider) => { const required = safeList(provider.required_credentials_json); return <Panel key={textValue(provider.id)}><div className="flex items-start justify-between"><span className="grid size-10 place-items-center rounded-xl bg-violet-400/10"><ServerCog className="size-4 text-violet-200" /></span><Status value={textValue(provider.health)} /></div><h2 className="mt-5 text-sm font-semibold">{textValue(provider.public_name)}</h2><p className="mt-1 text-[9px] uppercase tracking-wider text-white/25">{textValue(provider.category)}</p><p className="mt-3 text-xs leading-5 text-white/38">{textValue(provider.usage_note)}</p><div className="mt-4 rounded-xl border border-white/7 bg-black/20 p-3"><p className="text-[8px] uppercase tracking-wider text-white/25">Required environment secrets</p><div className="mt-2 flex flex-wrap gap-1.5">{required.map((item) => <code key={item} className="rounded bg-white/5 px-2 py-1 text-[8px] text-cyan-100/70">{item}</code>)}</div></div></Panel>; })}</div>
  </div>;
}

function SupportDesk({ data, onChanged }: { data: AdminPayload; onChanged: () => Promise<void> | void }) {
  const [busy, setBusy] = useState('');
  async function act(ticketId: string, action: 'ticket_reply'|'ticket_status') {
    setBusy(ticketId);
    try {
      const payload = action === 'ticket_reply' ? { action, ticketId, message: 'We have received the issue and are reviewing the workspace logs. We will update this ticket with the next action.' } : { action, ticketId, status: 'resolved' };
      const response = await fetch('/api/admin/platform', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error('Unable to update ticket.');
      await onChanged();
    } finally { setBusy(''); }
  }
  return <div className="space-y-6"><SectionHeader eyebrow="Tenant support" title="Support desk" description="Customer tickets, platform replies, assignment and resolution status in one admin queue." /><div className="grid gap-4 lg:grid-cols-2">{(data.tickets ?? []).map((ticket) => { const messages = (data.ticketMessages ?? []).filter((item) => item.ticket_id === ticket.id); return <Panel key={textValue(ticket.id)}><div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold">{textValue(ticket.subject)}</h2><p className="mt-1 text-[9px] text-white/30">{textValue(ticket.organization_name)} · {textValue(ticket.creator_email)}</p></div><Status value={textValue(ticket.status)} /></div><div className="mt-4 space-y-2">{messages.map((message) => <div key={textValue(message.id)} className={`rounded-xl border p-3 text-[10px] leading-5 ${message.sender_role === 'admin' ? 'border-violet-300/10 bg-violet-300/[0.035]' : 'border-white/7 bg-white/[0.02]'}`}><p className="mb-1 text-[8px] uppercase tracking-wider text-white/25">{textValue(message.sender_name)} · {textValue(message.sender_role)}</p>{textValue(message.message)}</div>)}</div><div className="mt-4 flex gap-2"><Button variant="outline" disabled={busy === textValue(ticket.id)} onClick={() => act(textValue(ticket.id), 'ticket_reply')} className="flex-1 border-white/10 bg-transparent text-[9px]">Reply</Button><Button disabled={busy === textValue(ticket.id)} onClick={() => act(textValue(ticket.id), 'ticket_status')} className="flex-1 bg-emerald-300 text-[#07120d] hover:bg-emerald-200">Resolve</Button></div></Panel>; })}</div></div>;
}

function SystemAudit({ data }: { data: AdminPayload }) {
  return (
    <div className="space-y-6">
      <SectionHeader eyebrow="Security & reliability" title="System health and audit trail" description="Every sensitive mutation is attributable, tenant-scoped and designed for incident review." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Object.entries(data.system??{}).slice(0,4).map(([key,value])=><Stat key={key} label={key.replaceAll('_',' ')} value={value} note="Live platform check" icon={ServerCog} />)}</div>
      <Panel className="overflow-hidden"><PanelHeader title="Recent audit events" description="Security-relevant changes across customer workspaces" /><div className="mt-4 divide-y divide-white/7">{(data.audits??[]).map((row,index)=><div key={`${textValue(row.action)}-${index}`} className="flex items-start gap-3 py-4"><span className="mt-0.5 grid size-8 place-items-center rounded-lg bg-white/5"><ShieldCheck className="size-3.5 text-white/42" /></span><div className="min-w-0 flex-1"><p className="text-xs font-medium">{textValue(row.action).replaceAll('.',' · ')}</p><p className="mt-1 text-[10px] text-white/32">{textValue(row.actor_name, 'System')} · {textValue(row.organization_name, 'Platform')} · {textValue(row.target_type)}</p></div><span className="text-[9px] text-white/25">{formatDate(row.created_at)}</span></div>)}</div></Panel>
    </div>
  );
}

function SectionHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300/80">{eyebrow}</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1><p className="mt-2 max-w-3xl text-xs leading-5 text-white/38 sm:text-sm">{description}</p></div>{action}</div>;
}

function Stat({ label, value, note, icon: Icon }: { label: string; value: unknown; note: string; icon: typeof Activity }) {
  return <div className="rounded-2xl border border-white/8 bg-[#0e1119] p-4 shadow-lg shadow-black/8"><div className="flex items-center justify-between"><p className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/30">{label}</p><Icon className="size-4 text-amber-300/65" /></div><p className="mt-4 text-2xl font-semibold tracking-tight">{String(value)}</p><p className="mt-1 text-[10px] text-white/30">{note}</p></div>;
}

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-white/8 bg-[#0e1119] p-5 shadow-lg shadow-black/8 ${className}`}>{children}</section>;
}

function PanelHeader({ title, description }: { title: string; description: string }) {
  return <div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-[10px] text-white/32">{description}</p></div>;
}

function Status({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const positive = ['active','approved','operational','connected','paid'].some((item)=>normalized.includes(item));
  const warning = ['pending','review','required','test'].some((item)=>normalized.includes(item));
  return <span className={`inline-flex rounded-full border px-2 py-1 text-[9px] capitalize ${positive?'border-emerald-400/15 bg-emerald-400/7 text-emerald-300':warning?'border-amber-300/15 bg-amber-300/7 text-amber-200':'border-white/10 bg-white/5 text-white/45'}`}>{value.replaceAll('_',' ')}</span>;
}

function LoadingState() { return <div className="grid min-h-[60vh] place-items-center"><div className="text-center"><Loader2 className="mx-auto size-6 animate-spin text-amber-300" /><p className="mt-3 text-xs text-white/35">Loading platform control plane…</p></div></div>; }
function ErrorState({ error, retry }: { error: string; retry: () => void }) { return <div className="mx-auto mt-20 max-w-md rounded-2xl border border-red-400/15 bg-red-400/5 p-6 text-center"><p className="text-sm text-red-100">{error}</p><Button onClick={retry} variant="outline" className="mt-4 border-white/10 bg-transparent"><RefreshCcw /> Retry</Button></div>; }
function num(value: unknown) { return Number(value ?? 0).toLocaleString('en-IN'); }
function money(value: unknown) { return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Number(value??0)/100); }
function formatDate(value: unknown) { const date = new Date(String(value)); return Number.isNaN(date.valueOf())?'—':date.toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}); }
function textValue(value: unknown, fallback = '—') { return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback; }
function safeList(value: unknown) { try { const parsed = JSON.parse(textValue(value, '[]')); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } }
