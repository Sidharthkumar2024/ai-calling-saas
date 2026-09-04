'use client';
/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions -- native HTML drag/drop is paired with a fully accessible stage select on every card */

import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Filter,
  GripVertical,
  Loader2,
  Mail,
  PhoneCall,
  Plus,
  Search,
  Sparkles,
  Target,
  Upload,
  X,
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
  { id: 'ai_qualified', label: 'Qualified', color: 'bg-primary' },
  { id: 'hot_lead', label: 'Hot lead', color: 'bg-primary' },
  { id: 'proposal', label: 'Proposal', color: 'bg-violet-300' },
  { id: 'won', label: 'Won', color: 'bg-emerald-300' },
] as const;

export function CustomerCrm({
  leads,
  activities,
  timeline,
  onMove,
  onChanged,
  onStartFollowUp,
}: {
  leads: CrmLead[];
  activities: CrmActivity[];
  /** Score history per lead id, newest first. */
  timeline?: Record<string, LeadTimelineEvent[]>;
  onMove: (lead: CrmLead, stage: string) => Promise<void>;
  onChanged: () => Promise<void>;
  onStartFollowUp: () => void;
}) {
  const [view, setView] = useState<'pipeline' | 'activities'>('pipeline');
  const [query, setQuery] = useState('');
  const [moving, setMoving] = useState('');
  const [draggedLeadId, setDraggedLeadId] = useState('');
  const [dropStage, setDropStage] = useState('');
  const [moveError, setMoveError] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState(
    'name,phone,email,product\nAditi Mehra,+919876543210,aditi@example.com,Product demo',
  );
  const [importing, setImporting] = useState(false);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const sourceRows =
      sourceFilter === 'all'
        ? leads
        : leads.filter((lead) => lead.source_type === sourceFilter);
    if (!normalized) return sourceRows;
    return sourceRows.filter((lead) =>
      [
        lead.name,
        lead.phone,
        lead.email,
        lead.source_name,
        lead.product_interest,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized)),
    );
  }, [leads, query, sourceFilter]);
  const pipelineValue = leads.reduce(
    (sum, lead) => sum + Number(lead.estimated_value || 0),
    0,
  );
  const hotLeads = leads.filter((lead) => lead.score >= 75).length;

  async function move(lead: CrmLead, stage: string) {
    if (normalizeStage(lead.stage) === stage || moving) return;
    setMoving(lead.id);
    setMoveError('');
    try {
      await onMove(lead, stage);
    } catch (caught) {
      setMoveError(
        caught instanceof Error
          ? caught.message
          : 'The opportunity could not be moved.',
      );
    } finally {
      setMoving('');
      setDraggedLeadId('');
      setDropStage('');
    }
  }

  function dropInto(stage: string) {
    const lead = leads.find((item) => item.id === draggedLeadId);
    if (lead) void move(lead, stage);
    else {
      setDraggedLeadId('');
      setDropStage('');
    }
  }

  async function importLeads() {
    const rows = importText
      .split(/\r?\n/)
      .map((line) => parseCsvLine(line))
      .filter((row) => row.some(Boolean));
    if (rows.length < 2) {
      setMoveError('Add a header and at least one lead row.');
      return;
    }
    const header = rows[0].map((item) => item.toLowerCase().trim());
    const index = (names: string[]) =>
      header.findIndex((item) => names.includes(item));
    const nameIndex = index(['name', 'full name']);
    const phoneIndex = index(['phone', 'mobile', 'number']);
    if (nameIndex < 0 || phoneIndex < 0) {
      setMoveError('CSV needs name and phone columns.');
      return;
    }
    setImporting(true);
    setMoveError('');
    try {
      const importRows = rows
        .slice(1, 101)
        .filter((row) => row[nameIndex]?.trim() && row[phoneIndex]?.trim());
      for (let offset = 0; offset < importRows.length; offset += 10) {
        await Promise.all(
          importRows.slice(offset, offset + 10).map(async (row) => {
            const response = await fetch('/api/leads', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                sourceType: 'manual',
                externalLeadId: `csv-${crypto.randomUUID()}`,
                name: row[nameIndex],
                phone: row[phoneIndex],
                email: row[index(['email'])] || undefined,
                productInterest:
                  row[index(['product', 'product interest', 'interest'])] ||
                  undefined,
                campaignName: 'CRM CSV import',
              }),
            });
            const payload = (await response.json()) as { error?: string };
            if (!response.ok)
              throw new Error(
                payload.error || `Could not import ${row[nameIndex]}.`,
              );
          }),
        );
      }
      setImportOpen(false);
      await onChanged();
    } catch (caught) {
      setMoveError(
        caught instanceof Error ? caught.message : 'Lead import failed.',
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-warning-text">
            Advanced CRM
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Revenue pipeline with AI context
          </h1>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-ink-muted sm:text-sm">
            Every ad lead, website form and call outcome becomes a scored
            opportunity, task and next-best action.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setImportOpen(true)}
            variant="outline"
            className="border-hairline bg-transparent"
          >
            <Plus /> Import leads
          </Button>
          <Button onClick={onStartFollowUp} className="portal-primary">
            <PhoneCall /> Start AI follow-up
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Pipeline value"
          value={money(pipelineValue)}
          note="Open opportunities"
          icon={CircleDollarSign}
        />
        <Metric
          label="AI-qualified"
          value={String(leads.filter((lead) => lead.stage !== 'new').length)}
          note={`${leads.length} captured leads`}
          icon={Sparkles}
        />
        <Metric
          label="Hot leads"
          value={String(hotLeads)}
          note="Score 75 or above"
          icon={Target}
        />
        <Metric
          label="Tasks due"
          value={String(activities.filter((item) => !item.completed_at).length)}
          note="Calls and follow-ups"
          icon={CalendarClock}
        />
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-3 sm:flex-row sm:items-center">
        <div className="flex rounded-lg bg-surface-strong p-1">
          {(['pipeline', 'activities'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setView(item)}
              className={`rounded-md px-3 py-2 text-[10px] font-medium capitalize ${view === item ? 'bg-surface-strong text-ink' : 'text-ink-muted'}`}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-muted" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, phone, source or product"
            className="h-9 border-hairline bg-surface-muted pl-9 text-xs"
          />
        </div>
        <label className="relative">
          <Filter className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-muted" />
          <select
            aria-label="Filter leads by source"
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value)}
            className="h-9 rounded-lg border border-hairline bg-surface pl-9 pr-7 text-[10px] text-ink"
          >
            <option value="all">Source · All</option>
            {Array.from(
              new Map(
                leads.map((lead) => [lead.source_type, lead.source_name]),
              ).entries(),
            ).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {moveError ? (
        <p
          role="alert"
          className="rounded-xl border border-red-400/15 bg-red-400/5 px-4 py-3 text-xs text-danger-text"
        >
          {moveError}
        </p>
      ) : null}

      {importOpen ? (
        <dialog
          open
          className="fixed inset-0 z-[80] m-0 grid size-full max-h-none max-w-none place-items-center border-0 bg-black/65 p-4 text-white backdrop-blur-sm"
          aria-label="Import leads"
        >
          <section className="w-full max-w-2xl rounded-2xl border border-hairline bg-surface p-5 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-semibold">
                  Import leads from CSV
                </h2>
                <p className="mt-1 text-[10px] text-ink-muted">
                  Up to 100 rows · required headers: name, phone
                </p>
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => setImportOpen(false)}
                aria-label="Close import"
              >
                <X />
              </Button>
            </div>
            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              className="mt-5 min-h-64 w-full rounded-xl border border-hairline bg-surface-muted p-4 font-mono text-[10px] leading-5 text-ink-body outline-none focus:border-indigo-300/35"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setImportOpen(false)}
                className="border-hairline bg-transparent"
              >
                Cancel
              </Button>
              <Button
                onClick={() => void importLeads()}
                disabled={importing}
                className="portal-primary"
              >
                {importing ? <Loader2 className="animate-spin" /> : <Upload />}{' '}
                Import into CRM
              </Button>
            </div>
          </section>
        </dialog>
      ) : null}

      {view === 'pipeline' ? (
        <div className="overflow-x-auto pb-2">
          <div className="grid min-w-[1260px] grid-cols-5 gap-3">
            {stages.map((stage, stageIndex) => {
              const stageLeads = filtered.filter(
                (lead) => normalizeStage(lead.stage) === stage.id,
              );
              const value = stageLeads.reduce(
                (sum, lead) => sum + Number(lead.estimated_value || 0),
                0,
              );
              return (
                <section
                  key={stage.id}
                  aria-label={`${stage.label} pipeline stage`}
                  onDragEnter={() => setDropStage(stage.id)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setDropStage(stage.id);
                  }}
                  onDragLeave={(event) => {
                    if (
                      !event.currentTarget.contains(
                        event.relatedTarget as Node | null,
                      )
                    )
                      setDropStage('');
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    dropInto(stage.id);
                  }}
                  className={`rounded-2xl border p-3 transition duration-200 ${dropStage === stage.id ? 'border-cyan-300/35 bg-cyan-300/[0.045] shadow-[0_0_0_1px_rgba(103,232,249,0.08)]' : 'border-hairline bg-surface'}`}
                >
                  <div className="mb-3 flex items-center gap-2 px-1">
                    <span className={`size-2 rounded-full ${stage.color}`} />
                    <h2 className="text-xs font-semibold">{stage.label}</h2>
                    <span className="rounded-md bg-surface-strong px-1.5 py-0.5 text-[9px] text-ink-muted">
                      {stageLeads.length}
                    </span>
                    <span className="ml-auto text-[9px] text-ink-muted">
                      {money(value)}
                    </span>
                  </div>
                  <div className="space-y-2.5">
                    {stageLeads.map((lead) => (
                      <article
                        key={lead.id}
                        draggable={moving !== lead.id}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', lead.id);
                          setDraggedLeadId(lead.id);
                        }}
                        onDragEnd={() => {
                          setDraggedLeadId('');
                          setDropStage('');
                        }}
                        className={`group rounded-xl border bg-surface p-3.5 shadow-lg shadow-black/10 transition duration-200 ${draggedLeadId === lead.id ? 'scale-[0.98] border-cyan-300/30 opacity-45' : 'border-hairline hover:border-hairline'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 gap-2">
                            <GripVertical
                              aria-hidden="true"
                              className="mt-0.5 size-3.5 shrink-0 cursor-grab text-ink-muted transition group-hover:text-ink-muted active:cursor-grabbing"
                            />
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium">
                                {lead.name}
                              </p>
                              <p className="mt-1 truncate text-[9px] text-ink-muted">
                                {lead.source_name} ·{' '}
                                {lead.campaign_name || 'Organic'}
                              </p>
                            </div>
                          </div>
                          <span
                            className={`grid size-8 shrink-0 place-items-center rounded-lg font-mono text-[10px] font-semibold ${lead.score >= 75 ? 'bg-amber-300/12 text-warning-text' : 'bg-cyan-300/10 text-cyan-700'}`}
                          >
                            {lead.score}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          <Badge
                            variant="outline"
                            className="border-hairline bg-surface-muted text-[8px] text-ink-muted"
                          >
                            {lead.intent.replaceAll('_', ' ')}
                          </Badge>
                          {lead.product_interest ? (
                            <Badge
                              variant="outline"
                              className="max-w-[135px] truncate border-hairline bg-surface-muted text-[8px] text-ink-muted"
                            >
                              {lead.product_interest}
                            </Badge>
                          ) : null}
                        </div>
                        {/*
                          Why the score is what it is. `lead_events` has carried
                          the previous value, the new one and every contribution
                          since the post-call loop shipped, and nothing read it —
                          so a score that moved thirty points could not say why,
                          which is precisely what the trail was written for.
                        */}
                        {(timeline?.[lead.id] ?? [])[0] ? (
                          <ScoreChange event={(timeline?.[lead.id] ?? [])[0]} />
                        ) : null}
                        <div className="mt-3 rounded-lg border border-violet-300/8 bg-violet-300/[0.035] p-2.5">
                          <div className="flex items-center gap-1.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-violet-700">
                            <Bot className="size-3" /> AI next action
                          </div>
                          <p className="mt-1.5 line-clamp-2 text-[9px] leading-4 text-ink-muted">
                            {lead.next_action}
                          </p>
                        </div>
                        <div className="mt-3 flex items-center justify-between border-t border-hairline pt-3">
                          <div className="flex gap-1.5 text-ink-muted">
                            <PhoneCall className="size-3" />
                            <Mail className="size-3" />
                          </div>
                          {stageIndex < stages.length - 1 ? (
                            <label className="relative inline-flex items-center gap-1 text-[9px] text-warning-text">
                              <span className="sr-only">
                                Move {lead.name} to another stage
                              </span>
                              <select
                                aria-label={`Move ${lead.name} to another stage`}
                                value={normalizeStage(lead.stage)}
                                disabled={moving === lead.id}
                                onChange={(event) =>
                                  void move(lead, event.target.value)
                                }
                                className="appearance-none bg-transparent pr-4 text-right text-[9px] text-warning-text outline-none disabled:opacity-40"
                              >
                                {stages.map((option) => (
                                  <option
                                    key={option.id}
                                    value={option.id}
                                    className="bg-surface text-ink"
                                  >
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              <ArrowRight
                                aria-hidden="true"
                                className="pointer-events-none absolute right-0 size-3"
                              />
                            </label>
                          ) : (
                            <CheckCircle2 className="size-3.5 text-success-text" />
                          )}
                        </div>
                      </article>
                    ))}
                    {!stageLeads.length ? (
                      <div className="grid min-h-28 place-items-center rounded-xl border border-dashed border-hairline text-[9px] text-ink-muted">
                        Drop opportunities here
                      </div>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <section className="rounded-2xl border border-hairline bg-surface p-5">
          <div className="divide-y divide-white/7">
            {activities.map((activity) => (
              <div
                key={activity.id}
                className="flex gap-4 py-4 first:pt-0 last:pb-0"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-strong">
                  <UserRound className="size-4 text-ink-muted" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">{activity.subject}</p>
                  <p className="mt-1 text-[10px] text-ink-muted">
                    {activity.lead_name} · {activity.created_by || 'System'} ·{' '}
                    {formatDate(activity.created_at)}
                  </p>
                  {activity.notes ? (
                    <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-ink-muted">
                      {activity.notes}
                    </p>
                  ) : null}
                </div>
                <Badge
                  variant="outline"
                  className="h-fit border-hairline bg-surface-muted text-[8px] text-ink-muted"
                >
                  {activity.type.replaceAll('_', ' ')}
                </Badge>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  note,
  icon: Icon,
}: {
  label: string;
  value: string;
  note: string;
  icon: typeof Target;
}) {
  return (
    <div className="group rounded-2xl border border-hairline bg-surface p-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-muted">
          {label}
        </p>
        <span className="grid size-9 place-items-center rounded-xl border border-amber-200/10 bg-amber-300/[0.065] transition group-hover:border-amber-200/20">
          <Icon className="size-[17px] text-warning-text" />
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold text-ink">{value}</p>
      <p className="mt-1 text-[10px] text-ink-muted">{note}</p>
    </div>
  );
}

function normalizeStage(stage: string) {
  if (stage === 'contacted') return 'new';
  if (stage === 'lost') return 'proposal';
  return stages.some((item) => item.id === stage) ? stage : 'new';
}
function money(value: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}
function formatDate(value: string) {
  return new Date(value).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"' && quoted) {
      current += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) {
      values.push(current.trim());
      current = '';
    } else current += character;
  }
  values.push(current.trim());
  return values;
}

export type LeadTimelineEvent = {
  id: string;
  createdAt: string;
  eventType: string;
  headline: string;
  delta: number | null;
  direction: 'up' | 'down' | 'flat';
  reasons: Array<{ signal: string; delta: number; note: string }>;
};

/**
 * The most recent score change on a lead, and what moved it.
 *
 * Collapsed by default: the headline is the answer most of the time, and the
 * contributions are what somebody opens when they disagree with it.
 */
function ScoreChange({ event }: { event: LeadTimelineEvent }) {
  const [open, setOpen] = useState(false);
  if (event.eventType !== 'score_recalculated') return null;
  return (
    <div className="mt-3 rounded-lg border border-hairline bg-surface-muted p-2.5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 text-left"
      >
        <span
          className={`text-[9px] font-semibold ${
            event.direction === 'up'
              ? 'text-success-text'
              : event.direction === 'down'
                ? 'text-danger-text'
                : 'text-ink-muted'
          }`}
        >
          {event.delta === null || event.delta === 0
            ? '±0'
            : `${event.delta > 0 ? '+' : ''}${event.delta}`}
        </span>
        <span className="flex-1 truncate text-[9px] text-ink-body">
          {event.headline}
        </span>
        {event.reasons.length ? (
          <span className="text-[8px] text-ink-muted">
            {open ? 'hide' : 'why'}
          </span>
        ) : null}
      </button>
      {open && event.reasons.length ? (
        <ul className="mt-2 space-y-1">
          {event.reasons.map((reason) => (
            <li
              key={`${reason.signal}-${reason.delta}`}
              className="flex gap-2 text-[9px] text-ink-muted"
            >
              <span
                className={`w-8 shrink-0 text-right font-mono ${
                  reason.delta > 0 ? 'text-success-text' : 'text-danger-text'
                }`}
              >
                {reason.delta > 0 ? '+' : ''}
                {reason.delta}
              </span>
              <span>{reason.note}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
