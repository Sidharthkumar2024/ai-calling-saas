'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  BookOpenText,
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  ShieldCheck,
  Webhook,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CustomerIntegrationMarketplace } from '@/components/customer-integration-marketplace';

type IntegrationRow = {
  id: string;
  type: string;
  name: string;
  status: string;
  has_secret: number;
};
type ApiKeyRow = {
  id: string;
  name: string;
  key_prefix: string;
  scopes_json: string;
  revoked_at?: string | null;
};
type WebhookRow = {
  id: string;
  name: string;
  url: string;
  events_json: string;
  status: string;
};

export type IntegrationsData = { integrations?: IntegrationRow[] };
export type ApiKeysData = { apiKeys?: ApiKeyRow[] };
export type WebhooksData = { webhooks?: WebhookRow[] };

type WebhookForm = { name: string; url: string };

export function CustomerIntegrations({
  apiKeys,
  webhooks,
  onChanged,
}: {
  apiKeys: ApiKeysData;
  webhooks: WebhooksData;
  onChanged: () => Promise<void>;
}) {
  const [tab, setTab] = useState<'connections' | 'keys' | 'webhooks'>(
    'connections',
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revealedSecret, setRevealedSecret] = useState('');
  const [keyName, setKeyName] = useState('Website lead capture');
  const [webhookForm, setWebhookForm] = useState<WebhookForm>({
    name: 'CRM lead updates',
    url: 'http://localhost:4000/webhooks/vaani',
  });

  async function post(url: string, body: Record<string, unknown>) {
    setLoading(true);
    setError('');
    setRevealedSecret('');
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        error?: string;
        apiKey?: string;
        signingSecret?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to save configuration.');
      }
      setRevealedSecret(
        payload.apiKey ??
          payload.signingSecret ??
          payload.message ??
          'Saved successfully.',
      );
      await onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to save configuration.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-warning-text">
            Developer platform
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Integrations, API keys and webhooks
          </h1>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-ink-muted sm:text-sm">
            Connect lead sources, CRM and carrier APIs while every secret stays
            encrypted and every API key is stored hash-only.
          </p>
        </div>
        <Link
          href="/docs"
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-hairline px-4 text-xs text-ink-body hover:bg-surface-strong"
        >
          <BookOpenText className="size-4" /> Open API docs
        </Link>
      </div>

      <div className="flex w-fit rounded-xl border border-hairline bg-surface p-1">
        {(['connections', 'keys', 'webhooks'] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={`rounded-lg px-4 py-2 text-[11px] capitalize ${tab === item ? 'bg-surface-strong text-ink' : 'text-ink-muted'}`}
          >
            {item === 'keys' ? 'API keys' : item}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-xl border border-red-400/15 bg-red-400/5 p-3 text-xs text-danger-text">
          {error}
        </div>
      ) : null}
      {revealedSecret ? (
        <div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.035] p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-warning-text">
            <KeyRound className="size-4" /> Copy this value now
          </div>
          <div className="mt-3 flex gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-surface-muted px-3 py-2.5 text-[11px] text-warning-text">
              {revealedSecret}
            </code>
            <Button
              size="icon-sm"
              variant="outline"
              className="border-hairline bg-transparent"
              onClick={() => navigator.clipboard.writeText(revealedSecret)}
              aria-label="Copy secret"
            >
              <Copy />
            </Button>
          </div>
        </div>
      ) : null}

      {tab === 'connections' ? <CustomerIntegrationMarketplace /> : null}
      {tab === 'keys' ? (
        <ApiKeys
          data={apiKeys}
          name={keyName}
          setName={setKeyName}
          loading={loading}
          create={() =>
            post('/api/app/api-keys', {
              name: keyName,
              scopes: ['leads:write', 'leads:read', 'credits:read'],
            })
          }
        />
      ) : null}
      {tab === 'webhooks' ? (
        <Webhooks
          data={webhooks}
          form={webhookForm}
          setForm={setWebhookForm}
          loading={loading}
          create={() =>
            post('/api/app/webhooks', {
              ...webhookForm,
              events: ['lead.qualified', 'call.completed', 'credit.low'],
            })
          }
        />
      ) : null}
    </div>
  );
}

function ApiKeys({
  data,
  name,
  setName,
  loading,
  create,
}: {
  data: ApiKeysData;
  name: string;
  setName: (value: string) => void;
  loading: boolean;
  create: () => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <section className="overflow-hidden rounded-2xl border border-hairline bg-surface p-5">
        <h2 className="text-sm font-semibold">API keys</h2>
        <p className="mt-1 text-[11px] text-ink-muted">
          Keys are visible once, then only their hash and prefix remain
        </p>
        <div className="mt-4 divide-y divide-white/7">
          {(data.apiKeys ?? []).map((item) => (
            <div key={item.id} className="flex items-center gap-3 py-4">
              <span className="grid size-9 place-items-center rounded-xl bg-amber-300/8">
                <KeyRound className="size-4 text-warning-text" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{item.name}</p>
                <p className="mt-1 font-mono text-[11px] text-ink-muted">
                  {item.key_prefix}•••••• ·{' '}
                  {safeStringList(item.scopes_json).join(', ')}
                </p>
              </div>
              <Status value={item.revoked_at ? 'revoked' : 'active'} />
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-2xl border border-hairline bg-surface p-5">
        <h2 className="text-sm font-semibold">Create scoped key</h2>
        <p className="mt-1 text-[11px] text-ink-muted">
          Use separate keys per website, server or integration
        </p>
        <label
          htmlFor="api-key-name"
          className="mt-5 block text-xs text-ink-body"
        >
          Key name
        </label>
        <Input
          id="api-key-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="mt-2 h-10 border-hairline bg-surface-muted"
        />
        <div className="mt-4 space-y-2">
          {['leads:write', 'leads:read', 'credits:read'].map((scope) => (
            <div
              key={scope}
              className="flex items-center gap-2 rounded-lg bg-surface-muted px-3 py-2.5 text-[11px] text-ink-muted"
            >
              <CheckCircle2 className="size-3.5 text-success-text" /> {scope}
            </div>
          ))}
        </div>
        <Button
          onClick={create}
          disabled={loading}
          className="mt-5 w-full bg-primary text-primary-foreground hover:bg-[#1d4ed8]"
        >
          {loading ? <Loader2 className="animate-spin" /> : <Plus />} Create API
          key
        </Button>
      </section>
    </div>
  );
}

function Webhooks({
  data,
  form,
  setForm,
  loading,
  create,
}: {
  data: WebhooksData;
  form: WebhookForm;
  setForm: (value: WebhookForm) => void;
  loading: boolean;
  create: () => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <section className="rounded-2xl border border-hairline bg-surface p-5">
        <h2 className="text-sm font-semibold">Webhook endpoints</h2>
        <p className="mt-1 text-[11px] text-ink-muted">
          Signed with HMAC SHA-256 and delivery attempts logged
        </p>
        <div className="mt-4 space-y-3">
          {(data.webhooks ?? []).map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-3 rounded-xl border border-hairline bg-surface-muted p-4"
            >
              <span className="grid size-9 place-items-center rounded-xl bg-cyan-300/8">
                <Webhook className="size-4 text-cyan-700" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{item.name}</p>
                <p className="mt-1 truncate font-mono text-[11px] text-ink-muted">
                  {item.url}
                </p>
                <p className="mt-1 text-[11px] text-ink-muted">
                  {safeStringList(item.events_json).join(' · ')}
                </p>
              </div>
              <Status value={item.status} />
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-2xl border border-hairline bg-surface p-5">
        <h2 className="text-sm font-semibold">Add endpoint</h2>
        <label
          htmlFor="webhook-name"
          className="mt-5 block text-xs text-ink-body"
        >
          Name
        </label>
        <Input
          id="webhook-name"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          className="mt-2 h-10 border-hairline bg-surface-muted"
        />
        <label
          htmlFor="webhook-url"
          className="mt-4 block text-xs text-ink-body"
        >
          HTTPS endpoint
        </label>
        <Input
          id="webhook-url"
          value={form.url}
          onChange={(event) => setForm({ ...form, url: event.target.value })}
          className="mt-2 h-10 border-hairline bg-surface-muted"
        />
        <div className="mt-4 rounded-xl border border-hairline bg-surface-muted p-3 text-[11px] leading-4 text-ink-muted">
          <ShieldCheck className="mb-2 size-4 text-success-text" /> Localhost
          HTTP is accepted in development. Production endpoints must use HTTPS.
        </div>
        <Button
          onClick={create}
          disabled={loading}
          className="mt-5 w-full bg-primary text-primary-foreground hover:bg-[#1d4ed8]"
        >
          {loading ? <Loader2 className="animate-spin" /> : <Webhook />} Add
          signed webhook
        </Button>
      </section>
    </div>
  );
}

function Status({ value }: { value: string }) {
  const positive = ['active', 'connected'].some((item) => value.includes(item));
  const warning = ['pending', 'needs', 'test'].some((item) =>
    value.includes(item),
  );
  return (
    <Badge
      variant="outline"
      className={`${positive ? 'border-emerald-400/15 text-success-text' : warning ? 'border-amber-300/15 text-warning-text' : 'border-hairline text-ink-muted'} text-[11px]`}
    >
      {value.replaceAll('_', ' ')}
    </Badge>
  );
}

function safeStringList(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) &&
      parsed.every((item) => typeof item === 'string')
      ? parsed
      : [];
  } catch {
    return [];
  }
}
