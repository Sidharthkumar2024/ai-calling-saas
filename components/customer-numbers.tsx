'use client';
import { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  PhoneCall,
  PlugZap,
  Route,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProviderLogo } from '@/components/provider-logo';
import {
  NUMBER_PROVIDERS,
  numberConnectionLabel,
} from '@/lib/number-connection';

export type NumberRow = {
  id: string;
  phone_number: string;
  provider_code: string;
  connection_mode: string;
  assigned_agent_name?: string | null;
  direction: string;
  status: string;
  onboarding_status?: string;
  acquisition_type?: string;
  public_provider_name?: string;
};
export type CustomerNumbersData = { numbers?: NumberRow[] };

export function CustomerNumbers({
  data,
  onChanged,
  onNavigate,
}: {
  data: CustomerNumbersData;
  onChanged: () => Promise<void>;
  onNavigate?: (page: string) => void;
}) {
  const [phone, setPhone] = useState('');
  const [provider, setProvider] = useState('twilio');
  const [direction, setDirection] = useState('inbound_outbound');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const numbers = data.numbers ?? [];
  async function submit(numberId?: string) {
    setBusy(numberId ?? 'save');
    setError('');
    setNotice('');
    try {
      const response = await fetch(
        numberId ? '/api/app/numbers/verify' : '/api/app/numbers',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            numberId
              ? { numberId }
              : {
                  action: 'connect',
                  phoneNumber: phone,
                  providerCode: provider,
                  direction,
                  connectionMode:
                    provider === 'sip' ? 'sip_trunk' : 'native_import',
                },
          ),
        },
      );
      const result = (await response.json()) as {
        error?: string;
        nextStep?: string;
      };
      if (!response.ok)
        throw new Error(result.error || 'Could not save this connection.');
      setNotice(result.nextStep || 'Connection saved.');
      if (!numberId) setPhone('');
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection request failed.');
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-widest text-ink-muted">
          Bring your own carrier
        </p>
        <h1 className="mt-2 text-3xl font-semibold">
          Your numbers. Your sales team.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-muted">
          Connect an existing business number to Call Vani. Your provider
          handles number purchase, rental and verification; Call Vani handles AI
          agents, conversations and follow-up.
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-3">
        {[
          {
            icon: PlugZap,
            title: '1. Connect your provider',
            note: 'Add your carrier credentials in Integrations.',
            page: 'integrations',
          },
          {
            icon: PhoneCall,
            title: '2. Add an existing number',
            note: 'Check ownership against your provider account.',
            page: null,
          },
          {
            icon: Route,
            title: '3. Set up call routing',
            note: 'Assign an agent and configure inbound routes.',
            page: 'org_structure',
          },
        ].map((step) => (
          <section
            key={step.title}
            className="rounded-2xl border border-hairline bg-surface p-5"
          >
            <step.icon className="size-5 text-primary" />
            <h2 className="mt-4 text-sm font-semibold">{step.title}</h2>
            <p className="mt-2 text-xs leading-5 text-ink-muted">{step.note}</p>
            {step.page && onNavigate ? (
              <Button
                variant="ghost"
                className="mt-3 px-0"
                onClick={() => onNavigate(step.page!)}
              >
                Open <ArrowRight />
              </Button>
            ) : null}
          </section>
        ))}
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {notice && (
        <output
          className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800"
        >
          {notice}
        </output>
      )}
      <div className="grid items-start gap-6 xl:grid-cols-[0.85fr_1.4fr]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-5 rounded-2xl border border-hairline bg-surface p-5 sm:p-6"
        >
          <h2 className="text-lg font-semibold">Add your number</h2>
          <label className="block space-y-2 text-sm">
            <span>Carrier</span>
            <select
              aria-label="Carrier"
              className="h-11 w-full rounded-lg border border-hairline bg-surface px-3"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              {NUMBER_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <div className="space-y-2 text-sm">
            <label htmlFor="customer-phone-number">Business phone number</label>
            <Input
              id="customer-phone-number"
              type="tel"
              autoComplete="tel"
              required
              placeholder="+919876543210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <label className="block space-y-2 text-sm">
            <span>Call direction</span>
            <select
              aria-label="Call direction"
              className="h-11 w-full rounded-lg border border-hairline bg-surface px-3"
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
            >
              <option value="inbound_outbound">Inbound & outbound</option>
              <option value="inbound">Inbound only</option>
              <option value="outbound">Outbound only</option>
            </select>
          </label>
          <p className="text-xs leading-5 text-ink-muted">
            Adding a number saves its configuration. It becomes usable only
            after provider verification and routing are ready. No number is
            purchased by this action.
          </p>
          <Button type="submit" disabled={Boolean(busy)} className="w-full">
            {busy === 'save' ? (
              <Loader2 className="animate-spin" />
            ) : (
              <PhoneCall />
            )}{' '}
            Save connection
          </Button>
        </form>
        <section className="overflow-hidden rounded-2xl border border-hairline bg-surface">
          <div className="border-b border-hairline p-5">
            <h2 className="text-lg font-semibold">
              Connected numbers{' '}
              <span className="text-ink-muted">{numbers.length}</span>
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              Provider charges are billed directly by your carrier.
            </p>
          </div>
          {!numbers.length ? (
            <div className="p-10 text-center">
              <PhoneCall className="mx-auto size-8 text-ink-muted" />
              <p className="mt-4 font-medium">Connect your first sales line</p>
              <p className="mt-2 text-sm text-ink-muted">
                Start with your existing carrier account.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-hairline">
              {numbers.map((n) => (
                <article key={n.id} className="space-y-4 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <ProviderLogo provider={n.provider_code} />
                      <div>
                        <h3 className="font-semibold">{n.phone_number}</h3>
                        <p className="mt-1 text-xs capitalize text-ink-muted">
                          {n.provider_code} · {n.direction.replaceAll('_', ' ')}
                        </p>
                      </div>
                    </div>
                    <span className="rounded-full border border-hairline px-3 py-1 text-xs">
                      {numberConnectionLabel(n.status)}
                    </span>
                  </div>
                  <p className="text-xs text-ink-muted">
                    {n.assigned_agent_name ||
                      'Assign an agent in Org & routing after connecting your provider.'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={Boolean(busy)}
                      onClick={() => void submit(n.id)}
                    >
                      {busy === n.id ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <CheckCircle2 />
                      )}{' '}
                      Check provider ownership
                    </Button>
                    {onNavigate && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          onNavigate(
                            n.provider_code === 'sip'
                              ? 'sip_trunks'
                              : 'org_structure',
                          )
                        }
                      >
                        Configure routing <ArrowRight />
                      </Button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
