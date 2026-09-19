'use client';
import { BillingModelSummary } from '@/components/billing-model-summary';
import { PricingReference } from '@/components/pricing-reference';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CreditCelebration } from '@/components/credit-celebration';
import { confirmedCreditReceipt, type CreditReceipt } from '@/lib/credit-feedback';
import { useNotifications } from '@/components/notification-center';
import {
  Check,
  CircleDollarSign,
  Coins,
  CreditCard,
  Download,
  Loader2,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

type Wallet = { balance: number; low_balance_threshold: number };
type Subscription = {
  id?: string;
  name?: string;
  status?: string;
  current_period_end?: string | null;
};
type CreditPackage = { id: string; credits: number; amount: number };
type Plan = {
  id: string;
  name: string;
  monthly_price: number;
  features_json?: string;
};
type Invoice = {
  id: string;
  invoice_number: string;
  issued_at: string;
  subtotal: number;
  tax: number;
  total: number;
  status: string;
};
type LedgerEntry = {
  amount: number;
  balance_after: number;
  description: string;
  created_at: string;
};
type UsageRate = {
  id: string;
  category: string;
  operation: string;
  label: string;
  unit: string;
  credits: number;
  costBasis: string;
  customerNote: string;
};
type PaymentMethod = {
  id: string;
  label: string;
  feeBps: number;
  gateway: string;
};

export type BillingData = {
  wallet?: Wallet;
  subscription?: Subscription;
  paymentMode?: string;
  creditPackages?: CreditPackage[];
  plans?: Plan[];
  usageRateCard?: { currency: string; rates: UsageRate[] };
  invoices?: Invoice[];
  ledger?: LedgerEntry[];
  paymentMethods?: PaymentMethod[];
};

export function CustomerBilling({
  data,
  onChanged,
}: {
  data: BillingData;
  onChanged: () => Promise<void>;
}) {
  const { notify } = useNotifications();
  const [loading, setLoading] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<CreditReceipt | null>(null);
  const [selectedMethod, setSelectedMethod] = useState('upi');
  const dismissReceipt = useCallback(() => setReceipt(null), []);
  const refreshRef = useRef(onChanged);
  const notifyRef = useRef(notify);
  useEffect(() => { refreshRef.current = onChanged; }, [onChanged]);
  useEffect(() => { notifyRef.current = notify; }, [notify]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('billing') !== 'success' || !params.get('session_id')) return;
    const sessionId = params.get('session_id')!;
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`/api/app/billing/confirmation?session_id=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
        if (cancelled) return;
        if (!response.ok) {
          if (response.status >= 500 || response.status === 429) throw new Error('Verification temporarily unavailable.');
          setMessage('Unable to verify this checkout. Check your invoices before purchasing again.'); return;
        }
        const confirmed = confirmedCreditReceipt(await response.json());
        if (cancelled) return;
        if (confirmed) {
          const seenKey = `vani.credit-receipt.${confirmed.invoiceId}`;
          let seen = false;
          try { seen = window.sessionStorage.getItem(seenKey) === 'shown'; window.sessionStorage.setItem(seenKey, 'shown'); } catch { /* Confirmation is still safe when local preferences are unavailable. */ }
          if (!seen) { if (confirmed.creditsAdded > 0) setReceipt(confirmed); notifyRef.current({ event: 'payment_success', subject: confirmed.invoiceId, scope: 'workspace', detail: 'Payment verified and invoice ready.' }); }
          setMessage('Payment verified. Your credits and invoice are ready.');
          params.delete('billing'); params.delete('session_id');
          window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
          void refreshRef.current();
          return;
        }
      } catch { /* A transient network failure can be retried without re-purchasing. */ }
      if (cancelled) return;
      setMessage('Waiting for payment verification. No need to purchase again.');
      if (++attempt < 20) timer = setTimeout(poll, 3000);
      else setMessage('Payment verification is still pending. Check your invoices shortly; do not purchase again.');
    };
    timer = setTimeout(poll, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);
  const wallet = data.wallet ?? { balance: 0, low_balance_threshold: 500 };
  const subscription = data.subscription ?? {};

  async function checkout(body: Record<string, unknown>, loadingKey: string) {
    setLoading(loadingKey);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/app/billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, paymentMethod: selectedMethod }),
      });
      const payload = (await response.json()) as {
        error?: string;
        checkoutUrl?: string;
        invoiceNumber?: string;
        completed?: boolean;
        invoiceId?: string;
        creditsAdded?: number;
        balance?: number;
        mode?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? 'Unable to start checkout.');
      if (payload.checkoutUrl) {
        window.location.assign(payload.checkoutUrl);
        return;
      }
      const confirmed = confirmedCreditReceipt(payload);
      if (!confirmed) throw new Error('Payment is not yet confirmed. Refresh billing to check its status; do not purchase again.');
      if (confirmed.creditsAdded > 0) setReceipt(confirmed);
      setMessage(
        `Local sandbox purchase complete. Invoice ${payload.invoiceNumber ?? 'created'} generated; no real money was charged.`,
      );
      notify({
        event: 'payment_success',
        subject: payload.invoiceNumber ?? undefined,
        scope: 'workspace',
        detail: `Invoice ${payload.invoiceNumber ?? 'created'}.`,
      });
      await onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to start checkout.',
      );
      // §3.2 names payment failure as an event that stays until somebody
      // acknowledges it — a top-up that silently failed is how a workspace
      // discovers it has no credits mid-campaign.
      notify({
        event: 'payment_failed',
        title: 'Checkout failed',
        scope: 'workspace',
        detail: caught instanceof Error ? caught.message : undefined,
      });
    } finally {
      setLoading('');
    }
  }

  return (
    <div className="vani-billing space-y-6">
      <PricingReference />
      {receipt ? <CreditCelebration key={receipt.invoiceId} receipt={receipt} onDismiss={dismissReceipt} /> : null}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-warning-text">
          Subscription and wallet
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          Billing, credits and invoices
        </h1>
        <p className="mt-2 max-w-3xl text-xs leading-5 text-ink-muted sm:text-sm">
          Plan limits, top-ups, usage deductions and tax invoices stay on one
          auditable ledger.
        </p>
      </div>
      {data.paymentMode === 'local_sandbox' ? (
        <div className="flex items-start gap-3 rounded-xl border border-cyan-300/12 bg-cyan-300/[0.035] p-4 text-xs text-cyan-700">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-cyan-700" />
          <div>
            <p className="font-medium">Local sandbox billing is active</p>
            <p className="mt-1 text-[11px] leading-4 text-ink-muted">
              Checkout buttons simulate a successful payment, add credits and
              generate invoices locally. Add Stripe keys to use hosted checkout
              and signed webhooks.
            </p>
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-red-400/15 bg-red-400/5 p-3 text-xs text-danger-text">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/5 p-3 text-xs text-success-text">
          {message}
        </div>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[0.7fr_1.3fr]">
        <section className="rounded-2xl border border-hairline bg-[linear-gradient(145deg,rgba(252,211,77,0.1),#ffffff_55%)] p-5">
          <div className="flex items-center justify-between">
            <span className="grid size-10 place-items-center rounded-xl bg-amber-300/12">
              <WalletCards className="size-4 text-warning-text" />
            </span>
            <Badge
              variant="outline"
              className="border-emerald-400/15 text-[11px] text-success-text"
            >
              {subscription.status || 'active'}
            </Badge>
          </div>
          <p className="mt-8 text-[11px] uppercase tracking-[0.14em] text-ink-muted">
            Available credits
          </p>
          <p className="mt-2 text-4xl font-semibold">{num(wallet.balance)}</p>
          <div className="mt-5">
            <div className="mb-2 flex justify-between text-[11px] text-ink-muted">
              <span>Low-balance alert</span>
              <span>{num(wallet.low_balance_threshold)}</span>
            </div>
            <Progress
              value={Math.min(100, Number(wallet.balance) / 300)}
              className="h-1 bg-surface-strong"
            />
          </div>
          <div className="mt-6 border-t border-hairline pt-4">
            <p className="text-xs font-medium">
              {subscription.name || 'Growth'} plan
            </p>
            <p className="mt-1 text-[11px] text-ink-muted">
              Renews {formatDate(subscription.current_period_end)}
            </p>
          </div>
        </section>
        <section className="rounded-2xl border border-hairline bg-surface p-5">
          <h2 className="text-sm font-semibold">Instant credit top-up</h2>
          <p className="mt-1 text-[11px] text-ink-muted">
            Credits are consumed by calling and AI usage
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {(data.creditPackages ?? []).map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-hairline bg-surface-muted p-4"
              >
                <Coins className="size-4 text-warning-text" />
                <p className="mt-4 text-lg font-semibold">
                  {num(item.credits)}
                </p>
                <p className="text-[11px] text-ink-muted">credits</p>
                <p className="mt-4 text-sm font-medium">{money(item.amount)}</p>
                <Button
                  onClick={() =>
                    checkout(
                      { purchaseType: 'credits', packageId: item.id },
                      item.id,
                    )
                  }
                  disabled={Boolean(loading)}
                  variant="outline"
                  className="mt-4 w-full border-hairline bg-transparent"
                >
                  {loading === item.id ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <CreditCard />
                  )}{' '}
                  Top up
                </Button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-hairline bg-surface p-5">
        <h2 className="text-sm font-semibold">Payment method</h2>
        <p className="mt-1 text-[11px] text-ink-muted">
          The convenience fee is disclosed before checkout and included in the final total.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(data.paymentMethods ?? []).map((method) => (
            <button
              key={method.id}
              type="button"
              onClick={() => setSelectedMethod(method.id)}
              className={`rounded-xl border p-4 text-left transition ${
                selectedMethod === method.id
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-hairline bg-surface-muted hover:bg-surface-strong'
              }`}
            >
              <p className="text-xs font-semibold">{method.label}</p>
              <p className="mt-1 text-[11px] text-ink-muted">
                {method.feeBps === 0
                  ? 'No convenience fee'
                  : `${(method.feeBps / 100).toFixed(1)}% convenience fee`}
              </p>
              <p className="mt-2 text-[10px] uppercase tracking-wider text-ink-muted">
                {method.gateway}
              </p>
            </button>
          ))}
        </div>
      </section>

      <div>
        <h2 className="text-sm font-semibold">Choose the right plan</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {(data.plans ?? []).map((plan) => {
            const current = plan.id === subscription.id;
            const features = safeStringList(plan.features_json);
            return (
              <section
                key={plan.id}
                className={`rounded-2xl border p-5 ${current ? 'border-amber-300/25 bg-amber-300/[0.045]' : 'border-hairline bg-surface'}`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-lg font-semibold">{plan.name}</p>
                  {current ? (
                    <Badge className="bg-primary text-[11px] text-primary-foreground">
                      Current
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-3 text-3xl font-semibold">
                  {money(plan.monthly_price)}
                  <span className="text-xs font-normal text-ink-muted">
                    {' '}
                    / mo
                  </span>
                </p>
                <div className="mt-5 space-y-2">
                  {features.map((feature) => (
                    <div
                      key={feature}
                      className="flex gap-2 text-[11px] text-ink-muted"
                    >
                      <Check className="size-3.5 text-success-text" /> {feature}
                    </div>
                  ))}
                </div>
                <Button
                  onClick={() =>
                    checkout({ purchaseType: 'plan', planId: plan.id }, plan.id)
                  }
                  disabled={current || Boolean(loading)}
                  className={`mt-6 w-full ${current ? 'bg-surface-strong text-ink-muted' : 'bg-primary text-primary-foreground hover:bg-[#1d4ed8]'}`}
                >
                  {loading === plan.id ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Sparkles />
                  )}
                  {current ? 'Current plan' : 'Choose plan'}
                </Button>
              </section>
            );
          })}
        </div>
      </div>

      <BillingModelSummary />
      <UsageRateCard rates={data.usageRateCard?.rates ?? []} />

      <section className="overflow-hidden rounded-2xl border border-hairline bg-surface p-5">
        <h2 className="text-sm font-semibold">Invoices</h2>
        <p className="mt-1 text-[11px] text-ink-muted">
          GST-ready invoice records and payment status
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="border-y border-hairline text-[11px] uppercase tracking-wider text-ink-muted">
              <tr>
                {[
                  'Invoice',
                  'Issued',
                  'Subtotal',
                  'Tax',
                  'Total',
                  'Status',
                  '',
                ].map((item, index) => (
                  <th
                    key={`${item}-${index}`}
                    className="px-3 py-3 font-medium"
                  >
                    {item}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/7">
              {(data.invoices ?? []).map((invoice) => (
                <tr key={invoice.id}>
                  <td className="px-3 py-4 font-mono">
                    {invoice.invoice_number}
                  </td>
                  <td className="px-3 py-4 text-ink-muted">
                    {formatDate(invoice.issued_at)}
                  </td>
                  <td className="px-3 py-4 text-ink-muted">
                    {money(invoice.subtotal)}
                  </td>
                  <td className="px-3 py-4 text-ink-muted">
                    {money(invoice.tax)}
                  </td>
                  <td className="px-3 py-4 font-medium">
                    {money(invoice.total)}
                  </td>
                  <td className="px-3 py-4">
                    <Badge
                      variant="outline"
                      className="border-emerald-400/15 text-[11px] text-success-text"
                    >
                      {invoice.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-4">
                    <Button
                      onClick={() =>
                        window.open(
                          `/api/app/invoices/${encodeURIComponent(invoice.id)}`,
                          '_blank',
                          'noopener,noreferrer',
                        )
                      }
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Download invoice ${invoice.invoice_number}`}
                    >
                      <Download />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-hairline bg-surface p-5">
        <h2 className="text-sm font-semibold">Credit ledger</h2>
        <div className="mt-4 divide-y divide-white/7">
          {(data.ledger ?? []).map((entry, index) => (
            <div
              key={`${entry.created_at}-${index}`}
              className="flex items-center gap-3 py-3"
            >
              <span className="grid size-8 place-items-center rounded-lg bg-surface-strong">
                {entry.amount >= 0 ? (
                  <Coins className="size-3.5 text-success-text" />
                ) : (
                  <CircleDollarSign className="size-3.5 text-warning-text" />
                )}
              </span>
              <div className="flex-1">
                <p className="text-xs">{entry.description}</p>
                <p className="mt-1 text-[11px] text-ink-muted">
                  {formatDate(entry.created_at)}
                </p>
              </div>
              <div className="text-right">
                <p
                  className={`font-mono text-xs ${entry.amount >= 0 ? 'text-success-text' : 'text-warning-text'}`}
                >
                  {entry.amount >= 0 ? '+' : ''}
                  {num(entry.amount)}
                </p>
                <p className="mt-1 text-[11px] text-ink-muted">
                  bal {num(entry.balance_after)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function UsageRateCard({ rates }: { rates: UsageRate[] }) {
  if (!rates.length) return null;
  const grouped = rates.reduce<Record<string, UsageRate[]>>((acc, rate) => {
    const key = rate.category.replaceAll('_', ' ');
    acc[key] = [...(acc[key] ?? []), rate];
    return acc;
  }, {});
  return (
    <section className="rounded-2xl border border-emerald-400/15 bg-[linear-gradient(145deg,rgba(16,185,129,0.09),#ffffff_50%,rgba(132,204,22,0.08))] p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-success-text">
            Usage rate card
          </p>
          <h2 className="mt-2 text-lg font-semibold">
            Know exactly where credits are used
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-muted">
            Calls, WhatsApp templates, SMS, email, AI voice and storage all run
            through the same wallet. Credits are held before a provider action,
            finalized on confirmation and released when a provider rejects it.
          </p>
        </div>
        <Badge
          variant="outline"
          className="w-fit border-emerald-400/20 bg-white/70 text-[11px] text-success-text"
        >
          Hold → finalize → refund
        </Badge>
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {Object.entries(grouped).map(([category, items]) => (
          <div
            key={category}
            className="rounded-2xl border border-hairline bg-white/75 p-4 shadow-[0_18px_55px_rgba(15,23,42,0.045)]"
          >
            <p className="text-xs font-semibold capitalize">{category}</p>
            <div className="mt-3 space-y-2">
              {items.map((rate) => (
                <div
                  key={rate.id}
                  className="rounded-xl border border-hairline bg-surface-muted/70 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium">{rate.label}</p>
                      <p className="mt-1 text-[11px] text-ink-muted">
                        {rate.customerNote}
                      </p>
                    </div>
                    <div className="shrink-0 rounded-full bg-emerald-400/10 px-3 py-1 text-right">
                      <p className="text-xs font-semibold text-success-text">
                        {num(rate.credits)}
                      </p>
                      <p className="text-[10px] text-ink-muted">
                        / {rate.unit}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-[10px] text-ink-muted">
                    Cost basis: {rate.costBasis}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function num(value: unknown) {
  return Number(value ?? 0).toLocaleString('en-IN');
}
function money(value: unknown) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0) / 100);
}
function formatDate(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? '—'
    : date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
}
function safeStringList(value?: string) {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) &&
      parsed.every((item) => typeof item === 'string')
      ? (parsed as string[])
      : [];
  } catch {
    return [];
  }
}
