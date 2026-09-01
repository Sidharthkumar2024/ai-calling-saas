'use client';
/* oxlint-disable jsx-a11y/media-has-caption -- call transcripts and QA summaries are available beside authenticated recordings */

import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, BookOpenText, Bot, Cable, CheckCircle2, FileAudio, FileBarChart2, GitBranch, Headphones, Loader2, Network, PhoneCall, Plus, Radio, RefreshCcw, ShieldCheck, Workflow } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ActivityAreaChart, DistributionChart } from '@/components/analytics-charts';
import { CustomerSecurity } from '@/components/customer-security';

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
  settings?: Record<string, unknown> | null;
  stats?: Record<string, unknown> | null;
  compliance?: { consents: Record<string, unknown>[]; suppressions: Record<string, unknown>[]; kycDocuments: Record<string, unknown>[] };
};

export type OperationsModule = 'campaigns' | 'sip_trunks' | 'knowledge' | 'workflows' | 'graph_agents' | 'call_history' | 'live_monitor' | 'analytics' | 'quality' | 'alerts' | 'reports' | 'settings';

export function CustomerOperations({ module, data, onChanged }: { module: OperationsModule; data: OperationsData; onChanged: () => Promise<void> | void }) {
  if (module === 'call_history') return <CallHistory data={data} />;
  if (module === 'live_monitor') return <LiveMonitor data={data} />;
  if (module === 'analytics') return <Analytics data={data} />;
  if (module === 'quality') return <Quality data={data} />;
  if (module === 'settings') return <WorkspaceSettings data={data} onChanged={onChanged} />;
  return <ResourceModule module={module} data={data} onChanged={onChanged} />;
}

const resourceMap = {
  campaigns: { eyebrow: 'Outbound execution', title: 'Campaigns', description: 'Audience, consent, retry policy, calling windows and conversion outcomes.', key: 'campaigns', action: 'create_campaign', button: 'New campaign', icon: Radio },
  sip_trunks: { eyebrow: 'Custom telephony', title: 'SIP trunks', description: 'Bring your own telephony with TLS, media encryption, codec checks and test-gated activation.', key: 'sipTrunks', action: 'create_sip_trunk', button: 'Register trunk', icon: Cable },
  knowledge: { eyebrow: 'Grounded answers', title: 'Knowledge bases', description: 'Product facts, FAQs and objection handling used during conversations and QA.', key: 'knowledgeBases', action: 'create_knowledge_base', button: 'New knowledge base', icon: BookOpenText },
  workflows: { eyebrow: 'Durable automation', title: 'Workflows', description: 'Trigger approved CRM, WhatsApp, payment, calendar and retargeting actions from call outcomes.', key: 'workflows', action: 'create_workflow', button: 'New workflow', icon: Workflow },
  graph_agents: { eyebrow: 'Conversation orchestration', title: 'Graph agents', description: 'Branching conversation nodes, tool execution, guardrails and warm transfer routes.', key: 'graphAgents', action: 'create_graph_agent', button: 'New graph', icon: GitBranch },
  alerts: { eyebrow: 'Operational guardrails', title: 'Alerts', description: 'Watch failure rate, latency, QA score and balance thresholds through email and signed webhooks.', key: 'alertRules', action: 'create_alert', button: 'New alert', icon: AlertTriangle },
  reports: { eyebrow: 'Scheduled intelligence', title: 'Reports', description: 'Reusable call, campaign, QA and revenue reports with saved filters and schedules.', key: 'reports', action: 'create_report', button: 'New report', icon: FileBarChart2 },
} as const;

function ResourceModule({ module, data, onChanged }: { module: Exclude<OperationsModule, 'call_history'|'live_monitor'|'analytics'|'quality'|'settings'>; data: OperationsData; onChanged: () => Promise<void> | void }) {
  const config = resourceMap[module];
  const Icon = config.icon;
  const rows = data[config.key] as Record<string, unknown>[];
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');

  async function create() {
    setLoading('create'); setError('');
    const timestamp = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const payload: Record<string, unknown> = { action: config.action, name: `${config.title.replace(/s$/, '')} ${timestamp}` };
    if (module === 'sip_trunks') Object.assign(payload, { gatewayUri: 'sip:gateway.example.com:5061', transport: 'tls', mediaEncryption: 'sdes' });
    if (module === 'campaigns') Object.assign(payload, { audienceSize: 250, concurrency: 5 });
    if (module === 'knowledge') Object.assign(payload, { description: 'Approved product and support content', language: 'Hindi + English + Haryanvi' });
    if (module === 'workflows') Object.assign(payload, { triggerType: 'call.completed', steps: ['check_consent','update_crm','send_follow_up'] });
    if (module === 'alerts') Object.assign(payload, { metric: 'call_failure_rate', threshold: 10 });
    if (module === 'reports') Object.assign(payload, { reportType: 'call_performance', schedule: 'weekly' });
    try { await mutate(payload); await onChanged(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to create resource.'); } finally { setLoading(''); }
  }

  async function generate(id: string) {
    setLoading(id); setError('');
    try { await mutate({ action: 'generate_report', reportId: id }); await onChanged(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to generate report.'); } finally { setLoading(''); }
  }

  return <div className="space-y-6"><Header eyebrow={config.eyebrow} title={config.title} description={config.description} action={<Button onClick={create} disabled={Boolean(loading)} className="portal-primary">{loading === 'create' ? <Loader2 className="animate-spin" /> : <Plus />}{config.button}</Button>} />
    {error ? <p className="rounded-xl border border-red-400/15 bg-red-400/5 p-3 text-xs text-red-100">{error}</p> : null}
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{rows.map((row) => <section key={str(row.id)} className="rounded-2xl border border-white/8 bg-[#0c1422] p-5 shadow-[0_18px_50px_-38px_rgba(55,189,248,0.45)]"><div className="flex items-start justify-between"><span className="grid size-10 place-items-center rounded-xl border border-cyan-300/10 bg-cyan-300/[0.055]"><Icon className="size-4 text-cyan-200" /></span><Status value={str(row.status, 'ready')} /></div><h2 className="mt-5 text-sm font-semibold">{str(row.name)}</h2><p className="mt-2 min-h-10 text-[10px] leading-5 text-white/38">{resourceDescription(module, row)}</p><div className="mt-5 grid grid-cols-2 gap-2 border-t border-white/7 pt-4 text-[9px] text-white/35">{resourceFacts(module, row).map(([label, value]) => <div key={label}><p>{label}</p><p className="mt-1 text-xs font-medium text-white/70">{value}</p></div>)}</div>{module === 'reports' ? <Button variant="outline" onClick={() => generate(str(row.id))} disabled={Boolean(loading)} className="mt-4 w-full border-white/10 bg-transparent text-[10px]">{loading === str(row.id) ? <Loader2 className="animate-spin" /> : <RefreshCcw />}Generate now</Button> : null}</section>)}</div>
    {!rows.length ? <Empty icon={Icon} label={`No ${config.title.toLowerCase()} yet.`} /> : null}
    {module === 'alerts' && data.incidents.length ? <section className="rounded-2xl border border-white/8 bg-[#0c1422] p-5"><h2 className="text-sm font-semibold">Recent incidents</h2><div className="mt-4 divide-y divide-white/7">{data.incidents.map((item) => <div key={str(item.id)} className="flex items-center gap-3 py-3 text-xs"><AlertTriangle className="size-4 text-amber-200" /><span className="flex-1">{str(item.rule_name)} · current {str(item.current_value)}</span><Status value={str(item.status)} /></div>)}</div></section> : null}
  </div>;
}

function CallHistory({ data }: { data: OperationsData }) {
  return <div className="space-y-6"><Header eyebrow="Conversation system of record" title="Call history & recordings" description="Tenant-scoped recordings, transcripts, summaries, costs, outcomes and disconnect reasons." /><Stats data={data} /><section className="overflow-hidden rounded-2xl border border-white/8 bg-[#0c1422]"><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-xs"><thead className="border-b border-white/8 bg-white/[0.02] text-[9px] uppercase tracking-wider text-white/28"><tr>{['Customer','Agent','Status','Outcome','Duration','Latency','Sentiment','Credits','Recording'].map((item) => <th key={item} className="px-4 py-3 font-medium">{item}</th>)}</tr></thead><tbody className="divide-y divide-white/7">{data.calls.map((call) => <tr key={str(call.id)}><td className="px-4 py-4"><p className="font-medium">{str(call.customer_name, 'Unknown')}</p><p className="mt-1 font-mono text-[9px] text-white/28">{str(call.to_number)}</p></td><td className="px-4 py-4 text-white/55">{str(call.agent_name)}</td><td className="px-4 py-4"><Status value={str(call.status)} /></td><td className="px-4 py-4 text-white/55">{str(call.outcome).replaceAll('_',' ')}</td><td className="px-4 py-4">{duration(call.duration_seconds)}</td><td className="px-4 py-4">{str(call.latency_ms)}ms</td><td className="px-4 py-4 capitalize">{str(call.sentiment)}</td><td className="px-4 py-4">{str(call.cost_credits)}</td><td className="px-4 py-4">{call.recording_url ? <audio controls preload="none" className="h-8 w-48" src={str(call.recording_url)} /> : <span className="text-white/25">Unavailable</span>}</td></tr>)}</tbody></table></div></section></div>;
}

function LiveMonitor({ data }: { data: OperationsData }) {
  const live = data.calls.filter((call) => call.status === 'in_progress');
  return <div className="space-y-6"><Header eyebrow="Realtime operations" title="Live monitoring" description="Observe active calls, latency, sentiment and escalation signals without exposing other tenants." action={<Button variant="outline" className="border-white/10 bg-transparent"><Radio className="text-emerald-300" />{live.length} live</Button>} /><Stats data={data} /><div className="grid gap-4 lg:grid-cols-2">{live.map((call) => <section key={str(call.id)} className="rounded-2xl border border-emerald-400/12 bg-[linear-gradient(145deg,rgba(52,211,153,0.055),rgba(12,20,34,1)_55%)] p-5"><div className="flex items-center justify-between"><span className="flex items-center gap-2 text-[10px] text-emerald-200"><span className="size-2 animate-pulse rounded-full bg-emerald-400" /> Live conversation</span><span className="font-mono text-[10px] text-white/35">{duration(call.duration_seconds)}</span></div><h2 className="mt-5 text-lg font-semibold">{str(call.customer_name)}</h2><p className="mt-2 text-xs leading-5 text-white/42">{str(call.summary)}</p><div className="mt-5 grid grid-cols-3 gap-2"><Mini label="Agent" value={str(call.agent_name)} /><Mini label="Latency" value={`${str(call.latency_ms)}ms`} /><Mini label="Sentiment" value={str(call.sentiment)} /></div><div className="mt-4 flex gap-2"><Button size="sm" variant="outline" className="border-white/10 bg-transparent text-[9px]"><Headphones /> Listen</Button><Button size="sm" variant="outline" className="border-white/10 bg-transparent text-[9px]"><PhoneCall /> Take over</Button></div></section>)}{!live.length ? <Empty icon={Radio} label="No calls are active right now." /> : null}</div></div>;
}

function Analytics({ data }: { data: OperationsData }) {
  const outcomeCounts = useMemo(() => Object.entries(data.calls.reduce<Record<string, number>>((map, call) => { const key = str(call.outcome, 'unknown'); map[key] = (map[key] ?? 0) + 1; return map; }, {})).map(([name, value]) => ({ name, value })), [data.calls]);
  const activity = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, offset) => { const day = new Date(); day.setDate(day.getDate() - (6 - offset)); return day.toISOString().slice(0, 10); });
    return days.map((day) => ({ day, calls: data.calls.filter((call) => str(call.started_at, '').slice(0, 10) === day).length, conversions: data.calls.filter((call) => str(call.started_at, '').slice(0, 10) === day && ['appointment_booked','payment_link_requested','converted'].includes(str(call.outcome))).length, leads: 0 }));
  }, [data.calls]);
  return <div className="space-y-6"><Header eyebrow="Performance intelligence" title="Analytics" description="Call, outcome, latency, cost and conversion metrics generated from tenant-owned records." /><Stats data={data} /><div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]"><section className="portal-panel p-5"><h2 className="text-sm font-semibold">Conversation trend</h2><p className="mt-1 text-[10px] text-white/32">7 days · calls and conversions</p><ActivityAreaChart data={activity} /></section><section className="portal-panel p-5"><h2 className="text-sm font-semibold">Outcome distribution</h2><p className="mt-1 text-[10px] text-white/32">Recorded call outcomes</p><DistributionChart data={outcomeCounts} /></section></div></div>;
}

function Quality({ data }: { data: OperationsData }) {
  const average = data.qualityReviews.length ? Math.round(data.qualityReviews.reduce((sum, item) => sum + Number(item.overall_score ?? 0), 0) / data.qualityReviews.length) : 0;
  return <div className="space-y-6"><Header eyebrow="AI quality assurance" title="QA scorecards" description="Resolution, knowledge accuracy, naturalness, policy compliance, hallucination and overlap checks." /><div className="grid gap-3 sm:grid-cols-3"><Metric label="Average QA" value={`${average}/100`} icon={ShieldCheck} /><Metric label="Reviewed calls" value={String(data.qualityReviews.length)} icon={Headphones} /><Metric label="Open findings" value={String(data.qualityReviews.filter((item) => item.status !== 'passed').length)} icon={AlertTriangle} /></div><div className="grid gap-4 lg:grid-cols-2">{data.qualityReviews.map((review) => <section key={str(review.id)} className="rounded-2xl border border-white/8 bg-[#0c1422] p-5"><div className="flex items-center justify-between"><div><p className="text-sm font-semibold">{str(review.customer_name)}</p><p className="mt-1 text-[10px] text-white/30">{str(review.outcome).replaceAll('_',' ')}</p></div><span className="text-2xl font-semibold text-cyan-200">{str(review.overall_score)}</span></div><div className="mt-5 grid grid-cols-4 gap-2"><Mini label="Resolution" value={str(review.resolution_score)} /><Mini label="Knowledge" value={str(review.knowledge_score)} /><Mini label="Natural" value={str(review.naturalness_score)} /><Mini label="Policy" value={str(review.policy_score)} /></div><div className="mt-4 flex gap-2 text-[9px] text-white/35"><span className="rounded-lg bg-white/4 px-2 py-1">Hallucinations {str(review.hallucination_count)}</span><span className="rounded-lg bg-white/4 px-2 py-1">Overlaps {str(review.overlap_count)}</span><Status value={str(review.status)} /></div></section>)}</div></div>;
}

function WorkspaceSettings({ data, onChanged }: { data: OperationsData; onChanged: () => Promise<void> | void }) {
  const current = data.settings ?? {};
  const [language, setLanguage] = useState(str(current.default_language, 'hinglish'));
  const [recording, setRecording] = useState(str(current.recording_policy, 'record_with_consent'));
  const [loading, setLoading] = useState(false);
  async function save() { setLoading(true); try { await mutate({ action: 'update_settings', defaultLanguage: language, recordingPolicy: recording, timezone: 'Asia/Kolkata', qaSampleRate: 100, recordingRetentionDays: 90, transcriptRetentionDays: 180, redactSensitiveData: true }); await onChanged(); } finally { setLoading(false); } }
  const compliance = data.compliance ?? { consents: [], suppressions: [], kycDocuments: [] };
  return <div className="space-y-6"><Header eyebrow="Workspace controls" title="Settings & compliance" description="Languages, consent evidence, recording retention, suppression and sensitive-data redaction." /><div className="grid gap-4 xl:grid-cols-[1fr_0.72fr]"><section className="portal-panel p-5"><div className="grid gap-5 sm:grid-cols-2"><Field label="Default conversation language"><select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="hinglish">Hinglish</option><option value="haryanvi">Haryanvi</option><option value="hi-IN">Hindi</option><option value="en-IN">Indian English</option></select></Field><Field label="Recording policy"><select value={recording} onChange={(event) => setRecording(event.target.value)}><option value="record_with_consent">Record with consent</option><option value="disabled">Do not record</option><option value="always_record">Always record where lawful</option></select></Field></div><div className="mt-5 grid gap-3 sm:grid-cols-3"><Mini label="Recording retention" value={`${str(current.recording_retention_days, '90')} days`} /><Mini label="Transcript retention" value={`${str(current.transcript_retention_days, '180')} days`} /><Mini label="Sensitive data" value={Number(current.redact_sensitive_data ?? 1) ? 'Redacted' : 'Visible'} /></div><Button onClick={save} disabled={loading} className="portal-primary mt-5">{loading ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}Save settings</Button></section><section className="portal-panel p-5"><h2 className="text-sm font-semibold">Compliance ledger</h2><p className="mt-1 text-[10px] text-white/32">Tenant-scoped evidence used by the call gate</p><div className="mt-5 grid gap-3"><Mini label="Active consent records" value={String(compliance.consents.filter((item) => item.status === 'granted').length)} /><Mini label="Suppressed contacts" value={String(compliance.suppressions.length)} /><Mini label="KYC documents" value={String(compliance.kycDocuments.length)} /></div><p className="mt-4 text-[9px] leading-4 text-white/32">Outbound call creation is rejected unless consent is valid, the number is not suppressed and at least 10 credits remain.</p></section></div><CustomerSecurity /></div>;
}

function Stats({ data }: { data: OperationsData }) { const stats = data.stats ?? {}; return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric label="Total calls" value={str(stats.total_calls, '0')} icon={PhoneCall} /><Metric label="Live" value={str(stats.live_calls, '0')} icon={Radio} /><Metric label="Avg duration" value={duration(stats.average_duration)} icon={Activity} /><Metric label="Avg latency" value={`${str(stats.average_latency, '0')}ms`} icon={Network} /><Metric label="Recordings" value={str(stats.recordings, '0')} icon={FileAudio} /></div>; }
function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Bot }) { return <section className="portal-stat p-4"><Icon className="size-4 text-[#a8b7ff]" /><p className="mt-4 text-2xl font-semibold">{value}</p><p className="mt-1 text-[9px] uppercase tracking-wider text-white/28">{label}</p></section>; }
function Header({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) { return <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9eb0ff]">{eyebrow}</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1><p className="mt-2 max-w-3xl text-xs leading-5 text-white/38">{description}</p></div>{action}</div>; }
function Status({ value }: { value: string }) { const good = /active|ready|live|completed|passed|resolved|connected|operational/.test(value.toLowerCase()); return <span className={`inline-flex rounded-full px-2 py-1 text-[8px] capitalize ${good ? 'bg-emerald-400/8 text-emerald-200' : 'bg-amber-300/8 text-amber-200'}`}>{value.replaceAll('_',' ')}</span>; }
function Mini({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-white/7 bg-white/[0.025] p-3"><p className="text-[8px] uppercase tracking-wider text-white/25">{label}</p><p className="mt-1 truncate text-[10px] font-medium capitalize text-white/65">{value}</p></div>; }
function Empty({ icon: Icon, label }: { icon: typeof Bot; label: string }) { return <div className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.015] text-center"><div><Icon className="mx-auto size-6 text-white/25" /><p className="mt-3 text-xs text-white/35">{label}</p></div></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-xs text-white/55">{label}<div className="mt-2 [&_select]:h-11 [&_select]:w-full [&_select]:rounded-xl [&_select]:border [&_select]:border-white/10 [&_select]:bg-[#101a2b] [&_select]:px-3 [&_select]:text-xs">{children}</div></label>; }
function str(value: unknown, fallback = '—') { if (value === null || value === undefined || value === '') return fallback; if (typeof value === 'string') return value; if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return value.toString(); return fallback; }
function duration(value: unknown) { const seconds = Number(value ?? 0); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,'0')}`; }
async function mutate(payload: Record<string, unknown>) { const response = await fetch('/api/app/operations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error ?? 'Request failed.'); return body; }
function resourceDescription(module: string, row: Record<string, unknown>) { if (module === 'sip_trunks') return `${str(row.gateway_uri)} · ${str(row.transport).toUpperCase()} · ${str(row.media_encryption).toUpperCase()}`; if (module === 'knowledge') return str(row.description); if (module === 'workflows') return `${str(row.trigger_type).replaceAll('_',' ')} · ${str(row.run_count, '0')} runs`; if (module === 'graph_agents') return `Entry: ${str(row.entry_node)} · version ${str(row.version)}`; if (module === 'campaigns') return `${str(row.attempted, '0')} of ${str(row.audience_size, '0')} contacts attempted`; if (module === 'alerts') return `${str(row.metric).replaceAll('_',' ')} ${str(row.comparator)} ${str(row.threshold)}`; return `${str(row.report_type).replaceAll('_',' ')} · ${str(row.schedule)}`; }
function resourceFacts(module: string, row: Record<string, unknown>) { if (module === 'campaigns') return [['Connected', str(row.connected, '0')], ['Converted', str(row.converted, '0')]]; if (module === 'sip_trunks') return [['Auth', str(row.auth_type)], ['Codecs', safeArray(row.codecs_json).join(', ')]]; if (module === 'knowledge') return [['Sources', str(row.source_count, '0')], ['Chunks', str(row.chunk_count, '0')]]; if (module === 'workflows') return [['Runs', str(row.run_count, '0')], ['Failures', str(row.failure_count, '0')]]; if (module === 'graph_agents') return [['Version', str(row.version)], ['Entry', str(row.entry_node)]]; if (module === 'alerts') return [['Window', `${str(row.window_minutes)} min`], ['Frequency', `${str(row.frequency_minutes)} min`]]; return [['Schedule', str(row.schedule)], ['Last generated', str(row.last_generated_at, 'Not yet')]]; }
function safeArray(value: unknown) { try { const parsed = JSON.parse(str(value, '[]')); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } }
