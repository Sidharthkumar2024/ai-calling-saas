'use client';

import { useState } from 'react';
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

type PortalLoginProps = {
  portal: 'admin' | 'customer';
};

const portalCopy = {
  admin: {
    eyebrow: 'Platform control',
    title: 'Vaani admin console',
    description:
      'Manage tenants, KYC, calling operations, plans, credits, integrations and platform health.',
    email: 'admin@vaani.local',
    password: 'VaaniAdmin#2026',
    icon: ShieldCheck,
    accent: 'from-amber-300/20 via-violet-400/10 to-transparent',
  },
  customer: {
    eyebrow: 'Customer workspace',
    title: 'Run your revenue voice OS',
    description:
      'Capture leads, qualify intent, automate calling, manage CRM and measure every revenue outcome.',
    email: 'owner@vaani.local',
    password: 'VaaniUser#2026',
    icon: Building2,
    accent: 'from-cyan-300/15 via-violet-400/10 to-transparent',
  },
};

export function PortalLogin({ portal }: PortalLoginProps) {
  const config = portalCopy[portal];
  const Icon = config.icon;
  const [email, setEmail] = useState(config.email);
  const [password, setPassword] = useState(config.password);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: { preventDefault: () => void }) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, portal }),
      });
      const payload = (await response.json()) as {
        error?: string;
        redirectTo?: string;
      };
      if (!response.ok || !payload.redirectTo) {
        throw new Error(payload.error || 'Unable to sign in.');
      }
      window.location.assign(payload.redirectTo);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to sign in.');
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#090b11] text-white">
      <div className={`pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(252,211,77,0.12),transparent_32%),radial-gradient(circle_at_82%_15%,rgba(139,92,246,0.12),transparent_32%)]`} />
      <div className="relative mx-auto flex min-h-screen max-w-[1180px] items-center px-4 py-10 sm:px-6">
        <div className="grid w-full overflow-hidden rounded-[30px] border border-white/10 bg-[#0e1119]/94 shadow-2xl shadow-black/40 lg:grid-cols-[0.92fr_1.08fr]">
          <section className={`relative hidden min-h-[690px] overflow-hidden border-r border-white/8 bg-gradient-to-br ${config.accent} p-10 lg:flex lg:flex-col`}>
            <Link href="/" className="flex items-center gap-3 text-white" aria-label="Vaani home">
              <span className="grid size-10 place-items-center rounded-xl bg-amber-300 text-[#17120a]">
                <Activity className="size-5" />
              </span>
              <span>
                <span className="block text-base font-semibold">Vaani</span>
                <span className="block text-[10px] uppercase tracking-[0.2em] text-white/45">Revenue Voice OS</span>
              </span>
            </Link>
            <div className="my-auto max-w-md">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-white/65">
                <Sparkles className="size-3 text-amber-300" /> {config.eyebrow}
              </span>
              <h1 className="mt-6 text-5xl font-semibold leading-[1.02] tracking-[-0.05em]">{config.title}</h1>
              <p className="mt-5 text-base leading-7 text-white/55">{config.description}</p>
              <div className="mt-8 space-y-3 text-sm text-white/68">
                {[
                  'Strict role and tenant isolation',
                  'HttpOnly sessions and hashed credentials',
                  'Secrets encrypted at rest',
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <CheckCircle2 className="size-4 text-emerald-400" /> {item}
                  </div>
                ))}
              </div>
            </div>
            <p className="text-xs text-white/35">Local development workspace · Vaani control plane</p>
          </section>

          <section className="flex min-h-[690px] items-center justify-center p-6 sm:p-10 lg:p-14">
            <div className="w-full max-w-md">
              <Link href="/" className="mb-10 inline-flex items-center gap-2 text-xs text-white/45 transition-colors hover:text-white lg:hidden">
                <ArrowLeft className="size-3.5" /> Back to Vaani
              </Link>
              <span className="grid size-12 place-items-center rounded-2xl border border-white/10 bg-white/5">
                <Icon className="size-5 text-amber-300" />
              </span>
              <p className="mt-7 text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">{config.eyebrow}</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">Sign in</h2>
              <p className="mt-2 text-sm leading-6 text-white/48">Use the dedicated {portal} account. Accounts cannot cross between portals.</p>

              <div className="mt-6 rounded-2xl border border-white/9 bg-white/[0.035] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">Local demo credentials</p>
                    <p className="mt-2 font-mono text-xs text-white/72">{config.email}</p>
                    <p className="mt-1 font-mono text-xs text-white/72">{config.password}</p>
                  </div>
                  <KeyRound className="size-5 text-white/25" />
                </div>
              </div>

              {portal === 'customer' ? <SocialAuthButtons /> : null}

              <form className={`${portal === 'customer' ? 'mt-2' : 'mt-7'} space-y-4`} onSubmit={submit}>
                <label htmlFor={`${portal}-email`} className="block text-xs font-medium text-white/65">
                  Email
                  <Input
                    id={`${portal}-email`}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    type="email"
                    autoComplete="username"
                    className="mt-2 h-11 border-white/10 bg-white/[0.035] text-white placeholder:text-white/25"
                    required
                  />
                </label>
                <label htmlFor={`${portal}-password`} className="block text-xs font-medium text-white/65">
                  Password
                  <Input
                    id={`${portal}-password`}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    autoComplete="current-password"
                    className="mt-2 h-11 border-white/10 bg-white/[0.035] text-white placeholder:text-white/25"
                    required
                  />
                </label>
                {error ? (
                  <div className="rounded-xl border border-red-400/20 bg-red-400/8 px-3 py-2.5 text-xs text-red-200">{error}</div>
                ) : null}
                <Button type="submit" disabled={loading} className="h-11 w-full bg-amber-300 text-[#17120a] hover:bg-amber-200">
                  {loading ? <Loader2 className="animate-spin" /> : <LockKeyhole />}
                  {loading ? 'Signing in…' : `Open ${portal} portal`}
                  {!loading && <ArrowRight className="ml-auto" />}
                </Button>
              </form>
              <div className="mt-7 flex items-center justify-between text-xs text-white/38">
                <Link href="/docs" className="hover:text-white">API documentation</Link>
                <Link href={portal === 'admin' ? '/login' : '/signup'} className="hover:text-white">
                  {portal === 'admin' ? 'Customer login' : 'Create free account'}
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
