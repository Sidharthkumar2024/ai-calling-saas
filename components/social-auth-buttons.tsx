'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useT } from '@/components/locale-provider';

type Provider = {
  provider: string;
  display_name: string;
  button_visible: number;
  enabled: number;
  status: string;
};

export function SocialAuthButtons() {
  const t = useT();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/providers', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(
        async (response): Promise<{ providers?: Provider[] }> =>
          response.ok
            ? (response.json() as Promise<{ providers?: Provider[] }>)
            : { providers: [] },
      )
      .then((payload) => setProviders(payload.providers ?? []))
      .catch(() => setProviders([]))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  if (loading)
    return (
      <div className="mt-5 flex h-11 items-center justify-center rounded-xl border border-hairline bg-surface-muted text-[11px] text-ink-muted">
        <Loader2 className="mr-2 size-3.5 animate-spin" /> Loading sign-in
        options
      </div>
    );
  if (!providers.length) return null;

  return (
    <div className="mt-5 space-y-2">
      {providers.map((provider) => {
        const ready = Boolean(provider.enabled) && provider.status === 'active';
        return (
          <button
            key={provider.provider}
            type="button"
            disabled={!ready}
            onClick={() => {
              if (ready && provider.provider === 'google')
                window.location.assign('/api/auth/google/start');
            }}
            title={
              ready
                ? t('login.continueWith', { provider: provider.display_name })
                : 'Activation is controlled from the admin portal'
            }
            className="flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-hairline bg-surface-strong text-xs font-medium text-ink transition-colors enabled:hover:bg-surface-strong disabled:cursor-not-allowed disabled:text-ink-muted"
          >
            <span className="grid size-5 place-items-center rounded-full bg-white text-[11px] font-bold text-[#3157c8]">
              G
            </span>
            {t('login.continueWith', { provider: provider.display_name })}
            {!ready ? (
              <span className="rounded-full bg-surface-strong px-2 py-1 text-[11px] font-normal text-ink-body">
                {t('login.adminDisabled')}
              </span>
            ) : null}
          </button>
        );
      })}
      <div className="flex items-center gap-3 py-2 text-[11px] uppercase tracking-[0.16em] text-ink-muted">
        <span className="h-px flex-1 bg-surface-strong" />{' '}
        {t('login.orUseEmail')}{' '}
        <span className="h-px flex-1 bg-surface-strong" />
      </div>
    </div>
  );
}
