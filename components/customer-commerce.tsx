'use client';

import { useState } from 'react';
import {
  Clock3,
  CreditCard,
  IndianRupee,
  Link2,
  Loader2,
  MessageCircleMore,
  Play,
  Send,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type PaymentLinkRow = {
  id: string;
  reference_id: string;
  customer_name: string;
  customer_phone: string;
  amount: number;
  currency: string;
  description: string;
  delivery_mode: string;
  scheduled_for: string | null;
  provider: string;
  short_url: string;
  status: string;
  created_at: string;
};
type MessageRow = {
  id: string;
  payment_link_id: string | null;
  destination: string;
  status: string;
  scheduled_for: string | null;
  sent_at: string | null;
};
type ScheduledActionRow = {
  id: string;
  type: string;
  status: string;
  run_at: string;
  attempt_count: number;
  last_error: string | null;
};
export type CommerceData = {
  paymentLinks?: PaymentLinkRow[];
  messages?: MessageRow[];
  scheduledActions?: ScheduledActionRow[];
  connections?: Array<{ type: string; status: string }>;
};

export function CustomerCommerce({ data, onChanged }: { data: CommerceData; onChanged: () => Promise<void> }) {
  const [form, setForm] = useState({
    customerName: 'Aditi Mehra',
    customerPhone: '+919876544210',
    customerEmail: '',
    amount: '550',
    description: 'Winter cap order',
    deliveryMode: 'instant' as 'instant' | 'scheduled',
    scheduledFor: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function post(body: Record<string, unknown>) {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/app/commerce', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        error?: string;
        status?: string;
        shortUrl?: string;
        processed?: number;
        completed?: number;
      };
      if (!response.ok) throw new Error(payload.error ?? 'Unable to run commerce action.');
      setNotice(payload.shortUrl
        ? `${payload.status === 'scheduled' ? 'Scheduled' : 'Prepared and delivered'}: ${payload.shortUrl}`
        : `Processed ${payload.processed ?? 0} due actions; ${payload.completed ?? 0} completed.`);
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to run commerce action.');
    } finally {
      setLoading(false);
    }
  }

  const razorpay = data.connections?.find((item) => item.type === 'razorpay');
  const whatsapp = data.connections?.find((item) => item.type === 'whatsapp_cloud');
  const paymentLinks = data.paymentLinks ?? [];
  const messages = data.messages ?? [];
  const actions = data.scheduledActions ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300/80">Conversation → action → revenue</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">AI commerce actions</h1>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-white/38 sm:text-sm">When a customer asks for details or a payment link, Vaani can act immediately or remember the requested time.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void post({ action: 'run_due' })} disabled={loading} className="border-white/10 bg-transparent"><Play /> Run due actions</Button>
      </div>

      {error ? <div className="rounded-xl border border-red-400/15 bg-red-400/5 p-3 text-xs text-red-100">{error}</div> : null}
      {notice ? <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/5 p-3 text-xs text-emerald-100">{notice}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={CreditCard} label="Payment links" value={String(paymentLinks.length)} note="Razorpay-ready" />
        <Metric icon={MessageCircleMore} label="WhatsApp events" value={String(messages.length)} note="Template governed" />
        <Metric icon={Clock3} label="Scheduled" value={String(actions.filter((item) => item.status === 'pending').length)} note="Asia/Kolkata aware" />
        <Metric icon={IndianRupee} label="Payment intent" value={money(paymentLinks.reduce((sum, item) => sum + Number(item.amount), 0))} note="Links created" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.88fr_1.12fr]">
        <section className="rounded-2xl border border-white/8 bg-[#0e1119] p-5">
          <div className="flex items-start justify-between"><div><h2 className="text-sm font-semibold">Simulate the call outcome</h2><p className="mt-1 text-[10px] text-white/32">No real charge is made in sandbox mode</p></div><Sparkles className="size-4 text-amber-200" /></div>
          <div className="mt-5 space-y-4">
            <Field label="Customer name"><Input value={form.customerName} onChange={(event) => setForm({ ...form, customerName: event.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="WhatsApp number"><Input value={form.customerPhone} onChange={(event) => setForm({ ...form, customerPhone: event.target.value })} /></Field><Field label="Amount (₹)"><Input type="number" min="1" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></Field></div>
            <Field label="Product / reason"><Input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>
            <Field label="Delivery instruction"><div className="grid grid-cols-2 rounded-xl border border-white/8 bg-black/20 p-1">{(['instant', 'scheduled'] as const).map((item) => <button key={item} type="button" onClick={() => setForm({ ...form, deliveryMode: item })} className={`rounded-lg px-3 py-2 text-[10px] capitalize ${form.deliveryMode === item ? 'bg-white/9 text-white' : 'text-white/35'}`}>{item === 'instant' ? 'Send now' : 'Send later'}</button>)}</div></Field>
            {form.deliveryMode === 'scheduled' ? <Field label="Customer-requested time"><Input type="datetime-local" value={form.scheduledFor} onChange={(event) => setForm({ ...form, scheduledFor: event.target.value })} /></Field> : null}
            <Button type="button" disabled={loading} onClick={() => void post({ action: 'create_payment_link', ...form, amount: Number(form.amount) })} className="w-full bg-amber-300 text-[#17120a] hover:bg-amber-200">{loading ? <Loader2 className="animate-spin" /> : form.deliveryMode === 'instant' ? <Send /> : <Clock3 />}{form.deliveryMode === 'instant' ? 'Create & send payment link' : 'Create & schedule payment link'}</Button>
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-2"><Connection label="Razorpay" value={razorpay?.status ?? 'local sandbox'} /><Connection label="WhatsApp" value={whatsapp?.status ?? 'local sandbox'} /></div>
        </section>

        <section className="rounded-2xl border border-white/8 bg-[#0e1119] p-5">
          <div className="flex items-start justify-between"><div><h2 className="text-sm font-semibold">How one sentence becomes revenue</h2><p className="mt-1 text-[10px] text-white/32">“WhatsApp the details and send the payment link at 8 PM.”</p></div><Workflow className="size-4 text-violet-200" /></div>
          <div className="mt-5 space-y-2">{[
            ['1', 'Understand intent', 'Product details + ₹550 payment + requested delivery time'],
            ['2', 'Check policy', 'Consent, destination, amount range and approved template'],
            ['3', 'Create link', 'Razorpay Payment Links API with Vaani reference ID'],
            ['4', 'Schedule action', 'Durable record with timezone and retry policy'],
            ['5', 'Send on WhatsApp', 'Approved template with amount and secure link'],
            ['6', 'Close the loop', 'Signed webhook updates payment, CRM and salesperson'],
          ].map(([step, title, note]) => <div key={step} className="flex gap-3 rounded-xl border border-white/7 bg-white/[0.015] p-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-violet-300/8 font-mono text-[10px] text-violet-200">{step}</span><div><p className="text-xs font-medium">{title}</p><p className="mt-1 text-[9px] leading-4 text-white/34">{note}</p></div></div>)}</div>
          <div className="mt-5 rounded-xl border border-cyan-300/12 bg-cyan-300/[0.025] p-4"><ShieldCheck className="size-4 text-cyan-200" /><p className="mt-3 text-[10px] leading-5 text-white/42">The agent cannot invent a successful payment or WhatsApp delivery. CRM status changes only after the relevant provider tool or signed webhook confirms it.</p></div>
        </section>
      </div>

      <section className="overflow-hidden rounded-2xl border border-white/8 bg-[#0e1119] p-5">
        <div><h2 className="text-sm font-semibold">Payment-link timeline</h2><p className="mt-1 text-[10px] text-white/32">Customer, schedule, provider and delivery status</p></div>
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[820px] text-left text-xs"><thead className="border-y border-white/8 text-[9px] uppercase tracking-wider text-white/25"><tr>{['Reference', 'Customer', 'Amount', 'Instruction', 'Provider', 'Status', 'Link'].map((item) => <th key={item} className="px-3 py-3 font-medium">{item}</th>)}</tr></thead><tbody className="divide-y divide-white/7">{paymentLinks.map((item) => <tr key={item.id}><td className="px-3 py-4 font-mono text-[9px] text-white/45">{item.reference_id}</td><td className="px-3 py-4"><p>{item.customer_name}</p><p className="mt-1 font-mono text-[9px] text-white/28">{item.customer_phone}</p></td><td className="px-3 py-4">{money(item.amount)}</td><td className="px-3 py-4 text-white/42">{item.delivery_mode === 'scheduled' && item.scheduled_for ? new Date(item.scheduled_for).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Send now'}</td><td className="px-3 py-4 capitalize text-white/42">{item.provider.replaceAll('_', ' ')}</td><td className="px-3 py-4"><Status value={item.status} /></td><td className="px-3 py-4"><a href={item.short_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-cyan-200 hover:underline"><Link2 className="size-3" /> Open</a></td></tr>)}</tbody></table>{paymentLinks.length === 0 ? <div className="py-10 text-center text-xs text-white/30">No payment links yet.</div> : null}</div>
      </section>
    </div>
  );
}

function Metric({ icon: Icon, label, value, note }: { icon: typeof CreditCard; label: string; value: string; note: string }) { return <div className="rounded-2xl border border-white/8 bg-[#0e1119] p-4"><div className="flex items-center justify-between"><p className="text-[9px] uppercase tracking-[0.12em] text-white/28">{label}</p><Icon className="size-4 text-amber-200" /></div><p className="mt-4 text-2xl font-semibold">{value}</p><p className="mt-1 text-[9px] text-white/28">{note}</p></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-xs text-white/48">{label}<div className="mt-2 [&_input]:h-10 [&_input]:border-white/8 [&_input]:bg-white/[0.025]">{children}</div></label>; }
function Connection({ label, value }: { label: string; value: string }) { const active = value === 'connected'; return <div className="rounded-xl border border-white/7 bg-white/[0.015] p-3"><div className="flex items-center gap-2"><span className={`size-2 rounded-full ${active ? 'bg-emerald-300' : 'bg-amber-300'}`} /><p className="text-[10px] font-medium">{label}</p></div><p className="mt-2 text-[8px] capitalize text-white/28">{value.replaceAll('_', ' ')}</p></div>; }
function Status({ value }: { value: string }) { const positive = ['paid', 'sent', 'sandbox_delivered', 'completed'].includes(value); const warning = ['scheduled', 'created', 'processing', 'pending'].includes(value); return <span className={`inline-flex rounded-full border px-2 py-1 text-[8px] capitalize ${positive ? 'border-emerald-400/15 bg-emerald-400/7 text-emerald-300' : warning ? 'border-amber-300/15 bg-amber-300/7 text-amber-200' : 'border-white/8 bg-white/5 text-white/40'}`}>{value.replaceAll('_', ' ')}</span>; }
function money(paise: number) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(paise ?? 0) / 100); }
