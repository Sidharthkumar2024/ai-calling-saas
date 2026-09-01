'use client';

import { useState } from 'react';
import {
  Building2,
  CheckCircle2,
  FileCheck2,
  Globe2,
  KeyRound,
  Loader2,
  Route,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type NumberRow = {
  id: string;
  phone_number: string;
  acquisition_type: string;
  public_provider_name: string;
  assigned_agent_name?: string | null;
  direction: string;
  kyc_status: string;
  status: string;
  monthly_rental: number;
};

export type CustomerNumbersData = { numbers?: NumberRow[] };

export function CustomerNumbers({
  data,
  onChanged,
}: {
  data: CustomerNumbersData;
  onChanged: () => Promise<void>;
}) {
  const numbers = (data.numbers ?? []) as NumberRow[];
  const [mode, setMode] = useState<'rent' | 'connect'>('rent');
  const [phoneNumber, setPhoneNumber] = useState('+91');
  const [agentName, setAgentName] = useState('Maya · Sales');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [verification, setVerification] = useState<{
    numberId: string;
    demoCode?: string;
    code: string;
  } | null>(null);

  async function createNumber() {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/app/numbers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: mode,
          phoneNumber: mode === 'connect' ? phoneNumber : undefined,
          assignedAgentName: agentName,
          direction: 'inbound_outbound',
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        nextStep?: string;
        demoCode?: string;
        number?: { id: string };
      };
      if (!response.ok) throw new Error(payload.error || 'Unable to start number setup.');
      setMessage(payload.nextStep ?? 'Number setup started.');
      if (mode === 'connect') {
        setVerification({
          numberId: payload.number?.id ?? '',
          demoCode: payload.demoCode,
          code: payload.demoCode ?? '',
        });
      }
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to start number setup.');
    } finally {
      setLoading(false);
    }
  }

  async function verify() {
    if (!verification) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/app/numbers/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ numberId: verification.numberId, code: verification.code }),
      });
      const payload = (await response.json()) as { error?: string; nextStep?: string };
      if (!response.ok) throw new Error(payload.error || 'Unable to verify number.');
      setMessage(payload.nextStep ?? 'Ownership verified.');
      setVerification(null);
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to verify number.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300/80">Telephony onboarding</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Phone numbers and carrier connection</h1>
        <p className="mt-2 max-w-3xl text-xs leading-5 text-white/38 sm:text-sm">Rent a dedicated Vaani number for the easiest setup, or connect your existing business number through forwarding or SIP.</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
        <section className="rounded-2xl border border-white/8 bg-[#0e1119] p-5">
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-white/[0.035] p-1">
            <button type="button" onClick={() => setMode('rent')} className={`rounded-lg px-3 py-2.5 text-[10px] font-medium ${mode === 'rent' ? 'bg-amber-300 text-[#17120a]' : 'text-white/42'}`}>Rent dedicated number</button>
            <button type="button" onClick={() => setMode('connect')} className={`rounded-lg px-3 py-2.5 text-[10px] font-medium ${mode === 'connect' ? 'bg-amber-300 text-[#17120a]' : 'text-white/42'}`}>Connect my number</button>
          </div>
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-cyan-300/10 bg-cyan-300/[0.035] p-4">
            {mode === 'rent' ? <Globe2 className="mt-0.5 size-4 shrink-0 text-cyan-200" /> : <Smartphone className="mt-0.5 size-4 shrink-0 text-cyan-200" />}
            <div><p className="text-xs font-medium">{mode === 'rent' ? 'Recommended for fast launch' : 'Best for established business identity'}</p><p className="mt-1 text-[10px] leading-4 text-white/36">{mode === 'rent' ? 'Vaani allocates a dedicated provider number after business KYC and calling-purpose approval.' : 'Verify ownership, connect forwarding or SIP, complete KYC and pass inbound/outbound test calls.'}</p></div>
          </div>
          {mode === 'connect' ? (
            <label htmlFor="existing-number" className="mt-5 block text-xs text-white/58">Existing number (E.164)
              <Input id="existing-number" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="+919876543210" className="mt-2 h-10 border-white/8 bg-white/[0.025]" />
            </label>
          ) : (
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3"><p className="text-[9px] uppercase tracking-wider text-white/28">Country</p><p className="mt-2 text-xs">India</p></div>
              <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3"><p className="text-[9px] uppercase tracking-wider text-white/28">Number type</p><p className="mt-2 text-xs">Local business</p></div>
            </div>
          )}
          <label htmlFor="number-agent" className="mt-4 block text-xs text-white/58">Assign AI agent
            <Input id="number-agent" value={agentName} onChange={(event) => setAgentName(event.target.value)} className="mt-2 h-10 border-white/8 bg-white/[0.025]" />
          </label>
          {error ? <div className="mt-4 rounded-xl border border-red-400/15 bg-red-400/5 p-3 text-[10px] text-red-100">{error}</div> : null}
          {message ? <div className="mt-4 rounded-xl border border-emerald-400/15 bg-emerald-400/5 p-3 text-[10px] text-emerald-100">{message}</div> : null}
          <Button onClick={createNumber} disabled={loading} className="mt-5 w-full bg-amber-300 text-[#17120a] hover:bg-amber-200">
            {loading ? <Loader2 className="animate-spin" /> : mode === 'rent' ? <Globe2 /> : <KeyRound />}
            {mode === 'rent' ? 'Request dedicated number' : 'Start ownership verification'}
          </Button>

          {verification ? (
            <div className="mt-5 rounded-xl border border-amber-300/15 bg-amber-300/[0.035] p-4">
              <p className="text-xs font-medium">Verify number ownership</p>
              <p className="mt-1 text-[10px] text-white/36">Local demo code: <span className="font-mono text-amber-200">{verification.demoCode ?? 'sent to the number'}</span></p>
              <div className="mt-3 flex gap-2"><Input value={verification.code} onChange={(event) => setVerification({ ...verification, code: event.target.value })} maxLength={6} className="h-9 border-white/8 bg-white/[0.025] font-mono" /><Button onClick={verify} disabled={loading} size="sm" className="bg-white text-black hover:bg-white/90">Verify</Button></div>
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-white/8 bg-[#0e1119] p-5">
          <h2 className="text-sm font-semibold">Recommended hybrid architecture</h2>
          <p className="mt-1 text-[10px] text-white/32">One flow for small businesses, a second for enterprise BYOC</p>
          <div className="mt-5 space-y-3">
            {[
              ['1', 'Choose number model', 'Vaani-rented, call forwarding or SIP/BYOC', Route],
              ['2', 'Verify business and purpose', 'PAN/GST/company identity, consent source and calling use case', FileCheck2],
              ['3', 'Provider review', 'Route, number class and approved caller identity', ShieldCheck],
              ['4', 'Assign AI agent', 'Map inbound and outbound flow, knowledge and transfer target', Building2],
              ['5', 'Test and activate', 'Inbound callback, outbound display, audio and failover test', CheckCircle2],
            ].map(([step, title, note, Icon]) => (
              <div key={String(step)} className="flex items-start gap-3 rounded-xl border border-white/7 bg-white/[0.02] p-3.5">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-amber-300/10 text-[9px] text-amber-200">{String(step)}</span>
                <div className="flex-1"><p className="text-xs font-medium">{String(title)}</p><p className="mt-1 text-[9px] leading-4 text-white/32">{String(note)}</p></div>
                <Icon className="mt-0.5 size-4 text-white/25" />
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="overflow-hidden rounded-2xl border border-white/8 bg-[#0e1119] p-5">
        <h2 className="text-sm font-semibold">Your number inventory</h2>
        <p className="mt-1 text-[10px] text-white/32">Provider details remain behind Vaani Connect</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-xs">
            <thead className="border-y border-white/8 text-[9px] uppercase tracking-wider text-white/25"><tr>{['Number','Model','Agent','Direction','KYC','Status','Rental'].map((item)=><th key={item} className="px-3 py-3 font-medium">{item}</th>)}</tr></thead>
            <tbody className="divide-y divide-white/7">
              {numbers.map((number) => (
                <tr key={number.id}><td className="px-3 py-4 font-mono">{number.phone_number}</td><td className="px-3 py-4 text-white/48">{number.acquisition_type.replaceAll('_',' ')}</td><td className="px-3 py-4 text-white/58">{number.assigned_agent_name || 'Unassigned'}</td><td className="px-3 py-4 text-white/48">{number.direction.replaceAll('_',' + ')}</td><td className="px-3 py-4"><Status value={number.kyc_status} /></td><td className="px-3 py-4"><Status value={number.status} /></td><td className="px-3 py-4 text-white/48">{number.monthly_rental ? money(number.monthly_rental) : 'BYOC'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Status({ value }: { value: string }) { const positive=['active','approved','verified'].some((item)=>value.includes(item)); const warning=['pending','required','review'].some((item)=>value.includes(item)); return <Badge variant="outline" className={`${positive?'border-emerald-400/15 text-emerald-300':warning?'border-amber-300/15 text-amber-200':'border-white/10 text-white/42'} text-[8px]`}>{value.replaceAll('_',' ')}</Badge>; }
function money(value: number) { return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(value/100); }
