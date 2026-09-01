'use client';

import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Filter,
  Mail,
  PhoneCall,
  Plus,
  Search,
  Sparkles,
  Target,
  UserRound,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type CrmLead = {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  score: number;
  intent: string;
  status: string;
  ai_summary: string;
  campaign_name?: string | null;
  product_interest?: string | null;
  source_type: string;
  source_name: string;
  stage: string;
  estimated_value: number;
  owner: string;
  next_action: string;
};

export type CrmActivity = {
  id: string;
  lead_id: string;
  type: string;
  subject: string;
  notes?: string | null;
  due_at?: string | null;
  completed_at?: string | null;
  created_by?: string | null;
  created_at: string;
  lead_name: string;
};

const stages = [
  { id: 'new', label: 'New', color: 'bg-slate-300' },
  { id: 'ai_qualified', label: 'Qualified', color: 'bg-cyan-300' },
  { id: 'hot_lead', label: 'Hot lead', color: 'bg-amber-300' },
  { id: 'proposal', label: 'Proposal', color: 'bg-violet-300' },
  { id: 'won', label: 'Won', color: 'bg-emerald-300' },
] as const;

export function CustomerCrm({
  leads,
  activities,
  onMove,
}: {
  leads: CrmLead[];
  activities: CrmActivity[];
  onMove: (lead: CrmLead, stage: string) => Promise<void>;
}) {
  const [view, setView] = useState<'pipeline' | 'activities'>('pipeline');
  const [query, setQuery] = useState('');
  const [moving, setMoving] = useState('');
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return leads;
    return leads.filter((lead) =>
      [lead.name, lead.phone, lead.email, lead.source_name, lead.product_interest]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized)),
    );
  }, [leads, query]);
  const pipelineValue = leads.reduce((sum, lead) => sum + Number(lead.estimated_value || 0), 0);
  const hotLeads = leads.filter((lead) => lead.score >= 75).length;

  async function move(lead: CrmLead, stage: string) {
    setMoving(lead.id);
    try {
      await onMove(lead, stage);
    } finally {
      setMoving('');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300/80">Advanced CRM</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Revenue pipeline with AI context</h1>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-white/38 sm:text-sm">Every ad lead, website form and call outcome becomes a scored opportunity, task and next-best action.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="border-white/10 bg-transparent"><Plus /> Import leads</Button>
          <Button className="bg-amber-300 text-[#17120a] hover:bg-amber-200"><PhoneCall /> Start AI follow-up</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Pipeline value" value={money(pipelineValue)} note="Open opportunities" icon={CircleDollarSign} />
        <Metric label="AI-qualified" value={String(leads.filter((lead) => lead.stage !== 'new').length)} note={`${leads.length} captured leads`} icon={Sparkles} />
        <Metric label="Hot leads" value={String(hotLeads)} note="Score 75 or above" icon={Target} />
        <Metric label="Tasks due" value={String(activities.filter((item) => !item.completed_at).length)} note="Calls and follow-ups" icon={CalendarClock} />
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-white/8 bg-[#0e1119] p-3 sm:flex-row sm:items-center">
        <div className="flex rounded-lg bg-white/[0.035] p-1">
          {(['pipeline', 'activities'] as const).map((item) => (
            <button key={item} type="button" onClick={() => setView(item)} className={`rounded-md px-3 py-2 text-[10px] font-medium capitalize ${view === item ? 'bg-white/9 text-white' : 'text-white/38'}`}>
              {item}
            </button>
          ))}
        </div>
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-white/25" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, phone, source or product" className="h-9 border-white/8 bg-white/[0.025] pl-9 text-xs" />
        </div>
        <Button variant="outline" size="sm" className="border-white/10 bg-transparent"><Filter /> Source · All</Button>
      </div>

      {view === 'pipeline' ? (
        <div className="overflow-x-auto pb-2">
          <div className="grid min-w-[1260px] grid-cols-5 gap-3">
            {stages.map((stage, stageIndex) => {
              const stageLeads = filtered.filter((lead) => normalizeStage(lead.stage) === stage.id);
              const value = stageLeads.reduce((sum, lead) => sum + Number(lead.estimated_value || 0), 0);
              return (
                <section key={stage.id} className="rounded-2xl border border-white/8 bg-[#0c0f16] p-3">
                  <div className="mb-3 flex items-center gap-2 px-1">
                    <span className={`size-2 rounded-full ${stage.color}`} />
                    <h2 className="text-xs font-semibold">{stage.label}</h2>
                    <span className="rounded-md bg-white/6 px-1.5 py-0.5 text-[9px] text-white/42">{stageLeads.length}</span>
                    <span className="ml-auto text-[9px] text-white/28">{money(value)}</span>
                  </div>
                  <div className="space-y-2.5">
                    {stageLeads.map((lead) => (
                      <article key={lead.id} className="rounded-xl border border-white/8 bg-[#121620] p-3.5 shadow-lg shadow-black/10">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0"><p className="truncate text-xs font-medium">{lead.name}</p><p className="mt-1 truncate text-[9px] text-white/30">{lead.source_name} · {lead.campaign_name || 'Organic'}</p></div>
                          <span className={`grid size-8 shrink-0 place-items-center rounded-lg font-mono text-[10px] font-semibold ${lead.score >= 75 ? 'bg-amber-300/12 text-amber-200' : 'bg-cyan-300/10 text-cyan-200'}`}>{lead.score}</span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          <Badge variant="outline" className="border-white/8 bg-white/[0.025] text-[8px] text-white/45">{lead.intent.replaceAll('_', ' ')}</Badge>
                          {lead.product_interest ? <Badge variant="outline" className="max-w-[135px] truncate border-white/8 bg-white/[0.025] text-[8px] text-white/45">{lead.product_interest}</Badge> : null}
                        </div>
                        <div className="mt-3 rounded-lg border border-violet-300/8 bg-violet-300/[0.035] p-2.5">
                          <div className="flex items-center gap-1.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-violet-200/65"><Bot className="size-3" /> AI next action</div>
                          <p className="mt-1.5 line-clamp-2 text-[9px] leading-4 text-white/42">{lead.next_action}</p>
                        </div>
                        <div className="mt-3 flex items-center justify-between border-t border-white/7 pt-3">
                          <div className="flex gap-1.5 text-white/28"><PhoneCall className="size-3" /><Mail className="size-3" /></div>
                          {stageIndex < stages.length - 1 ? (
                            <button type="button" disabled={moving === lead.id} onClick={() => move(lead, stages[stageIndex + 1].id)} className="inline-flex items-center gap-1 text-[9px] text-amber-200 disabled:opacity-40">
                              Move <ArrowRight className="size-3" />
                            </button>
                          ) : (
                            <CheckCircle2 className="size-3.5 text-emerald-300" />
                          )}
                        </div>
                      </article>
                    ))}
                    {!stageLeads.length ? <div className="grid min-h-28 place-items-center rounded-xl border border-dashed border-white/8 text-[9px] text-white/22">Drop opportunities here</div> : null}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <section className="rounded-2xl border border-white/8 bg-[#0e1119] p-5">
          <div className="divide-y divide-white/7">
            {activities.map((activity) => (
              <div key={activity.id} className="flex gap-4 py-4 first:pt-0 last:pb-0">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/5"><UserRound className="size-4 text-white/40" /></span>
                <div className="min-w-0 flex-1"><p className="text-xs font-medium">{activity.subject}</p><p className="mt-1 text-[10px] text-white/32">{activity.lead_name} · {activity.created_by || 'System'} · {formatDate(activity.created_at)}</p>{activity.notes ? <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-white/42">{activity.notes}</p> : null}</div>
                <Badge variant="outline" className="h-fit border-white/8 bg-white/[0.025] text-[8px] text-white/40">{activity.type.replaceAll('_', ' ')}</Badge>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Metric({ label, value, note, icon: Icon }: { label: string; value: string; note: string; icon: typeof Target }) {
  return <div className="rounded-2xl border border-white/8 bg-[#0e1119] p-4"><div className="flex items-center justify-between"><p className="text-[10px] uppercase tracking-[0.12em] text-white/28">{label}</p><Icon className="size-4 text-amber-300/65" /></div><p className="mt-4 text-2xl font-semibold">{value}</p><p className="mt-1 text-[10px] text-white/30">{note}</p></div>;
}

function normalizeStage(stage: string) {
  if (stage === 'contacted') return 'new';
  if (stage === 'lost') return 'proposal';
  return stages.some((item) => item.id === stage) ? stage : 'new';
}
function money(value: number) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value); }
function formatDate(value: string) { return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }); }
