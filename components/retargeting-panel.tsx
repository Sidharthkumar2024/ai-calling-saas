'use client';

import { useState } from 'react';
import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  CircleDollarSign,
  Filter,
  Globe2,
  Megaphone,
  RefreshCw,
  Repeat2,
  ShieldCheck,
  Target,
  UserRoundCheck,
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
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const segments = [
  {
    name: 'Hot · high intent',
    count: '284',
    rule: 'Score ≥ 80 · no sale yet',
    action: 'Meta + Google',
    tone: 'text-danger-text bg-rose-400/10',
  },
  {
    name: 'No answer · retry',
    count: '611',
    rule: '2+ missed AI calls · 14 days',
    action: 'Meta awareness',
    tone: 'text-warning-text bg-amber-400/10',
  },
  {
    name: 'Price objection',
    count: '193',
    rule: 'Objection detected in transcript',
    action: 'Offer campaign',
    tone: 'text-violet-700 bg-violet-400/10',
  },
  {
    name: 'Booked · suppress',
    count: '96',
    rule: 'Active appointment exists',
    action: 'Exclude 30 days',
    tone: 'text-success-text bg-emerald-400/10',
  },
  {
    name: 'Won · upsell',
    count: '142',
    rule: 'Closed won · consent valid',
    action: 'Upsell audience',
    tone: 'text-sky-700 bg-sky-400/10',
  },
];

const syncRows = [
  [
    'Meta Ads',
    'Hot lead · high intent',
    'Vaani · Hot prospects',
    'Every 6 hours',
    'Needs token',
  ],
  [
    'Google Ads',
    'No sale · qualified',
    'Customer Match · Qualified',
    'Daily',
    'Needs token',
  ],
  [
    'Meta Ads',
    'Appointment booked',
    'Suppression · 30 days',
    'Every 6 hours',
    'Draft',
  ],
  ['Google Ads', 'Closed won', 'Converted customers', 'Daily', 'Draft'],
  [
    'Website CRM',
    'All form conversions',
    'First-party event stream',
    'Realtime',
    'Ready',
  ],
];

const loopSteps = [
  { label: 'Capture', detail: 'Ads + website CRM', icon: Megaphone },
  {
    label: 'Understand',
    detail: 'Intent + score + objection',
    icon: BrainCircuit,
  },
  { label: 'Segment', detail: 'Dynamic audience rules', icon: Filter },
  { label: 'Sync', detail: 'Meta + Google', icon: Repeat2 },
  { label: 'Convert', detail: 'Call, booking or sale', icon: CircleDollarSign },
];

const sourceReadiness = [
  {
    icon: Megaphone,
    name: 'Meta Ads',
    detail: 'Access token + ad account required',
    state: 'Needs setup',
  },
  {
    icon: Target,
    name: 'Google Ads',
    detail: 'OAuth + Customer Match eligibility',
    state: 'Needs setup',
  },
  {
    icon: Globe2,
    name: 'Website CRM',
    detail: 'First-party capture is available',
    state: 'Ready',
  },
];

export function RetargetingPanel({
  onNotice,
}: {
  onNotice: (message: string) => void;
}) {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  function runRefresh() {
    setRefreshing(true);
    window.setTimeout(() => {
      setRefreshing(false);
      onNotice(
        'Audience rules recalculated. Meta and Google delivery is waiting for production credentials.',
      );
    }, 650);
  }

  return (
    <div className="space-y-5 xl:space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Repeat2 className="size-3.5 text-primary" /> Growth automation
            <span className="text-border">/</span> Closed-loop audiences
          </div>
          <h2 className="text-2xl font-semibold tracking-[-0.025em] sm:text-[28px]">
            Always-on audience retargeting
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Turn every ad lead, website form, AI call outcome and CRM conversion
            into a continuously refreshed Meta or Google audience.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="h-8 border-violet-400/20 bg-violet-400/8 px-3 text-violet-700"
          >
            Phase 2 blueprint
          </Badge>
          <Button onClick={runRefresh} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Refreshing…' : 'Run audience refresh'}
          </Button>
        </div>
      </div>

      <Card className="border-primary/18 bg-[linear-gradient(100deg,color-mix(in_oklab,var(--primary)_8%,var(--card)),var(--card)_65%)]">
        <CardHeader>
          <CardTitle>Lead-to-sale learning loop</CardTitle>
          <CardDescription>
            Audience membership changes automatically as AI and CRM outcomes
            change.
          </CardDescription>
          <CardAction className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              Auto refresh
            </span>
            <Switch
              checked={autoRefresh}
              onCheckedChange={(checked) => {
                setAutoRefresh(checked);
                onNotice(
                  checked
                    ? 'Automatic audience refresh enabled for the blueprint.'
                    : 'Automatic audience refresh paused.',
                );
              }}
              aria-label="Automatically refresh audiences"
            />
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr] lg:items-center">
            {loopSteps.map((step, index) => (
              <div key={step.label} className="contents">
                <div className="rounded-xl border border-border/75 bg-background/45 p-3.5">
                  <step.icon className="size-4 text-primary" />
                  <p className="mt-2.5 text-sm font-medium">{step.label}</p>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                    {step.detail}
                  </p>
                </div>
                {index < loopSteps.length - 1 ? (
                  <ArrowRight className="mx-auto size-4 rotate-90 text-muted-foreground lg:rotate-0" />
                ) : null}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {segments.map((segment) => (
          <Card key={segment.name} size="sm">
            <CardHeader>
              <CardDescription>{segment.name}</CardDescription>
              <CardTitle className="pt-1 font-mono text-2xl font-semibold">
                {segment.count}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-[11px] leading-4 text-muted-foreground">
                {segment.rule}
              </p>
              <Badge className={`mt-3 ${segment.tone}`} variant="secondary">
                {segment.action}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.65fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Audience sync plan</CardTitle>
            <CardDescription>
              Destinations stay continuously aligned with CRM and AI-call
              outcomes.
            </CardDescription>
            <CardAction>
              <Badge variant="secondary">5 rules</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="overflow-x-auto px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Source</TableHead>
                  <TableHead>Segment rule</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Refresh</TableHead>
                  <TableHead className="pr-4 text-right">State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {syncRows.map((row) => (
                  <TableRow key={`${row[0]}-${row[1]}`}>
                    <TableCell className="pl-4 font-medium">{row[0]}</TableCell>
                    <TableCell>{row[1]}</TableCell>
                    <TableCell>{row[2]}</TableCell>
                    <TableCell className="font-mono text-[11px]">
                      {row[3]}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Badge
                        variant="outline"
                        className={
                          row[4] === 'Ready'
                            ? 'border-emerald-400/20 bg-emerald-400/8 text-success-text'
                            : 'border-amber-400/20 bg-amber-400/8 text-warning-text'
                        }
                      >
                        {row[4]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Source readiness</CardTitle>
              <CardDescription>
                Connection state for this blueprint
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {sourceReadiness.map((source) => (
                <div key={source.name} className="flex items-start gap-3">
                  <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <source.icon className="size-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium">{source.name}</p>
                      <span
                        className={`text-[10px] ${source.state === 'Ready' ? 'text-success-text' : 'text-warning-text'}`}
                      >
                        {source.state}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                      {source.detail}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-emerald-400/15">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-success-text" /> Audience
                guardrails
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs leading-5 text-muted-foreground">
              <p className="flex gap-2">
                <CheckCircle2 className="mt-1 size-3 shrink-0 text-success-text" />
                Sync only contacts with valid, source-specific marketing
                consent.
              </p>
              <p className="flex gap-2">
                <UserRoundCheck className="mt-1 size-3 shrink-0 text-success-text" />
                Suppress booked, opted-out and recently converted contacts.
              </p>
              <p className="flex gap-2">
                <Repeat2 className="mt-1 size-3 shrink-0 text-success-text" />
                Cap frequency and record every membership change in an audit
                log.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
