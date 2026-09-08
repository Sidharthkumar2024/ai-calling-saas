'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useT } from '@/components/locale-provider';
import { ProviderLogo } from '@/components/provider-logo';

type Provider = {
  provider: string;
  display_name: string;
  button_visible: number;
  enabled: number;
  status: string;
};

export function SocialAuthButtons({ signup = false }: { signup?: boolean }) {
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
      <div className="mt-5 flex h-11 items-center justify-center rounded-xl border border-hairline bg-surface-muted text-xs text-ink-muted">
        <Loader2 className="mr-2 size-3.5 animate-spin" /> Loading sign-in
        options
      </div>
    );
  if (!providers.length) return null;

  return (
    <div className="mt-5 space-y-2">
      {providers.map((provider) => {
        const ready =
          !signup &&
          provider.provider === 'google' &&
          Boolean(provider.enabled) &&
          provider.status === 'active';
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
                : signup
                  ? 'Create your account with email first. Google sign-in is available for existing accounts when enabled.'
                  : 'Activation is controlled from the admin portal'
            }
            className="flex min-h-11 w-full flex-wrap items-center justify-center gap-3 rounded-full border border-[#747775] bg-white px-3 py-2 text-sm font-medium text-[#1f1f1f] transition-colors enabled:hover:bg-[#f2f2f2] disabled:cursor-not-allowed disabled:text-[#5f6368]"
          >
            <span className="grid size-6 place-items-center rounded-full bg-white">
              <ProviderLogo provider={provider.provider} size={20} />
            </span>
            {t('login.continueWith', { provider: provider.display_name })}
            {!ready ? (
              <span className="rounded-full bg-surface-strong px-2 py-1 text-xs font-normal text-ink-body">
                {signup ? 'Email signup first' : t('login.adminDisabled')}
              </span>
            ) : null}
          </button>
        );
      })}
      <div className="flex items-center gap-3 py-2 text-xs uppercase tracking-[0.16em] text-ink-muted">
        <span className="h-px flex-1 bg-surface-strong" />{' '}
        {t('login.orUseEmail')}{' '}
        <span className="h-px flex-1 bg-surface-strong" />
      </div>
    </div>
  );
}
