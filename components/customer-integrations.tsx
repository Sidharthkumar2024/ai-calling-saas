'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  BookOpenText,
  CheckCircle2,
  Copy,
  KeyRound,
  Link2,
  Loader2,
  LockKeyhole,
  Plus,
  ShieldCheck,
  Webhook,
} from 'lucide-react';
import {
  siAnthropic,
  siGoogleads,
  siGooglesheets,
  siHubspot,
  siMake,
  siMeta,
  siN8n,
  siRazorpay,
  siShopify,
  siWhatsapp,
  siZapier,
} from 'simple-icons';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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

type ConnectionForm = {
  type: string;
  name: string;
  baseUrl: string;
  accountId: string;
  apiKey: string;
  webhookSecret: string;
};
type WebhookForm = { name: string; url: string };

export function CustomerIntegrations({
  integrations,
  apiKeys,
  webhooks,
  onChanged,
}: {
  integrations: IntegrationsData;
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
  const [connection, setConnection] = useState<ConnectionForm>({
    type: 'willow_custom',
    name: 'Willow / Custom HTTP',
    baseUrl: '',
    accountId: '',
    apiKey: '',
    webhookSecret: '',
  });
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
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300/80">
            Developer platform
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Integrations, API keys and webhooks
          </h1>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-white/38 sm:text-sm">
            Connect lead sources, CRM and carrier APIs while every secret stays
            encrypted and every API key is stored hash-only.
          </p>
        </div>
        <Link
          href="/docs"
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-white/10 px-4 text-xs text-white/68 hover:bg-white/5"
        >
          <BookOpenText className="size-4" /> Open API docs
        </Link>
      </div>

      <div className="flex w-fit rounded-xl border border-white/8 bg-[#0e1119] p-1">
        {(['connections', 'keys', 'webhooks'] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={`rounded-lg px-4 py-2 text-[10px] capitalize ${tab === item ? 'bg-white/9 text-white' : 'text-white/38'}`}
          >
            {item === 'keys' ? 'API keys' : item}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-xl border border-red-400/15 bg-red-400/5 p-3 text-xs text-red-100">
          {error}
        </div>
      ) : null}
      {revealedSecret ? (
        <div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.035] p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-amber-100">
            <KeyRound className="size-4" /> Copy this value now
          </div>
          <div className="mt-3 flex gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-black/25 px-3 py-2.5 text-[10px] text-amber-100">
              {revealedSecret}
            </code>
            <Button
              size="icon-sm"
              variant="outline"
              className="border-white/10 bg-transparent"
              onClick={() => navigator.clipboard.writeText(revealedSecret)}
              aria-label="Copy secret"
            >
              <Copy />
            </Button>
          </div>
        </div>
      ) : null}

      {tab === 'connections' ? (
        <Connections
          data={integrations}
          form={connection}
          setForm={setConnection}
          loading={loading}
          save={() => post('/api/app/integrations', connection)}
        />
      ) : null}
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

function Connections({
  data,
  form,
  setForm,
  loading,
  save,
}: {
  data: IntegrationsData;
  form: ConnectionForm;
  setForm: (value: ConnectionForm) => void;
  loading: boolean;
  save: () => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
      <section className="rounded-2xl border border-white/8 bg-[#0e1119] p-5">
        <h2 className="text-sm font-semibold">Configured connections</h2>
        <p className="mt-1 text-[10px] text-white/32">
          Customer-safe labels only
        </p>
        <div className="mt-5 space-y-3">
          {(data.integrations ?? []).map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-3 rounded-xl border border-white/7 bg-white/[0.02] p-4"
            >
              <BrandIcon type={item.type} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{item.name}</p>
                <p className="mt-1 text-[9px] uppercase tracking-wider text-white/28">
                  {item.type.replaceAll('_', ' ')} ·{' '}
                  {item.has_secret ? 'secret stored' : 'no credentials'}
                </p>
              </div>
              <Status value={item.status} />
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-2xl border border-white/8 bg-[#0e1119] p-5">
        <h2 className="text-sm font-semibold">Connect an API</h2>
        <p className="mt-1 text-[10px] leading-4 text-white/32">
          Willow stays on the generic adapter until its official calling API
          base URL and auth scheme are supplied.
        </p>
        <div className="mt-5 space-y-4">
          <div className="flex items-center gap-3 rounded-xl border border-white/7 bg-white/[0.02] p-3">
            <BrandIcon type={form.type} />
            <div>
              <p className="text-xs font-medium">{form.name}</p>
              <p className="mt-1 text-[9px] text-white/28">
                Official product mark where available
              </p>
            </div>
          </div>
          <label
            htmlFor="connector-type"
            className="block text-xs text-white/50"
          >
            Connector
          </label>
          <select
            id="connector-type"
            aria-label="Connector"
            value={form.type}
            onChange={(event) =>
              setForm({
                ...form,
                type: event.target.value,
                name: event.target.options[event.target.selectedIndex].text,
              })
            }
            className="h-10 w-full rounded-lg border border-white/8 bg-[#121620] px-3 text-xs"
          >
            <optgroup label="Voice & intelligence">
              <option value="sarvam_voice">Vaani Voice · India engine</option>
              <option value="elevenlabs_voice">
                ElevenLabs · multilingual voice
              </option>
              <option value="openai_platform">
                OpenAI · Realtime & reasoning
              </option>
              <option value="anthropic_reasoning">
                Vaani Sense · reasoning
              </option>
            </optgroup>
            <optgroup label="Telephony">
              <option value="telephony_exotel">Exotel</option>
              <option value="telephony_plivo">Plivo</option>
              <option value="telephony_twilio">Twilio</option>
              <option value="telephony_vobiz">Vobiz</option>
              <option value="telephony_telnyx">Telnyx</option>
              <option value="telephony_vonage">Vonage</option>
              <option value="telephony_byoc">SIP / Enterprise BYOT</option>
            </optgroup>
            <optgroup label="CRM & automation">
              <option value="hubspot">HubSpot</option>
              <option value="salesforce">Salesforce</option>
              <option value="zoho">Zoho CRM</option>
              <option value="pipedrive">Pipedrive</option>
              <option value="calcom">Cal.com</option>
              <option value="zapier">Zapier</option>
              <option value="make">Make</option>
              <option value="n8n">n8n</option>
              <option value="google_sheets">Google Sheets</option>
              <option value="crm">Custom CRM</option>
            </optgroup>
            <optgroup label="Revenue & messaging">
              <option value="razorpay">Razorpay payment links</option>
              <option value="stripe">Stripe billing</option>
              <option value="whatsapp_cloud">WhatsApp Cloud API</option>
              <option value="aisensy">AiSensy</option>
              <option value="resend">Resend email</option>
              <option value="shopify">Shopify</option>
            </optgroup>
            <optgroup label="Lead sources & custom">
              <option value="meta_ads">Meta Lead Ads</option>
              <option value="google_ads">Google Ads</option>
              <option value="willow_custom">Willow / Custom HTTP</option>
            </optgroup>
          </select>
          <label
            htmlFor="connector-url"
            className="block text-xs text-white/50"
          >
            API base URL
          </label>
          <Input
            id="connector-url"
            value={form.baseUrl}
            onChange={(event) =>
              setForm({ ...form, baseUrl: event.target.value })
            }
            placeholder="https://api.vendor.example/v1"
            className="h-10 border-white/8 bg-white/[0.025]"
          />
          <label
            htmlFor="connector-account"
            className="block text-xs text-white/50"
          >
            {form.type === 'elevenlabs_voice'
              ? 'Voice ID'
              : form.type === 'openai_platform'
                ? 'Model override'
                : 'Account / workspace ID'}
          </label>
          <Input
            id="connector-account"
            value={form.accountId}
            onChange={(event) =>
              setForm({ ...form, accountId: event.target.value })
            }
            placeholder={
              form.type === 'elevenlabs_voice'
                ? 'Required voice ID'
                : form.type === 'openai_platform'
                  ? 'Optional · defaults to platform model'
                  : 'Optional account identifier'
            }
            className="h-10 border-white/8 bg-white/[0.025]"
          />
          <label
            htmlFor="connector-key"
            className="block text-xs text-white/50"
          >
            API key / token
          </label>
          <Input
            id="connector-key"
            type="password"
            value={form.apiKey}
            onChange={(event) =>
              setForm({ ...form, apiKey: event.target.value })
            }
            placeholder="Stored with AES-GCM encryption"
            className="h-10 border-white/8 bg-white/[0.025]"
          />
          {form.type === 'razorpay' || form.type === 'whatsapp_cloud' ? (
            <>
              <label
                htmlFor="connector-webhook-secret"
                className="block text-xs text-white/50"
              >
                Webhook signing secret
              </label>
              <Input
                id="connector-webhook-secret"
                type="password"
                value={form.webhookSecret}
                onChange={(event) =>
                  setForm({ ...form, webhookSecret: event.target.value })
                }
                placeholder="Used only for signature verification"
                className="h-10 border-white/8 bg-white/[0.025]"
              />
            </>
          ) : null}
          <Button
            onClick={save}
            disabled={loading}
            className="w-full bg-amber-300 text-[#17120a] hover:bg-amber-200"
          >
            {loading ? <Loader2 className="animate-spin" /> : <LockKeyhole />}{' '}
            Encrypt and save
          </Button>
        </div>
      </section>
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
      <section className="overflow-hidden rounded-2xl border border-white/8 bg-[#0e1119] p-5">
        <h2 className="text-sm font-semibold">API keys</h2>
        <p className="mt-1 text-[10px] text-white/32">
          Keys are visible once, then only their hash and prefix remain
        </p>
        <div className="mt-4 divide-y divide-white/7">
          {(data.apiKeys ?? []).map((item) => (
            <div key={item.id} className="flex items-center gap-3 py-4">
              <span className="grid size-9 place-items-center rounded-xl bg-amber-300/8">
                <KeyRound className="size-4 text-amber-200" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{item.name}</p>
                <p className="mt-1 font-mono text-[9px] text-white/30">
                  {item.key_prefix}•••••• ·{' '}
                  {safeStringList(item.scopes_json).join(', ')}
                </p>
              </div>
              <Status value={item.revoked_at ? 'revoked' : 'active'} />
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-2xl border border-white/8 bg-[#0e1119] p-5">
        <h2 className="text-sm font-semibold">Create scoped key</h2>
        <p className="mt-1 text-[10px] text-white/32">
          Use separate keys per website, server or integration
        </p>
        <label
          htmlFor="api-key-name"
          className="mt-5 block text-xs text-white/50"
        >
          Key name
        </label>
        <Input
          id="api-key-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="mt-2 h-10 border-white/8 bg-white/[0.025]"
        />
        <div className="mt-4 space-y-2">
          {['leads:write', 'leads:read', 'credits:read'].map((scope) => (
            <div
              key={scope}
              className="flex items-center gap-2 rounded-lg bg-white/[0.025] px-3 py-2.5 text-[10px] text-white/48"
            >
              <CheckCircle2 className="size-3.5 text-emerald-300" /> {scope}
            </div>
          ))}
        </div>
        <Button
          onClick={create}
          disabled={loading}
          className="mt-5 w-full bg-amber-300 text-[#17120a] hover:bg-amber-200"
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
      <section className="rounded-2xl border border-white/8 bg-[#0e1119] p-5">
        <h2 className="text-sm font-semibold">Webhook endpoints</h2>
        <p className="mt-1 text-[10px] text-white/32">
          Signed with HMAC SHA-256 and delivery attempts logged
        </p>
        <div className="mt-4 space-y-3">
          {(data.webhooks ?? []).map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-3 rounded-xl border border-white/7 bg-white/[0.02] p-4"
            >
              <span className="grid size-9 place-items-center rounded-xl bg-cyan-300/8">
                <Webhook className="size-4 text-cyan-200" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{item.name}</p>
                <p className="mt-1 truncate font-mono text-[9px] text-white/30">
                  {item.url}
                </p>
                <p className="mt-1 text-[9px] text-white/25">
                  {safeStringList(item.events_json).join(' · ')}
                </p>
              </div>
              <Status value={item.status} />
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-2xl border border-white/8 bg-[#0e1119] p-5">
        <h2 className="text-sm font-semibold">Add endpoint</h2>
        <label
          htmlFor="webhook-name"
          className="mt-5 block text-xs text-white/50"
        >
          Name
        </label>
        <Input
          id="webhook-name"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          className="mt-2 h-10 border-white/8 bg-white/[0.025]"
        />
        <label
          htmlFor="webhook-url"
          className="mt-4 block text-xs text-white/50"
        >
          HTTPS endpoint
        </label>
        <Input
          id="webhook-url"
          value={form.url}
          onChange={(event) => setForm({ ...form, url: event.target.value })}
          className="mt-2 h-10 border-white/8 bg-white/[0.025]"
        />
        <div className="mt-4 rounded-xl border border-white/7 bg-white/[0.02] p-3 text-[10px] leading-4 text-white/36">
          <ShieldCheck className="mb-2 size-4 text-emerald-300" /> Localhost
          HTTP is accepted in development. Production endpoints must use HTTPS.
        </div>
        <Button
          onClick={create}
          disabled={loading}
          className="mt-5 w-full bg-amber-300 text-[#17120a] hover:bg-amber-200"
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
      className={`${positive ? 'border-emerald-400/15 text-emerald-300' : warning ? 'border-amber-300/15 text-amber-200' : 'border-white/10 text-white/42'} text-[8px]`}
    >
      {value.replaceAll('_', ' ')}
    </Badge>
  );
}

const brandIcons: Record<string, { path: string; hex: string; title: string }> =
  {
    razorpay: siRazorpay,
    whatsapp_cloud: siWhatsapp,
    meta_ads: siMeta,
    google_ads: siGoogleads,
    hubspot: siHubspot,
    shopify: siShopify,
    zapier: siZapier,
    n8n: siN8n,
    google_sheets: siGooglesheets,
    make: siMake,
    anthropic_reasoning: siAnthropic,
  };

function BrandIcon({ type }: { type: string }) {
  const icon = brandIcons[type];
  if (!icon)
    return (
      <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/8 bg-white/[0.035]">
        <Link2 className="size-4 text-violet-200" />
      </span>
    );
  return (
    <span
      className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/8 bg-white/[0.94]"
      title={icon.title}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-5"
        style={{ fill: `#${icon.hex}` }}
      >
        <path d={icon.path} />
      </svg>
      <span className="sr-only">{icon.title} logo</span>
    </span>
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
