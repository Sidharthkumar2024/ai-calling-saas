'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Languages,
  Loader2,
  Mic2,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SocialAuthButtons } from '@/components/social-auth-buttons';

type SignupForm = {
  name: string;
  businessName: string;
  email: string;
  password: string;
  phone: string;
  useCase: string;
  language: string;
};

const steps = [
  { label: 'Your account', icon: UserRound },
  { label: 'Business', icon: Building2 },
  { label: 'First agent', icon: Mic2 },
];

export function CustomerSignup({ inviteToken }: { inviteToken?: string }) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [inviteRole, setInviteRole] = useState('');
  const [form, setForm] = useState<SignupForm>({
    name: '',
    businessName: '',
    email: '',
    password: '',
    phone: '',
    useCase: 'commerce_sales',
    language: 'hinglish',
  });

  useEffect(() => {
    if (!inviteToken) return;
    fetch(`/api/auth/team-invite?token=${encodeURIComponent(inviteToken)}`, {
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          error?: string;
          email?: string;
          role?: string;
          organizationName?: string;
        };
        if (!response.ok)
          throw new Error(payload.error ?? 'Invitation is invalid.');
        setForm((current) => ({
          ...current,
          email: payload.email ?? '',
          businessName: payload.organizationName ?? '',
        }));
        setInviteRole(payload.role ?? 'agent');
      })
      .catch((caught) =>
        setError(
          caught instanceof Error ? caught.message : 'Invitation is invalid.',
        ),
      );
  }, [inviteToken]);

  function update<Key extends keyof SignupForm>(
    key: Key,
    value: SignupForm[Key],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function next() {
    setError('');
    if (
      step === 0 &&
      (!form.name.trim() || !form.email.trim() || form.password.length < 10)
    ) {
      setError(
        'Enter your name, email and a password of at least 10 characters.',
      );
      return;
    }
    if (step === 1 && !form.businessName.trim()) {
      setError('Enter your business name.');
      return;
    }
    setStep((current) => Math.min(2, current + 1));
  }

  async function createAccount() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...form,
          ...(inviteToken ? { inviteToken } : {}),
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        redirectTo?: string;
      };
      if (!response.ok || !payload.redirectTo) {
        throw new Error(payload.error ?? 'Unable to create account.');
      }
      window.location.assign(payload.redirectTo);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to create account.',
      );
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#090b11] px-4 py-8 text-white sm:px-6">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(252,211,77,0.12),transparent_31%),radial-gradient(circle_at_82%_18%,rgba(124,58,237,0.16),transparent_32%)]" />
      <div className="relative mx-auto max-w-[1180px]">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-amber-300 text-[#17120a]">
              <Activity className="size-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold">Vaani</span>
              <span className="block text-[9px] uppercase tracking-[0.18em] text-white/35">
                Revenue Voice OS
              </span>
            </span>
          </Link>
          <Link
            href="/login"
            className="text-xs text-white/45 hover:text-white"
          >
            Already have an account? <span className="text-white">Sign in</span>
          </Link>
        </div>

        <div className="mt-8 grid overflow-hidden rounded-[30px] border border-white/10 bg-[#0e1119]/95 shadow-2xl shadow-black/40 lg:grid-cols-[0.78fr_1.22fr]">
          <aside className="border-b border-white/8 bg-white/[0.018] p-6 sm:p-8 lg:min-h-[700px] lg:border-b-0 lg:border-r lg:p-10">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/15 bg-amber-300/5 px-3 py-1.5 text-[10px] text-amber-200">
              <Sparkles className="size-3.5" />{' '}
              {inviteToken
                ? `Team invitation · ${inviteRole.replaceAll('_', ' ') || 'checking'}`
                : '100 free trial credits'}
            </span>
            <h1 className="mt-6 text-4xl font-semibold leading-tight tracking-[-0.045em]">
              Hear your first agent before making a phone call.
            </h1>
            <p className="mt-4 text-sm leading-6 text-white/45">
              Create a workspace, choose a use case and test the conversation
              over text or browser voice. A real phone number is required only
              when you publish.
            </p>
            <div className="mt-9 space-y-3">
              {steps.map((item, index) => (
                <div
                  key={item.label}
                  className={`flex items-center gap-3 rounded-2xl border p-4 ${index === step ? 'border-amber-300/22 bg-amber-300/[0.045]' : index < step ? 'border-emerald-400/15 bg-emerald-400/[0.035]' : 'border-white/7 bg-white/[0.015]'}`}
                >
                  <span
                    className={`grid size-9 place-items-center rounded-xl ${index <= step ? 'bg-white/8 text-amber-200' : 'bg-white/[0.03] text-white/25'}`}
                  >
                    {index < step ? (
                      <Check className="size-4 text-emerald-300" />
                    ) : (
                      <item.icon className="size-4" />
                    )}
                  </span>
                  <div>
                    <p className="text-xs font-medium">{item.label}</p>
                    <p className="mt-1 text-[9px] text-white/30">
                      Step {index + 1} of 3
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </aside>

          <section className="flex min-h-[620px] items-center justify-center p-6 sm:p-10 lg:p-14">
            <div className="w-full max-w-xl">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">
                Step {step + 1}
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight">
                {step === 0
                  ? 'Create your account'
                  : step === 1
                    ? 'Tell us about the business'
                    : 'Configure the first conversation'}
              </h2>
              <p className="mt-2 text-sm leading-6 text-white/42">
                {step === 0
                  ? 'One owner account for your isolated workspace.'
                  : step === 1
                    ? 'This becomes the public business identity used by the agent.'
                    : 'You can change every setting later in Agent Studio.'}
              </p>

              <div className="mt-8 space-y-4">
                {step === 0 ? (
                  <>
                    {!inviteToken ? <SocialAuthButtons /> : null}
                    <Field label="Your name">
                      <Input
                        value={form.name}
                        onChange={(event) => update('name', event.target.value)}
                        autoComplete="name"
                      />
                    </Field>
                    <Field label="Work email">
                      <Input
                        type="email"
                        value={form.email}
                        onChange={(event) =>
                          update('email', event.target.value)
                        }
                        autoComplete="email"
                        readOnly={Boolean(inviteToken)}
                      />
                    </Field>
                    <Field label="Password">
                      <Input
                        type="password"
                        value={form.password}
                        onChange={(event) =>
                          update('password', event.target.value)
                        }
                        autoComplete="new-password"
                        placeholder="10+ characters with a number"
                      />
                    </Field>
                  </>
                ) : null}
                {step === 1 ? (
                  <>
                    <Field label="Business name">
                      <Input
                        value={form.businessName}
                        onChange={(event) =>
                          update('businessName', event.target.value)
                        }
                        autoComplete="organization"
                        readOnly={Boolean(inviteToken)}
                      />
                    </Field>
                    <Field label="Phone number (optional during trial)">
                      <Input
                        value={form.phone}
                        onChange={(event) =>
                          update('phone', event.target.value)
                        }
                        autoComplete="tel"
                        placeholder="+91 98765 43210"
                      />
                    </Field>
                    <div className="rounded-2xl border border-cyan-300/12 bg-cyan-300/[0.035] p-4 text-xs leading-5 text-white/48">
                      <ShieldCheck className="mb-2 size-4 text-cyan-200" />{' '}
                      Trial agents cannot call arbitrary phone numbers.
                      Publishing requires number ownership verification,
                      business KYC and calling consent.
                    </div>
                  </>
                ) : null}
                {step === 2 ? (
                  <>
                    <Field label="Primary use case">
                      <select
                        value={form.useCase}
                        onChange={(event) =>
                          update('useCase', event.target.value)
                        }
                        className="h-11 w-full rounded-lg border border-white/10 bg-[#121620] px-3 text-sm"
                      >
                        <option value="commerce_sales">
                          Product sales & payments
                        </option>
                        <option value="lead_qualification">
                          Lead qualification
                        </option>
                        <option value="appointments">Appointments</option>
                        <option value="customer_support">
                          Customer support
                        </option>
                        <option value="collections">Collections</option>
                        <option value="sales">General sales</option>
                      </select>
                    </Field>
                    <Field label="Primary language">
                      <div className="relative">
                        <Languages className="pointer-events-none absolute left-3 top-3.5 size-4 text-white/28" />
                        <select
                          value={form.language}
                          onChange={(event) =>
                            update('language', event.target.value)
                          }
                          className="h-11 w-full rounded-lg border border-white/10 bg-[#121620] pl-10 pr-3 text-sm"
                        >
                          <option value="hinglish">Hinglish</option>
                          <option value="haryanvi">Haryanvi</option>
                          <option value="hi-IN">Hindi</option>
                          <option value="en-IN">Indian English</option>
                          <option value="bn-IN">Bengali</option>
                          <option value="ta-IN">Tamil</option>
                          <option value="te-IN">Telugu</option>
                          <option value="mr-IN">Marathi</option>
                        </select>
                      </div>
                    </Field>
                    <div className="rounded-2xl border border-white/8 bg-white/[0.025] p-4">
                      <p className="text-xs font-medium">What happens next</p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {[
                          'Draft agent created',
                          '100 credits granted',
                          '10-credit text test',
                          'Browser voice preview',
                        ].map((item) => (
                          <span
                            key={item}
                            className="flex items-center gap-2 text-[10px] text-white/42"
                          >
                            <Check className="size-3 text-emerald-300" />
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  </>
                ) : null}
              </div>

              {error ? (
                <div className="mt-5 rounded-xl border border-red-400/18 bg-red-400/7 p-3 text-xs text-red-100">
                  {error}
                </div>
              ) : null}
              <div className="mt-7 flex items-center gap-3">
                {step > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep((current) => current - 1)}
                    className="border-white/10 bg-transparent"
                  >
                    <ArrowLeft /> Back
                  </Button>
                ) : null}
                <Button
                  type="button"
                  disabled={loading}
                  onClick={step === 2 ? createAccount : next}
                  className="ml-auto bg-amber-300 text-[#17120a] hover:bg-amber-200"
                >
                  {loading ? <Loader2 className="animate-spin" /> : null}
                  {loading
                    ? 'Creating workspace…'
                    : step === 2
                      ? 'Create account & test agent'
                      : 'Continue'}
                  {!loading ? <ArrowRight /> : null}
                </Button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-xs font-medium text-white/58">
      {label}
      <div className="mt-2 [&_input]:h-11 [&_input]:border-white/10 [&_input]:bg-white/[0.025]">
        {children}
      </div>
    </label>
  );
}
