'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

type Provider = { provider: string; display_name: string; button_visible: number; enabled: number; status: string };

export function SocialAuthButtons() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/providers', { cache: 'no-store', signal: controller.signal })
      .then(async (response): Promise<{ providers?: Provider[] }> => response.ok ? response.json() as Promise<{ providers?: Provider[] }> : { providers: [] })
      .then((payload) => setProviders(payload.providers ?? []))
      .catch(() => setProviders([]))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  if (loading) return <div className="mt-5 flex h-11 items-center justify-center rounded-xl border border-white/9 bg-white/[0.025] text-[10px] text-white/35"><Loader2 className="mr-2 size-3.5 animate-spin" /> Loading sign-in options</div>;
  if (!providers.length) return null;

  return <div className="mt-5 space-y-2">{providers.map((provider) => {
    const ready = Boolean(provider.enabled) && provider.status === 'active';
    return <button key={provider.provider} type="button" disabled={!ready} onClick={() => { if (ready && provider.provider === 'google') window.location.assign('/api/auth/google/start'); }} title={ready ? `Continue with ${provider.display_name}` : 'Activation is controlled from the admin portal'} className="flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/[0.035] text-xs font-medium text-white/78 transition-colors enabled:hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:text-white/40"><span className="grid size-5 place-items-center rounded-full bg-white text-[11px] font-bold text-[#3157c8]">G</span>Continue with {provider.display_name}{!ready ? <span className="rounded-full bg-white/8 px-2 py-1 text-[8px] font-normal text-white/55">Admin disabled</span> : null}</button>;
  })}<div className="flex items-center gap-3 py-2 text-[9px] uppercase tracking-[0.16em] text-white/22"><span className="h-px flex-1 bg-white/8" /> or use email <span className="h-px flex-1 bg-white/8" /></div></div>;
}
