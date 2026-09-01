'use client';

import { useEffect, useState } from 'react';
import {
  Braces,
  CheckCircle2,
  Clipboard,
  Code2,
  ExternalLink,
  Globe2,
  Loader2,
  Megaphone,
  MousePointerClick,
  Palette,
  PanelLeft,
  PanelRight,
  Play,
  Save,
  Settings2,
  Sparkles,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type LeadFormSettings = {
  title: string;
  description: string;
  buttonText: string;
  successMessage: string;
  placement: 'bottom_right' | 'bottom_left' | 'center_modal' | 'inline';
  trigger: 'delay' | 'exit_intent' | 'manual';
  delaySeconds: number;
  frequency: 'every_visit' | 'once_session' | 'once_7_days';
  animation: 'slide' | 'fade' | 'bounce';
  accent: string;
  background: string;
};

export type LeadFormRow = {
  id: string;
  name: string;
  publicKey: string;
  status: string;
  version: number;
  settings: LeadFormSettings;
  allowedDomains: string[];
  embedScript: string;
  endpoint: string;
};

export type LeadFormsData = { forms?: LeadFormRow[] };
type Source = { type: string; name: string; status: string };

export function CustomerLeadCapture({
  data,
  sources,
  onChanged,
  onNavigate,
}: {
  data: LeadFormsData;
  sources: Source[];
  onChanged: () => Promise<void>;
  onNavigate: (id: string) => void;
}) {
  const forms = data.forms ?? [];
  const [selectedId, setSelectedId] = useState(forms[0]?.id ?? '');
  const selected = forms.find((item) => item.id === selectedId) ?? forms[0];
  const [settings, setSettings] = useState<LeadFormSettings | null>(selected?.settings ?? null);
  const [name, setName] = useState(selected?.name ?? '');
  const [domains, setDomains] = useState((selected?.allowedDomains ?? []).join(', '));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [previewOpen, setPreviewOpen] = useState(true);

  useEffect(() => {
    if (!selected) return;
    const timer = window.setTimeout(() => {
      setSettings(selected.settings);
      setName(selected.name);
      setDomains(selected.allowedDomains.join(', '));
      setPreviewOpen(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selected]);

  async function createForm() {
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/app/lead-forms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Website callback popup' }) });
      const payload = await response.json() as { id?: string; error?: string };
      if (!response.ok || !payload.id) throw new Error(payload.error || 'Unable to create form.');
      setSelectedId(payload.id);
      await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to create form.'); }
    finally { setSaving(false); }
  }

  async function save(action: 'save' | 'publish' | 'unpublish') {
    if (!selected || !settings) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/app/lead-forms', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: selected.id, action, name, settings, allowedDomains: domains.split(',').map((item) => item.trim()).filter(Boolean) }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Unable to save form.');
      setNotice(action === 'publish' ? 'Published. The embed script is now live.' : action === 'unpublish' ? 'Unpublished. Existing embeds will stop loading.' : 'Form design saved as a new version.');
      await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to save form.'); }
    finally { setSaving(false); }
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    setNotice('Copied to clipboard.');
  }

  if (!selected || !settings) {
    return <div className="grid min-h-[60vh] place-items-center"><div className="max-w-sm text-center"><Globe2 className="mx-auto size-8 text-[#a8b7ff]" /><h1 className="mt-4 text-xl font-semibold">Create your first website form</h1><p className="mt-2 text-xs leading-5 text-white/38">Design an animated popup, publish it and paste one script tag into any website.</p><Button onClick={() => void createForm()} disabled={saving} className="portal-primary mt-5">{saving ? <Loader2 className="animate-spin" /> : <Sparkles />} Create form</Button>{error ? <p className="mt-4 text-xs text-red-200">{error}</p> : null}</div></div>;
  }

  const update = <K extends keyof LeadFormSettings>(key: K, value: LeadFormSettings[K]) => setSettings({ ...settings, [key]: value });
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9eb0ff]">Lead capture studio</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Build, preview and publish your callback popup</h1><p className="mt-2 max-w-3xl text-xs leading-5 text-white/38 sm:text-sm">Every submission enters the tenant CRM with page attribution, consent-aware follow-up and AI scoring.</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void save('save')} disabled={saving} className="border-white/10 bg-transparent">{saving ? <Loader2 className="animate-spin" /> : <Save />} Save draft</Button><Button onClick={() => void save(selected.status === 'active' ? 'unpublish' : 'publish')} disabled={saving} className="portal-primary">{selected.status === 'active' ? <PanelLeft /> : <Play />}{selected.status === 'active' ? 'Unpublish' : 'Publish form'}</Button></div>
      </div>
      {notice ? <p className="rounded-xl border border-emerald-400/15 bg-emerald-400/5 px-4 py-3 text-xs text-emerald-100">{notice}</p> : null}
      {error ? <p className="rounded-xl border border-red-400/15 bg-red-400/5 px-4 py-3 text-xs text-red-100">{error}</p> : null}

      <div className="grid gap-4 2xl:grid-cols-[340px_minmax(0,1fr)]">
        <section className="portal-panel p-5">
          <div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Popup settings</h2><p className="mt-1 text-[10px] text-white/32">Version {selected.version} · {selected.status}</p></div><Settings2 className="size-4 text-white/30" /></div>
          <div className="mt-5 space-y-4">
            <Field label="Form name"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field>
            <Field label="Headline"><Input value={settings.title} onChange={(event) => update('title', event.target.value)} /></Field>
            <Field label="Description"><textarea value={settings.description} onChange={(event) => update('description', event.target.value)} className="min-h-20 w-full rounded-xl border border-white/9 bg-white/[0.03] p-3 text-xs outline-none focus:border-indigo-300/40" /></Field>
            <Field label="Button text"><Input value={settings.buttonText} onChange={(event) => update('buttonText', event.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3"><Field label="Accent"><input type="color" value={settings.accent} onChange={(event) => update('accent', event.target.value)} className="h-10 w-full rounded-lg border border-white/9 bg-transparent p-1" /></Field><Field label="Background"><input type="color" value={settings.background} onChange={(event) => update('background', event.target.value)} className="h-10 w-full rounded-lg border border-white/9 bg-transparent p-1" /></Field></div>
            <Field label="Placement"><div className="grid grid-cols-3 gap-2">{(['bottom_left','center_modal','bottom_right'] as const).map((placement) => <button key={placement} type="button" onClick={() => update('placement', placement)} className={`grid h-10 place-items-center rounded-lg border ${settings.placement === placement ? 'border-indigo-300/35 bg-indigo-300/10 text-indigo-100' : 'border-white/8 bg-white/[0.02] text-white/35'}`}>{placement === 'bottom_left' ? <PanelLeft className="size-4" /> : placement === 'bottom_right' ? <PanelRight className="size-4" /> : <MousePointerClick className="size-4" />}</button>)}</div></Field>
            <div className="grid grid-cols-2 gap-3"><Select label="Trigger" value={settings.trigger} onChange={(value) => update('trigger', value as LeadFormSettings['trigger'])} options={[['delay','After delay'],['exit_intent','Exit intent'],['manual','Manual API']]} /><Field label="Delay seconds"><Input type="number" min="0" max="120" value={settings.delaySeconds} onChange={(event) => update('delaySeconds', Number(event.target.value))} disabled={settings.trigger !== 'delay'} /></Field></div>
            <div className="grid grid-cols-2 gap-3"><Select label="Animation" value={settings.animation} onChange={(value) => update('animation', value as LeadFormSettings['animation'])} options={[['slide','Slide'],['fade','Fade'],['bounce','Bounce']]} /><Select label="Frequency" value={settings.frequency} onChange={(value) => update('frequency', value as LeadFormSettings['frequency'])} options={[['every_visit','Every visit'],['once_session','Once / session'],['once_7_days','Once / 7 days']]} /></div>
            <Field label="Allowed website origins"><Input value={domains} onChange={(event) => setDomains(event.target.value)} placeholder="https://example.com, https://shop.example.com" /><p className="mt-2 text-[9px] leading-4 text-white/26">Comma-separated exact origins. Leave empty only while testing locally.</p></Field>
          </div>
        </section>

        <div className="space-y-4">
          <section className="portal-panel relative min-h-[570px] overflow-hidden p-5">
            <div className="flex items-start justify-between"><div><h2 className="text-sm font-semibold">Live preview</h2><p className="mt-1 text-[10px] text-white/32">Desktop and mobile responsive · no lead is submitted here</p></div><Button size="sm" variant="outline" onClick={() => setPreviewOpen((value) => !value)} className="border-white/10 bg-transparent"><Play /> Replay</Button></div>
            <div className="relative mt-5 min-h-[470px] overflow-hidden rounded-2xl border border-white/8 bg-[linear-gradient(135deg,#f7f7fb,#e9edf8)] p-7 text-[#121722]">
              <div className="max-w-xl"><div className="h-3 w-28 rounded-full bg-[#121722]/10" /><div className="mt-4 h-8 w-3/4 rounded-lg bg-[#121722]/10" /><div className="mt-3 h-3 w-2/3 rounded-full bg-[#121722]/8" /><div className="mt-2 h-3 w-1/2 rounded-full bg-[#121722]/8" /></div>
              {previewOpen ? <Preview settings={settings} onClose={() => setPreviewOpen(false)} /> : <button type="button" onClick={() => setPreviewOpen(true)} className="absolute bottom-7 right-7 grid size-14 place-items-center rounded-full text-white shadow-2xl" style={{ background: settings.accent }}><Megaphone className="size-5" /></button>}
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="portal-panel p-5"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Install on your website</h2><p className="mt-1 text-[10px] text-white/32">Paste before the closing body tag</p></div><Code2 className="size-4 text-cyan-200" /></div><pre className="mt-4 overflow-x-auto rounded-xl border border-white/7 bg-black/25 p-4 font-mono text-[9px] leading-5 text-cyan-100/70">{selected.embedScript}</pre><Button onClick={() => void copy(selected.embedScript)} variant="outline" className="mt-4 w-full border-white/10 bg-transparent"><Clipboard /> Copy embed script</Button></section>
            <section className="portal-panel p-5"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Lead-source connections</h2><p className="mt-1 text-[10px] text-white/32">Meta, Google and website attribution</p></div><Braces className="size-4 text-violet-200" /></div><div className="mt-4 space-y-2">{sources.map((source) => <button key={source.type} type="button" onClick={() => source.type === 'website_form' ? void copy(selected.endpoint) : onNavigate('integrations')} className="flex w-full items-center gap-3 rounded-xl border border-white/7 bg-white/[0.02] p-3 text-left hover:bg-white/[0.04]"><span className="grid size-8 place-items-center rounded-lg bg-white/5"><Globe2 className="size-3.5 text-[#a8b7ff]" /></span><span className="flex-1"><span className="block text-[10px] font-medium">{source.name}</span><span className="mt-1 block text-[8px] capitalize text-white/28">{source.status.replaceAll('_',' ')}</span></span>{source.status === 'connected' ? <CheckCircle2 className="size-4 text-emerald-300" /> : <ExternalLink className="size-4 text-white/25" />}</button>)}</div><Button onClick={() => onNavigate('integrations')} className="portal-primary mt-4 w-full"><Settings2 /> Configure Meta & Google</Button></section>
          </div>
        </div>
      </div>
    </div>
  );
}

function Preview({ settings, onClose }: { settings: LeadFormSettings; onClose: () => void }) {
  const placement = settings.placement === 'bottom_left' ? 'bottom-5 left-5' : settings.placement === 'center_modal' ? 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2' : 'bottom-5 right-5';
  return <div className={`absolute w-[min(370px,calc(100%-24px))] rounded-[22px] border border-white/15 p-5 text-white shadow-2xl ${placement}`} style={{ background: settings.background }}><button type="button" onClick={onClose} className="float-right text-lg text-white/45">×</button><Palette className="size-4" style={{ color: settings.accent }} /><h3 className="mt-4 text-lg font-semibold">{settings.title}</h3><p className="mt-2 text-[11px] leading-5 text-white/50">{settings.description}</p><div className="mt-4 grid gap-2"><input disabled placeholder="Name *" className="h-10 rounded-xl border border-white/10 bg-white/[0.055] px-3 text-xs" /><input disabled placeholder="Phone *" className="h-10 rounded-xl border border-white/10 bg-white/[0.055] px-3 text-xs" /><button type="button" className="h-11 rounded-xl text-xs font-semibold text-[#080a0f]" style={{ background: settings.accent }}>{settings.buttonText}</button></div></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-[10px] text-white/42">{label}<div className="mt-2 [&_input]:h-10 [&_input]:border-white/9 [&_input]:bg-white/[0.03] [&_input]:text-xs">{children}</div></label>; }
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) { return <label className="block text-[10px] text-white/42">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-white/9 bg-[#111722] px-3 text-[10px] text-white">{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>; }
