'use client';

import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  LogOut,
  ShieldCheck,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type SecurityData = {
  settings: { email_verified_at?: string | null; mfa_enabled?: number };
  sessions: Array<{ id: string; expires_at: string; created_at: string }>;
};

export function CustomerSecurity() {
  const [data, setData] = useState<SecurityData | null>(null);
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  async function load() {
    const response = await fetch('/api/auth/security', { cache: 'no-store' });
    const body = (await response.json()) as SecurityData & { error?: string };
    if (!response.ok)
      throw new Error(body.error ?? 'Unable to load security settings.');
    setData(body);
  }
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((caught) =>
        setError(
          caught instanceof Error
            ? caught.message
            : 'Unable to load security settings.',
        ),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  async function action(payload: Record<string, unknown>, key: string) {
    setLoading(key);
    setError('');
    try {
      const response = await fetch('/api/auth/security', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as {
        error?: string;
        secret?: string;
        recoveryCodes?: string[];
      };
      if (!response.ok)
        throw new Error(body.error ?? 'Security request failed.');
      if (body.secret) setSecret(body.secret);
      if (body.recoveryCodes) {
        setRecoveryCodes(body.recoveryCodes);
        setSecret('');
        setCode('');
      }
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Security request failed.',
      );
    } finally {
      setLoading('');
    }
  }
  return (
    <section className="portal-panel p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Account security</h2>
          <p className="mt-1 text-[10px] text-ink-muted">
            Authenticator MFA and revocable HttpOnly sessions
          </p>
        </div>
        <ShieldCheck className="size-4 text-primary" />
      </div>
      {!data ? (
        <Loader2 className="mt-5 size-4 animate-spin text-ink-muted" />
      ) : (
        <div className="mt-5 grid gap-4 [&>*]:min-w-0 xl:grid-cols-[0.9fr_1.1fr]">
          {/* `min-w-0` on the children is not decoration: a grid track is sized
              to its content by default, and the session ids below are
              unbreakable monospace strings. Without it the card grew to 420px
              inside a 301px column and pushed the whole page 82px wider than
              the phone, so every screen under it dragged sideways. */}
          <div className="rounded-xl border border-hairline bg-surface-muted p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium">Authenticator app</p>
                <p className="mt-1 text-[9px] text-ink-muted">
                  Required after password sign-in
                </p>
              </div>
              <span
                className={`rounded-full px-2 py-1 text-[9px] ${data.settings.mfa_enabled ? 'bg-emerald-400/8 text-success-text' : 'bg-surface-strong text-ink-muted'}`}
              >
                {data.settings.mfa_enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            {!data.settings.mfa_enabled && !secret ? (
              <Button
                onClick={() => action({ action: 'mfa_begin' }, 'begin')}
                disabled={loading === 'begin'}
                variant="outline"
                className="mt-4 border-hairline bg-transparent"
              >
                {loading === 'begin' ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <KeyRound />
                )}{' '}
                Set up 2FA
              </Button>
            ) : null}
            {secret ? (
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-2 rounded-lg bg-surface-muted p-3 font-mono text-[10px] text-ink-body">
                  <span className="min-w-0 flex-1 break-all">{secret}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => navigator.clipboard.writeText(secret)}
                  >
                    <Copy className="size-3" />
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={code}
                    onChange={(event) =>
                      setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                    }
                    placeholder="6-digit code"
                    inputMode="numeric"
                    className="h-10 border-hairline bg-surface-muted font-mono"
                  />
                  <Button
                    onClick={() =>
                      action({ action: 'mfa_confirm', code }, 'confirm')
                    }
                    disabled={code.length !== 6 || loading === 'confirm'}
                    className="portal-primary"
                  >
                    {loading === 'confirm' ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <CheckCircle2 />
                    )}{' '}
                    Verify
                  </Button>
                </div>
              </div>
            ) : null}
            {recoveryCodes.length ? (
              <div className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/5 p-3">
                <p className="text-[10px] font-medium text-warning-text">
                  Save these recovery codes once
                </p>
                <p className="mt-2 break-words font-mono text-[9px] leading-5 text-ink-body">
                  {recoveryCodes.join(' · ')}
                </p>
              </div>
            ) : null}
          </div>
          <div className="rounded-xl border border-hairline bg-surface-muted p-4">
            <p className="text-xs font-medium">Active sessions</p>
            <div className="mt-3 space-y-2">
              {data.sessions.map((session, index) => (
                <div
                  key={session.id}
                  className="flex items-center gap-3 rounded-lg border border-hairline bg-black/10 p-3"
                >
                  <span className="grid size-8 place-items-center rounded-lg bg-surface-strong">
                    <LogOut className="size-3.5 text-ink-muted" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[9px] text-ink-body">
                      {session.id}
                    </p>
                    <p className="mt-1 text-[8px] text-ink-muted">
                      Expires {formatDate(session.expires_at)}
                    </p>
                  </div>
                  {index > 0 ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={loading === session.id}
                      onClick={() =>
                        action(
                          { action: 'revoke_session', sessionId: session.id },
                          session.id,
                        )
                      }
                    >
                      {loading === session.id ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        'Revoke'
                      )}
                    </Button>
                  ) : (
                    <span className="text-[8px] text-success-text">
                      Current
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {error ? (
        <p className="mt-4 rounded-xl border border-red-400/15 bg-red-400/5 p-3 text-xs text-danger-text">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
