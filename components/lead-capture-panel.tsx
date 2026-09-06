'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  BrainCircuit,
  CheckCircle2,
  Code2,
  Copy,
  Globe2,
  LoaderCircle,
  Megaphone,
  PhoneCall,
  RefreshCw,
  Search,
  ShoppingCart,
  Upload,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type LeadSourceType = 'meta_ads' | 'google_ads' | 'website_form' | 'manual';

type Lead = {
  id: string;
  name: string;
  phone: string;
  campaignName: string | null;
  productInterest: string | null;
  status: string;
  score: number;
  intent: string;
  aiSummary: string;
  capturedAt: string;
  sourceType: LeadSourceType;
  sourceName: string;
};

type LeadForm = {
  id: string;
  name: string;
  publicKey: string;
  status: string;
  embedEndpoint: string;
};

type LeadConnection = {
  type: LeadSourceType;
  name: string;
  status: string;
  webhookEndpoint: string | null;
};

type LeadResponse = {
  tenant: {
    organizationId: string;
    organizationName: string;
    organizationSlug: string;
    role: 'admin' | 'user';
  };
  leads: Lead[];
  forms: LeadForm[];
  connections: LeadConnection[];
  stats: {
    total: number;
    qualified: number;
    queuedCalls: number;
    opportunities: number;
    pipelineValue: number;
    segments: Partial<Record<LeadSourceType, number>>;
  };
};

const sourceDetails: Record<
  LeadSourceType,
  { label: string; description: string; icon: typeof Megaphone; tone: string }
> = {
  meta_ads: {
    label: 'Meta Lead Ads',
    description: 'Facebook & Instagram instant forms',
    icon: Megaphone,
    tone: 'bg-violet-400/12 text-violet-700',
  },
  google_ads: {
    label: 'Google Ads',
    description: 'Search & lead form campaigns',
    icon: Search,
    tone: 'bg-sky-400/12 text-sky-700',
  },
  website_form: {
    label: 'Website forms',
    description: 'Popup and landing-page enquiries',
    icon: Globe2,
    tone: 'bg-emerald-400/12 text-success-text',
  },
  manual: {
    label: 'Manual / CSV',
    description: 'Imports and sales-team entries',
    icon: Upload,
    tone: 'bg-amber-400/12 text-warning-text',
  },
};

const pipelineSteps = [
  {
    label: 'Lead captured',
    description: 'Ads, website or CSV',
    icon: Megaphone,
  },
  {
    label: 'AI understands',
    description: 'Intent, score and summary',
    icon: BrainCircuit,
  },
  {
    label: 'Call queued',
    description: 'Personalized AI conversation',
    icon: PhoneCall,
  },
  {
    label: 'Sale generated',
    description: 'CRM opportunity or booking',
    icon: ShoppingCart,
  },
];

export function LeadCapturePanel({
  onNotice,
}: {
  onNotice: (message: string) => void;
}) {
  const [data, setData] = useState<LeadResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState<LeadSourceType | null>(null);

  const loadLeads = useCallback(async () => {
    try {
      const response = await fetch('/api/leads', { cache: 'no-store' });
      const payload = (await response.json()) as LeadResponse & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? 'Lead workspace could not be loaded.');
      }
      setData(payload);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Lead workspace could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;

    fetchLeadData()
      .then((payload) => {
        if (!ignore) setData(payload);
      })
      .catch((loadError: unknown) => {
        if (!ignore) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Lead workspace could not be loaded.',
          );
        }
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, []);

  async function simulateLead(sourceType: LeadSourceType) {
    setSimulating(sourceType);
    setError('');
    try {
      const label = sourceDetails[sourceType].label;
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceType,
          name: sourceType === 'google_ads' ? 'Ananya Verma' : 'Vikram Singh',
          phone:
            sourceType === 'google_ads' ? '+91 98910 44281' : '+91 98102 77854',
          email:
            sourceType === 'google_ads'
              ? 'ananya@example.com'
              : 'vikram@example.com',
          campaignName: `${label} · Product enquiry`,
          productInterest: 'Premium 3BHK property',
          notes:
            'Asked for current price and wants to book a site visit this week.',
          estimatedValue: 11_500_000,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        lead?: { score: number };
      };
      if (!response.ok)
        throw new Error(payload.error ?? 'Lead capture failed.');
      await loadLeads();
      onNotice(
        `${label} lead captured, AI-qualified at ${payload.lead?.score ?? 0}/100 and queued for calling.`,
      );
    } catch (simulationError) {
      setError(
        simulationError instanceof Error
          ? simulationError.message
          : 'Lead capture failed.',
      );
    } finally {
      setSimulating(null);
    }
  }

  async function copyText(value: string, label: string) {
    await navigator.clipboard.writeText(`${window.location.origin}${value}`);
    onNotice(`${label} copied to clipboard.`);
  }

  if (loading) {
    return (
      <Card className="min-h-[420px]">
        <CardContent className="grid min-h-[420px] place-items-center">
          <div className="text-center">
            <LoaderCircle className="mx-auto mb-3 size-6 animate-spin text-primary" />
            <p className="text-sm font-medium">Loading tenant CRM</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Connecting lead sources, AI queue and pipeline…
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Lead engine unavailable</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => void loadLeads()}>
            <RefreshCw /> Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  const form = data.forms[0];

  return (
    <div className="space-y-5 xl:space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1.5 text-xs font-medium text-primary">
            Omnichannel lead engine
          </p>
          <h2 className="text-2xl font-semibold tracking-[-0.025em] sm:text-[28px]">
            Capture → understand → call → sell
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Meta, Google and website leads enter one tenant-isolated CRM. AI
            scores every enquiry, prepares the conversation and queues the next
            sales action.
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadLeads()}>
          <RefreshCw /> Refresh
        </Button>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          [
            'Captured leads',
            data.stats.total.toLocaleString('en-IN'),
            'All active sources',
          ],
          [
            'AI-qualified',
            data.stats.qualified.toLocaleString('en-IN'),
            'Score 75 or higher',
          ],
          [
            'Calls queued',
            data.stats.queuedCalls.toLocaleString('en-IN'),
            'Personalized call brief ready',
          ],
          [
            'Sales pipeline',
            formatCurrency(data.stats.pipelineValue),
            `${data.stats.opportunities} opportunities`,
          ],
        ].map(([label, value, note]) => (
          <Card key={label} size="sm" className="metric-card">
            <CardHeader>
              <CardDescription className="text-xs">{label}</CardDescription>
              <CardTitle className="pt-2 font-mono text-2xl font-semibold tracking-tight">
                {value}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-[11px] text-muted-foreground">
              {note}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-primary/18 bg-[linear-gradient(100deg,color-mix(in_oklab,var(--primary)_8%,var(--card)),var(--card)_66%)]">
        <CardHeader>
          <CardTitle>Automated revenue workflow</CardTitle>
          <CardDescription>
            Every source follows the same auditable lead lifecycle.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            {pipelineSteps.map((step, index) => (
              <div
                key={step.label}
                className="relative rounded-xl border border-border/75 bg-background/55 p-4"
              >
                <div className="mb-4 flex items-center justify-between">
                  <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                    <step.icon className="size-4" />
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    0{index + 1}
                  </span>
                </div>
                <p className="text-sm font-medium">{step.label}</p>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Lead segments</CardTitle>
            <CardDescription>
              Performance grouped by acquisition source
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(sourceDetails) as LeadSourceType[]).map((type) => {
              const source = sourceDetails[type];
              return (
                <div
                  key={type}
                  className="flex items-center gap-3 rounded-xl border border-border/70 p-3.5"
                >
                  <span
                    className={`grid size-10 place-items-center rounded-xl ${source.tone}`}
                  >
                    <source.icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{source.label}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {source.description}
                    </p>
                  </div>
                  <span className="font-mono text-lg font-semibold">
                    {data.stats.segments[type] ?? 0}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ad source connections</CardTitle>
            <CardDescription>
              Endpoints are ready; connect channel credentials to go live.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.connections
              .filter((connection) =>
                ['meta_ads', 'google_ads'].includes(connection.type),
              )
              .map((connection) => (
                <div
                  key={connection.type}
                  className="rounded-xl border border-border/70 p-3.5"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`grid size-9 place-items-center rounded-lg ${sourceDetails[connection.type].tone}`}
                    >
                      {connection.type === 'meta_ads' ? (
                        <Megaphone className="size-4" />
                      ) : (
                        <Search className="size-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{connection.name}</p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {connection.webhookEndpoint}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className="border-amber-400/20 bg-amber-400/8 text-warning-text"
                    >
                      Credentials needed
                    </Badge>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => void simulateLead(connection.type)}
                      disabled={simulating !== null}
                    >
                      {simulating === connection.type ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <CheckCircle2 />
                      )}
                      Test lead
                    </Button>
                    {connection.webhookEndpoint ? (
                      <Button
                        size="icon-sm"
                        variant="outline"
                        aria-label={`Copy ${connection.name} webhook`}
                        onClick={() =>
                          void copyText(
                            connection.webhookEndpoint!,
                            'Webhook URL',
                          )
                        }
                      >
                        <Copy />
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(340px,0.7fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Unified CRM leads</CardTitle>
            <CardDescription>
              Latest AI-enriched enquiries across every channel
            </CardDescription>
            <CardAction>
              <Badge variant="secondary">Live D1 data</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-4">Lead</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>AI score</TableHead>
                  <TableHead>Intent</TableHead>
                  <TableHead className="pr-4">Next state</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.leads.slice(0, 8).map((lead) => (
                  <TableRow key={lead.id} title={lead.aiSummary}>
                    <TableCell className="px-4 py-3">
                      <p className="font-medium">{lead.name}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {lead.productInterest ??
                          lead.campaignName ??
                          lead.phone}
                      </p>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs">
                        {sourceDetails[lead.sourceType].label}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`font-mono text-sm font-semibold ${lead.score >= 75 ? 'text-success-text' : 'text-warning-text'}`}
                      >
                        {lead.score}/100
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {humanize(lead.intent)}
                    </TableCell>
                    <TableCell className="pr-4">
                      <Badge
                        variant="outline"
                        className={
                          lead.status === 'qualified'
                            ? 'border-emerald-400/20 bg-emerald-400/8 text-success-text'
                            : 'border-border text-muted-foreground'
                        }
                      >
                        {lead.status === 'qualified'
                          ? 'Call queued'
                          : humanize(lead.status)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Website popup form</CardTitle>
            <CardDescription>
              Send your landing-page enquiries straight into this CRM.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {form ? (
              <>
                <div className="rounded-xl border border-border/70 bg-muted/30 p-3.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{form.name}</p>
                    <Badge
                      variant="outline"
                      className="border-emerald-400/20 bg-emerald-400/8 text-success-text"
                    >
                      Active
                    </Badge>
                  </div>
                  <p className="break-all font-mono text-[11px] leading-5 text-muted-foreground">
                    POST {form.embedEndpoint}
                  </p>
                </div>
                <div className="rounded-xl border border-border/70 bg-background p-3.5">
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium">
                    <Code2 className="size-3.5 text-primary" /> Embed payload
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-5 text-muted-foreground">
                    {`{
  "name": "{{name}}",
  "phone": "{{phone}}",
  "email": "{{email}}",
  "productInterest": "{{interest}}"
}`}
                  </pre>
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    void copyText(form.embedEndpoint, 'Form endpoint')
                  }
                >
                  <Copy /> Copy form endpoint
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No active form is configured for this workspace.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

async function fetchLeadData() {
  const response = await fetch('/api/leads', { cache: 'no-store' });
  const payload = (await response.json()) as LeadResponse & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? 'Lead workspace could not be loaded.');
  }
  return payload;
}

function humanize(value: string) {
  return value
    .replaceAll('_', ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}
