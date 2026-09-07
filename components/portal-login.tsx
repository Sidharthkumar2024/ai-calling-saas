'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  KeyRound,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SocialAuthButtons } from '@/components/social-auth-buttons';
import { useT } from '@/components/locale-provider';
import type { TranslationKey } from '@/lib/i18n';

type PortalLoginProps = {
  portal: 'admin' | 'customer';
};

const portalCopy = {
  admin: {
    eyebrow: 'Platform control',
    title: 'Vaani admin console',
    description:
      'Manage tenants, KYC, calling operations, plans, credits, integrations and platform health.',
    icon: ShieldCheck,
    accent: 'from-emerald-100 via-white to-white',
  },
  customer: {
    eyebrow: 'Customer workspace',
    title: 'Run your revenue voice OS',
    description:
      'Capture leads, qualify intent, automate calling, manage CRM and measure every revenue outcome.',
    icon: Building2,
    accent: 'from-emerald-100 via-white to-white',
  },
};

export function PortalLogin({ portal }: PortalLoginProps) {
  const t = useT();
  const config = portalCopy[portal];
  const copy = {
    eyebrow: t(`login.${portal}.eyebrow` as TranslationKey),
    title: t(`login.${portal}.title` as TranslationKey),
    description: t(`login.${portal}.description` as TranslationKey),
  };
  const Icon = config.icon;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [otp, setOtp] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetNotice, setResetNotice] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('reset_token');
    if (token) { setResetToken(token); setResetMode(true); }
    if (params.has('error')) setError('Google sign-in could not be completed. Use your email and password, or contact support.');
    if (token) window.history.replaceState(null, '', window.location.pathname);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function submit(event: { preventDefault: () => void }) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          portal,
          ...(mfaRequired ? { otp } : {}),
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        redirectTo?: string;
        code?: string;
      };
      if (!response.ok || !payload.redirectTo) {
        if (payload.code === 'MFA_REQUIRED') setMfaRequired(true);
        throw new Error(payload.error || 'Unable to sign in.');
      }
      window.location.assign(payload.redirectTo);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to sign in.');
      setLoading(false);
    }
  }

  async function requestReset() {
    setLoading(true);
    setError('');
    setResetNotice('');
    try {
      const response = await fetch('/api/auth/password-reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'request', email }),
      });
      const payload = (await response.json()) as {
        error?: string;
        message?: string;
        developmentToken?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? 'Unable to start password reset.');
      setResetToken(payload.developmentToken ?? '');
      setResetNotice(
        payload.developmentToken
          ? 'Local reset token is ready below.'
          : (payload.message ?? 'Check your email for the secure reset link.'),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to start password reset.',
      );
    } finally {
      setLoading(false);
    }
  }

  async function confirmReset() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/password-reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm',
          token: resetToken,
          password: newPassword,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        reset?: boolean;
      };
      if (!response.ok || !payload.reset)
        throw new Error(payload.error ?? 'Unable to reset password.');
      setResetMode(false);
      setPassword(newPassword);
      setNewPassword('');
      setResetToken('');
      setResetNotice('Password updated. Sign in with the new password.');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to reset password.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="vani-auth relative min-h-screen overflow-hidden bg-surface-muted text-ink">
      <div
        className="vani-auth-backdrop pointer-events-none absolute inset-0"
      />
      <div className="relative mx-auto flex min-h-screen max-w-[1180px] items-center px-4 py-10 sm:px-6">
        <div className="vani-auth-card grid w-full overflow-hidden rounded-[30px] border border-hairline bg-surface/94 lg:grid-cols-[0.92fr_1.08fr]">
          <section
            className={`relative hidden min-h-[690px] overflow-hidden border-r border-hairline bg-gradient-to-br ${config.accent} p-10 lg:flex lg:flex-col`}
          >
            <Link
              href="/"
              className="flex items-center gap-3 text-ink"
              aria-label={t('aria.vaaniHome')}
            >
              <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
                <Activity className="size-5" />
              </span>
              <span>
                <span className="block text-base font-semibold">Vaani</span>
                <span className="block text-[11px] uppercase tracking-[0.2em] text-ink-muted">
                  {t('login.tagline')}
                </span>
              </span>
            </Link>
            <div className="my-auto max-w-md">
              <span className="inline-flex items-center gap-2 rounded-full border border-hairline bg-surface-strong px-3 py-1.5 text-[11px] text-ink-body">
                <Sparkles className="size-3 text-warning-text" /> {copy.eyebrow}
              </span>
              <h1 className="mt-6 text-5xl font-semibold leading-[1.02] tracking-[-0.05em]">
                {copy.title}
              </h1>
              <p className="mt-5 text-base leading-7 text-ink-body">
                {copy.description}
              </p>
              <div className="mt-8 space-y-3 text-sm text-ink-body">
                {[
                  'One workspace for calls, leads and follow-ups',
                  'Your team, with the right access for each role',
                  'Try your agent before going live',
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <CheckCircle2 className="size-4 text-success-text" /> {item}
                  </div>
                ))}
              </div>
            </div>
            <p className="text-xs text-ink-muted">
              A little less busywork. A lot more conversation.
            </p>
          </section>

          <section className="flex min-h-[690px] items-center justify-center p-6 sm:p-10 lg:p-14">
            <div className="w-full max-w-md">
              <Link
                href="/"
                className="mb-10 inline-flex items-center gap-2 text-xs text-ink-muted transition-colors hover:text-ink lg:hidden"
              >
                <ArrowLeft className="size-3.5" /> {t('login.backToVaani')}
              </Link>
              <span className="grid size-12 place-items-center rounded-2xl border border-hairline bg-surface-strong">
                <Icon className="size-5 text-warning-text" />
              </span>
              <p className="mt-7 text-xs font-semibold uppercase tracking-[0.2em] text-warning-text">
                {copy.eyebrow}
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">
                {t('login.signIn')}
              </h2>
              <p className="mt-2 text-sm leading-6 text-ink-muted">
                {t(`login.${portal}.useAccount` as TranslationKey)}
              </p>

              {portal === 'customer' ? <SocialAuthButtons /> : null}

              {resetMode ? (
                <div
                  className={`${portal === 'customer' ? 'mt-2' : 'mt-7'} space-y-4`}
                >
                  <label
                    htmlFor={`${portal}-reset-email`}
                    className="block text-xs font-medium text-ink-body"
                  >
                    {t('login.accountEmail')}
                    <Input
                      id={`${portal}-reset-email`}
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      type="email"
                      autoComplete="email"
                      className="mt-2 h-11 border-hairline bg-surface-strong"
                    />
                  </label>
                  <Button
                    type="button"
                    onClick={() => void requestReset()}
                    disabled={loading || !email}
                    variant="outline"
                    className="h-11 w-full border-hairline bg-surface-muted"
                  >
                    {loading ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <KeyRound />
                    )}{' '}
                    {t('login.sendResetLink')}
                  </Button>
                  {resetToken ? (
                    <>
                      <label
                        htmlFor={`${portal}-reset-token`}
                        className="block text-xs font-medium text-ink-body"
                      >
                        {t('login.resetToken')}
                        <Input
                          id={`${portal}-reset-token`}
                          value={resetToken}
                          onChange={(event) =>
                            setResetToken(event.target.value)
                          }
                          autoComplete="one-time-code"
                          className="mt-2 h-11 border-hairline bg-surface-strong font-mono text-[11px]"
                        />
                      </label>
                      <label
                        htmlFor={`${portal}-new-password`}
                        className="block text-xs font-medium text-ink-body"
                      >
                        {t('login.newPassword')}
                        <Input
                          id={`${portal}-new-password`}
                          value={newPassword}
                          onChange={(event) =>
                            setNewPassword(event.target.value)
                          }
                          type="password"
                          autoComplete="new-password"
                          placeholder={t('login.passwordHint')}
                          className="mt-2 h-11 border-hairline bg-surface-strong"
                        />
                      </label>
                      <Button
                        type="button"
                        onClick={() => void confirmReset()}
                        disabled={
                          loading || !resetToken || newPassword.length < 10
                        }
                        className="h-11 w-full bg-primary text-primary-foreground hover:bg-primary/90"
                      >
                        <LockKeyhole /> Update password
                      </Button>
                    </>
                  ) : null}
                  {resetNotice ? (
                    <p className="rounded-xl border border-emerald-400/15 bg-emerald-400/6 p-3 text-xs text-success-text">
                      {resetNotice}
                    </p>
                  ) : null}
                  {error ? (
                    <p className="rounded-xl border border-red-400/15 bg-red-400/5 p-3 text-xs text-danger-text">
                      {error}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setResetMode(false);
                      setError('');
                    }}
                    className="text-xs text-ink-muted hover:text-ink"
                  >
                    {t('login.backToSignIn')}
                  </button>
                </div>
              ) : (
                <form
                  className={`${portal === 'customer' ? 'mt-2' : 'mt-7'} space-y-4`}
                  onSubmit={submit}
                >
                  <label
                    htmlFor={`${portal}-email`}
                    className="block text-xs font-medium text-ink-body"
                  >
                    {t('login.email')}
                    <Input
                      id={`${portal}-email`}
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      type="email"
                      autoComplete="username"
                      className="mt-2 h-11 border-hairline bg-surface-strong text-ink placeholder:text-ink-muted"
                      required
                    />
                  </label>
                  {mfaRequired ? (
                    <label
                      htmlFor={`${portal}-otp`}
                      className="block text-xs font-medium text-ink-body"
                    >
                      {t('login.authenticatorCode')}
                      <Input
                        id={`${portal}-otp`}
                        value={otp}
                        onChange={(event) =>
                          setOtp(
                            event.target.value.replace(/\D/g, '').slice(0, 6),
                          )
                        }
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder={t('login.codePlaceholder')}
                        className="mt-2 h-11 border-hairline bg-surface-strong font-mono tracking-[0.3em] text-ink"
                        required
                      />
                    </label>
                  ) : null}
                  <label
                    htmlFor={`${portal}-password`}
                    className="block text-xs font-medium text-ink-body"
                  >
                    {t('login.password')}
                    <Input
                      id={`${portal}-password`}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      type="password"
                      autoComplete="current-password"
                      className="mt-2 h-11 border-hairline bg-surface-strong text-ink placeholder:text-ink-muted"
                      required
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setResetMode(true);
                      setError('');
                      setResetNotice('');
                    }}
                    className="text-xs text-ink-muted hover:text-ink"
                  >
                    {t('login.forgotPassword')}
                  </button>
                  {error ? (
                    <div className="rounded-xl border border-red-400/20 bg-red-400/8 px-3 py-2.5 text-xs text-danger-text">
                      {error}
                    </div>
                  ) : null}
                  <Button
                    type="submit"
                    disabled={loading}
                    className="h-11 w-full bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {loading ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <LockKeyhole />
                    )}
                    {loading ? 'Signing in…' : 'Sign in'}
                    {!loading && <ArrowRight className="ml-auto" />}
                  </Button>
                </form>
              )}
              {!resetMode && resetNotice ? (
                <p className="mt-4 rounded-xl border border-emerald-400/15 bg-emerald-400/6 p-3 text-xs text-success-text">
                  {resetNotice}
                </p>
              ) : null}
              <div className="mt-7 flex items-center justify-between text-xs text-ink-muted">
                <Link href="/docs" className="hover:text-ink">
                  API documentation
                </Link>
                <Link
                  href={portal === 'admin' ? '/login' : '/signup'}
                  className="hover:text-ink"
                >
                  {portal === 'admin'
                    ? 'Customer login'
                    : 'Create free account'}
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
