'use client';

import { useState } from 'react';
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

export type BillingData = {
  wallet?: Wallet;
  subscription?: Subscription;
  paymentMode?: string;
  creditPackages?: CreditPackage[];
  plans?: Plan[];
  invoices?: Invoice[];
  ledger?: LedgerEntry[];
};

export function CustomerBilling({
  data,
  onChanged,
}: {
  data: BillingData;
  onChanged: () => Promise<void>;
}) {
  const [loading, setLoading] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const wallet = data.wallet ?? { balance: 0, low_balance_threshold: 500 };
  const subscription = data.subscription ?? {};

  async function checkout(body: Record<string, unknown>, loadingKey: string) {
    setLoading(loadingKey); setError(''); setMessage('');
    try {
      const response = await fetch('/api/app/billing/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const payload = (await response.json()) as {
        error?: string;
        checkoutUrl?: string;
        invoiceNumber?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? 'Unable to start checkout.');
      if (payload.checkoutUrl) { window.location.assign(payload.checkoutUrl); return; }
      setMessage(`Local sandbox purchase complete. Invoice ${payload.invoiceNumber ?? 'created'} generated; no real money was charged.`);
      await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to start checkout.'); }
    finally { setLoading(''); }
  }

  return (
    <div className="space-y-6">
      <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300/80">Subscription and wallet</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Billing, credits and invoices</h1><p className="mt-2 max-w-3xl text-xs leading-5 text-white/38 sm:text-sm">Plan limits, top-ups, usage deductions and tax invoices stay on one auditable ledger.</p></div>
      {data.paymentMode === 'local_sandbox' ? <div className="flex items-start gap-3 rounded-xl border border-cyan-300/12 bg-cyan-300/[0.035] p-4 text-xs text-cyan-50"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-cyan-200" /><div><p className="font-medium">Local sandbox billing is active</p><p className="mt-1 text-[10px] leading-4 text-white/38">Checkout buttons simulate a successful payment, add credits and generate invoices locally. Add Stripe keys to use hosted checkout and signed webhooks.</p></div></div> : null}
      {error ? <div className="rounded-xl border border-red-400/15 bg-red-400/5 p-3 text-xs text-red-100">{error}</div> : null}
      {message ? <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/5 p-3 text-xs text-emerald-100">{message}</div> : null}
      <div className="grid gap-4 xl:grid-cols-[0.7fr_1.3fr]">
        <section className="rounded-2xl border border-white/8 bg-[linear-gradient(145deg,rgba(252,211,77,0.1),rgba(14,17,25,1)_55%)] p-5"><div className="flex items-center justify-between"><span className="grid size-10 place-items-center rounded-xl bg-amber-300/12"><WalletCards className="size-4 text-amber-200" /></span><Badge variant="outline" className="border-emerald-400/15 text-[8px] text-emerald-300">{subscription.status || 'active'}</Badge></div><p className="mt-8 text-[10px] uppercase tracking-[0.14em] text-white/30">Available credits</p><p className="mt-2 text-4xl font-semibold">{num(wallet.balance)}</p><div className="mt-5"><div className="mb-2 flex justify-between text-[9px] text-white/30"><span>Low-balance alert</span><span>{num(wallet.low_balance_threshold)}</span></div><Progress value={Math.min(100, Number(wallet.balance) / 300)} className="h-1 bg-white/7" /></div><div className="mt-6 border-t border-white/8 pt-4"><p className="text-xs font-medium">{subscription.name || 'Growth'} plan</p><p className="mt-1 text-[10px] text-white/32">Renews {formatDate(subscription.current_period_end)}</p></div></section>
        <section className="rounded-2xl border border-white/8 bg-[#0e1119] p-5"><h2 className="text-sm font-semibold">Instant credit top-up</h2><p className="mt-1 text-[10px] text-white/32">Credits are consumed by calling and AI usage</p><div className="mt-5 grid gap-3 md:grid-cols-3">{(data.creditPackages??[]).map((item)=><div key={item.id} className="rounded-xl border border-white/8 bg-white/[0.02] p-4"><Coins className="size-4 text-amber-200" /><p className="mt-4 text-lg font-semibold">{num(item.credits)}</p><p className="text-[9px] text-white/28">credits</p><p className="mt-4 text-sm font-medium">{money(item.amount)}</p><Button onClick={()=>checkout({purchaseType:'credits',packageId:item.id},item.id)} disabled={Boolean(loading)} variant="outline" className="mt-4 w-full border-white/10 bg-transparent">{loading===item.id?<Loader2 className="animate-spin"/>:<CreditCard/>} Top up</Button></div>)}</div></section>
      </div>

      <div><h2 className="text-sm font-semibold">Choose the right plan</h2><div className="mt-4 grid gap-4 lg:grid-cols-3">{(data.plans??[]).map((plan)=>{const current=plan.id===subscription.id; const features=safeStringList(plan.features_json); return <section key={plan.id} className={`rounded-2xl border p-5 ${current?'border-amber-300/25 bg-amber-300/[0.045]':'border-white/8 bg-[#0e1119]'}`}><div className="flex items-center justify-between"><p className="text-lg font-semibold">{plan.name}</p>{current?<Badge className="bg-amber-300 text-[8px] text-[#17120a]">Current</Badge>:null}</div><p className="mt-3 text-3xl font-semibold">{money(plan.monthly_price)}<span className="text-xs font-normal text-white/30"> / mo</span></p><div className="mt-5 space-y-2">{features.map((feature)=><div key={feature} className="flex gap-2 text-[10px] text-white/48"><Check className="size-3.5 text-emerald-300" /> {feature}</div>)}</div><Button onClick={()=>checkout({purchaseType:'plan',planId:plan.id},plan.id)} disabled={current||Boolean(loading)} className={`mt-6 w-full ${current?'bg-white/6 text-white/35':'bg-amber-300 text-[#17120a] hover:bg-amber-200'}`}>{loading===plan.id?<Loader2 className="animate-spin"/>:<Sparkles/>}{current?'Current plan':'Choose plan'}</Button></section>})}</div></div>

      <section className="overflow-hidden rounded-2xl border border-white/8 bg-[#0e1119] p-5"><h2 className="text-sm font-semibold">Invoices</h2><p className="mt-1 text-[10px] text-white/32">GST-ready invoice records and payment status</p><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="border-y border-white/8 text-[9px] uppercase tracking-wider text-white/25"><tr>{['Invoice','Issued','Subtotal','Tax','Total','Status',''].map((item,index)=><th key={`${item}-${index}`} className="px-3 py-3 font-medium">{item}</th>)}</tr></thead><tbody className="divide-y divide-white/7">{(data.invoices??[]).map((invoice)=><tr key={invoice.id}><td className="px-3 py-4 font-mono">{invoice.invoice_number}</td><td className="px-3 py-4 text-white/42">{formatDate(invoice.issued_at)}</td><td className="px-3 py-4 text-white/48">{money(invoice.subtotal)}</td><td className="px-3 py-4 text-white/48">{money(invoice.tax)}</td><td className="px-3 py-4 font-medium">{money(invoice.total)}</td><td className="px-3 py-4"><Badge variant="outline" className="border-emerald-400/15 text-[8px] text-emerald-300">{invoice.status}</Badge></td><td className="px-3 py-4"><Button onClick={() => window.open(`/api/app/invoices/${encodeURIComponent(invoice.id)}`, '_blank', 'noopener,noreferrer')} size="icon-sm" variant="ghost" aria-label={`Download invoice ${invoice.invoice_number}`}><Download /></Button></td></tr>)}</tbody></table></div></section>

      <section className="rounded-2xl border border-white/8 bg-[#0e1119] p-5"><h2 className="text-sm font-semibold">Credit ledger</h2><div className="mt-4 divide-y divide-white/7">{(data.ledger??[]).map((entry,index)=><div key={`${entry.created_at}-${index}`} className="flex items-center gap-3 py-3"><span className="grid size-8 place-items-center rounded-lg bg-white/5">{entry.amount>=0?<Coins className="size-3.5 text-emerald-300"/>:<CircleDollarSign className="size-3.5 text-amber-200"/>}</span><div className="flex-1"><p className="text-xs">{entry.description}</p><p className="mt-1 text-[9px] text-white/28">{formatDate(entry.created_at)}</p></div><div className="text-right"><p className={`font-mono text-xs ${entry.amount>=0?'text-emerald-300':'text-amber-200'}`}>{entry.amount>=0?'+':''}{num(entry.amount)}</p><p className="mt-1 text-[9px] text-white/25">bal {num(entry.balance_after)}</p></div></div>)}</div></section>
    </div>
  );
}

function num(value: unknown) { return Number(value ?? 0).toLocaleString('en-IN'); }
function money(value: unknown) { return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Number(value ?? 0)/100); }
function formatDate(value: unknown) { if (typeof value !== 'string' && typeof value !== 'number') return '—'; const date = new Date(value); return Number.isNaN(date.valueOf()) ? '—' : date.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); }
function safeStringList(value?: string) { try { const parsed: unknown = JSON.parse(value ?? '[]'); return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed as string[] : []; } catch { return []; } }
