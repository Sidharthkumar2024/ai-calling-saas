'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Bot,
  CalendarCheck2,
  Check,
  CheckCircle2,
  Database,
  FileText,
  Globe2,
  GraduationCap,
  HeartPulse,
  Home,
  Languages,
  LockKeyhole,
  Megaphone,
  MessageCircleMore,
  PhoneCall,
  Radio,
  Route,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Target,
  UsersRound,
  Webhook,
  Zap,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { VAANI_ENGINES } from '@/lib/vaani-engine-catalog';
import { LandingAgentShowcase } from '@/components/landing-agent-showcase';

type LandingPageProps = {
  onEnterWorkspace: () => void;
};

const revenueLoop = [
  {
    step: '01',
    title: 'Capture every lead',
    description:
      'Meta Lead Ads, Google Ads, website forms and CRM events enter one consent-aware lead inbox.',
    icon: Megaphone,
  },
  {
    step: '02',
    title: 'Understand the buyer',
    description:
      'Vaani Sense enriches source, intent, language, product interest, urgency and lead quality.',
    icon: Target,
  },
  {
    step: '03',
    title: 'Call at the right moment',
    description:
      'Vaani Maya speaks naturally, answers questions, handles objections and knows when to transfer.',
    icon: PhoneCall,
  },
  {
    step: '04',
    title: 'Move revenue forward',
    description:
      'Book an appointment, update CRM, send WhatsApp and keep non-converters in a retargeting loop.',
    icon: CalendarCheck2,
  },
];

const capabilities = [
  {
    title: 'AI agent studio',
    description:
      'Set goals, languages, guardrails, qualification logic and human-transfer rules.',
    icon: Bot,
    meta: 'Build',
  },
  {
    title: 'Lead command center',
    description:
      'One pipeline for ad leads, forms, CRM records, duplicates, consent and ownership.',
    icon: Database,
    meta: 'Capture',
  },
  {
    title: 'Live call operations',
    description:
      'Monitor conversations, latency, intent, sentiment and transfer readiness in real time.',
    icon: Radio,
    meta: 'Operate',
  },
  {
    title: 'Campaign automation',
    description:
      'Schedules, pacing, retries, suppression, callbacks and outcome-based follow-ups.',
    icon: Route,
    meta: 'Scale',
  },
  {
    title: 'Knowledge grounding',
    description:
      'Give agents approved websites, PDFs, pricing, product data and objection answers.',
    icon: FileText,
    meta: 'Trust',
  },
  {
    title: 'CRM & appointments',
    description:
      'Update stages, create tasks, book slots and hand hot leads to the right salesperson.',
    icon: CalendarCheck2,
    meta: 'Convert',
  },
  {
    title: 'WhatsApp follow-through',
    description:
      'Send brochures, confirmations and approved templates from the same customer timeline.',
    icon: MessageCircleMore,
    meta: 'Follow up',
  },
  {
    title: 'Audience retargeting',
    description:
      'Build consent-aware Meta and Google audiences from qualified call outcomes.',
    icon: Target,
    meta: 'Recover',
  },
];

const industryStories = {
  'Real estate': {
    icon: Home,
    eyebrow: 'Real estate revenue desk',
    title:
      'Qualify enquiries and book site visits while intent is still fresh.',
    points: [
      'Ask budget, location, timeline and financing questions',
      'Share project details and handle common objections',
      'Book site visits and route high-intent buyers to sales',
    ],
    outcome: '41 site visits from one active campaign',
  },
  Healthcare: {
    icon: HeartPulse,
    eyebrow: 'Patient access',
    title: 'Answer routine questions and fill appointment calendars, 24/7.',
    points: [
      'Handle inbound enquiries in the caller’s language',
      'Confirm availability and create appointment requests',
      'Escalate urgent or sensitive conversations to staff',
    ],
    outcome: 'Faster response without adding front-desk load',
  },
  Education: {
    icon: GraduationCap,
    eyebrow: 'Admissions automation',
    title:
      'Follow up with applicants and keep counsellors focused on serious students.',
    points: [
      'Explain programmes, eligibility and application steps',
      'Score intent and schedule counsellor callbacks',
      'Retarget undecided applicants with the right message',
    ],
    outcome: 'One conversation history across call, CRM and WhatsApp',
  },
  Commerce: {
    icon: ShoppingBag,
    eyebrow: 'D2C and services',
    title:
      'Recover demand, confirm orders and create repeatable sales motions.',
    points: [
      'Qualify high-value product enquiries',
      'Recover abandoned or missed opportunities',
      'Trigger offers and retargeting from real customer intent',
    ],
    outcome: 'Every outcome becomes an automated next action',
  },
} as const;

export function LandingPage({ onEnterWorkspace }: LandingPageProps) {
  const [activeUseCase, setActiveUseCase] =
    useState<keyof typeof industryStories>('Real estate');
  const currentStory = industryStories[activeUseCase];
  const CurrentStoryIcon = currentStory.icon;

  return (
    <main className="min-h-screen overflow-hidden bg-[#090b11] text-white">
      <div className="border-b border-white/8 bg-[#0d1018] px-4 py-2 text-center text-[11px] text-white/65 sm:text-xs">
        <span className="mr-2 inline-flex items-center gap-1.5 font-medium text-amber-300">
          <Sparkles className="size-3" /> New
        </span>
        Meta, Google and website leads now enter one call-to-revenue loop.
      </div>

      <header className="sticky top-0 z-50 border-b border-white/8 bg-[#090b11]/88 backdrop-blur-xl">
        <div className="mx-auto flex h-[70px] max-w-[1240px] items-center justify-between px-4 sm:px-6">
          <a
            href="#top"
            className="flex items-center gap-3"
            aria-label="Vaani home"
          >
            <span className="grid size-9 place-items-center rounded-xl bg-amber-300 text-[#17120a] shadow-[0_10px_35px_-12px_#fcd34d]">
              <Activity className="size-5" strokeWidth={2.4} />
            </span>
            <span>
              <span className="block text-[15px] font-semibold tracking-tight">
                Vaani
              </span>
              <span className="block text-[9px] font-semibold uppercase tracking-[0.2em] text-white/40">
                Revenue voice OS
              </span>
            </span>
          </a>

          <nav
            className="hidden items-center gap-7 text-xs text-white/60 lg:flex"
            aria-label="Landing navigation"
          >
            <a className="transition-colors hover:text-white" href="#product">
              Product
            </a>
            <a className="transition-colors hover:text-white" href="#workflow">
              How it works
            </a>
            <a
              className="transition-colors hover:text-white"
              href="#agent-demos"
            >
              Live demos
            </a>
            <a className="transition-colors hover:text-white" href="#solutions">
              Solutions
            </a>
            <a className="transition-colors hover:text-white" href="#engines">
              Vaani engines
            </a>
            <a className="transition-colors hover:text-white" href="#pricing">
              Pricing
            </a>
            <a className="transition-colors hover:text-white" href="#security">
              Security
            </a>
            <Link className="transition-colors hover:text-white" href="/docs">
              API docs
            </Link>
          </nav>

          <Button
            onClick={onEnterWorkspace}
            className="h-9 rounded-full bg-white px-4 text-xs text-black hover:bg-white/90"
          >
            Open platform <ArrowRight className="size-3.5" />
          </Button>
        </div>
      </header>

      <section id="top" className="landing-grid relative scroll-mt-24">
        <div className="pointer-events-none absolute inset-x-0 top-0 mx-auto h-[520px] max-w-[1180px] bg-[radial-gradient(circle_at_68%_12%,rgba(167,139,250,0.16),transparent_36%),radial-gradient(circle_at_20%_5%,rgba(252,211,77,0.13),transparent_32%)]" />
        <div className="relative mx-auto grid max-w-[1240px] gap-12 px-4 pb-20 pt-16 sm:px-6 sm:pt-24 xl:grid-cols-[minmax(0,0.95fr)_minmax(520px,1.05fr)] xl:items-center xl:gap-14 xl:pb-28">
          <div>
            <Badge
              variant="outline"
              className="mb-6 gap-2 rounded-full border-white/12 bg-white/5 px-3 py-1.5 text-[11px] text-white/75"
            >
              <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_12px_#34d399]" />
              AI calling for sales, support and operations
            </Badge>
            <h1
              lang="hi"
              className="max-w-3xl overflow-visible pb-2 text-[43px] font-semibold leading-[1.2] tracking-[-0.02em] sm:text-[58px] sm:leading-[1.18] lg:text-[64px]"
            >
              <span className="block pb-[0.08em]">Lead आते ही बातचीत.</span>
              <span className="mt-2 block pb-[0.12em]">
                बातचीत से{' '}
                <span className="bg-[linear-gradient(90deg,#fde68a,#c4b5fd_62%,#67e8f9)] bg-clip-text text-transparent">
                  booking और revenue.
                </span>
              </span>
            </h1>
            <p className="mt-7 max-w-xl text-base leading-7 text-white/58 sm:text-lg">
              Meta Ads, Google Ads, website forms और CRM से lead आते ही Vaani
              buyer intent समझता है, सही भाषा में बात करता है, फिर booking, payment
              link या human follow-up पूरा करता है।
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button
                onClick={onEnterWorkspace}
                size="lg"
                className="h-12 rounded-full bg-amber-300 px-6 text-[#17120a] shadow-[0_14px_40px_-14px_#fcd34d] hover:bg-amber-200"
              >
                See Vaani in action <ArrowRight />
              </Button>
              <a
                href="#workflow"
                className="inline-flex h-12 items-center justify-center rounded-full border border-white/14 bg-white/4 px-6 text-sm font-medium text-white transition-colors hover:bg-white/8"
              >
                Explore the workflow
              </a>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[11px] text-white/45">
              {[
                'Realtime WebRTC voice',
                'Consent & DNC controls',
                'Admin + customer roles',
              ].map((item) => (
                <span key={item} className="flex items-center gap-1.5">
                  <Check className="size-3 text-emerald-400" /> {item}
                </span>
              ))}
            </div>
            <div className="mt-7 grid max-w-xl grid-cols-3 gap-2">
              {[
                ['8', 'industry playbooks'],
                ['10+', 'regional voices'],
                ['1', 'lead-to-revenue timeline'],
              ].map(([value, label]) => (
                <div
                  key={label}
                  className="rounded-2xl border border-white/8 bg-white/[0.025] p-3 backdrop-blur-xl"
                >
                  <p className="text-lg font-semibold tracking-tight text-white">
                    {value}
                  </p>
                  <p className="mt-1 text-[9px] leading-4 text-white/34">
                    {label}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-5 rounded-[34px] bg-[linear-gradient(135deg,rgba(252,211,77,0.12),rgba(139,92,246,0.13),transparent)] blur-2xl" />
            <div className="relative overflow-hidden rounded-[26px] border border-white/12 bg-[#10131c] shadow-2xl shadow-black/45">
              <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-violet-400/12 text-violet-300">
                    <Sparkles className="size-3.5" />
                  </span>
                  <div>
                    <p className="text-xs font-medium">Vaani Maya · Live</p>
                    <p className="text-[9px] text-white/38">
                      NCR buyer qualification
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-emerald-300">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50" />
                    <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
                  </span>
                  Connected · 02:18
                </div>
              </div>

              <div className="grid lg:grid-cols-[1fr_185px]">
                <div className="min-w-0 border-b border-white/8 p-4 lg:border-b-0 lg:border-r">
                  <div className="mb-5 flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.025] p-3">
                    <div className="grid size-9 place-items-center rounded-full bg-cyan-300/12 text-xs font-semibold text-cyan-200">
                      AM
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">
                        Aditi Mehra
                      </p>
                      <p className="truncate text-[10px] text-white/38">
                        Meta Lead Ad · New enquiry
                      </p>
                    </div>
                    <Badge className="border-0 bg-emerald-400/10 text-[9px] text-emerald-300">
                      High intent
                    </Badge>
                  </div>

                  <div className="space-y-4 text-xs leading-5">
                    <div className="max-w-[88%] rounded-2xl rounded-tl-md bg-white/[0.055] p-3 text-white/72">
                      Hi Aditi, मैं Maya बोल रही हूँ UrbanNest से. आपने Dwarka
                      Expressway project के बारे में enquiry की थी—क्या अभी दो मिनट
                      हैं?
                    </div>
                    <div className="ml-auto max-w-[78%] rounded-2xl rounded-tr-md bg-amber-300 p-3 text-[#21190a]">
                      हाँ, 3 BHK देख रही हूँ. Budget करीब 2 crore है और possession
                      जल्दी चाहिए.
                    </div>
                    <div className="max-w-[88%] rounded-2xl rounded-tl-md bg-white/[0.055] p-3 text-white/72">
                      Perfect. आपके budget में दो options match हो रहे हैं. मैं Saturday
                      11:30 का site visit reserve कर दूँ?
                    </div>
                  </div>

                  <div
                    className="mt-6 flex h-9 items-end gap-1 rounded-xl border border-white/8 bg-black/20 px-3 py-2"
                    aria-label="Live voice activity"
                  >
                    {[
                      8, 13, 7, 18, 11, 22, 15, 10, 19, 8, 14, 6, 11, 17, 9, 5,
                      12, 7, 4,
                    ].map((height, index) => (
                      <span
                        key={`${height}-${index}`}
                        className="landing-wave flex-1 rounded-full bg-violet-300/70"
                        style={{ height }}
                      />
                    ))}
                  </div>
                </div>

                <div className="space-y-4 p-4">
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-white/35">
                      Lead score
                    </p>
                    <div className="mt-2 flex items-end gap-2">
                      <span className="font-mono text-3xl font-semibold text-emerald-300">
                        92
                      </span>
                      <span className="mb-1 text-[10px] text-white/35">
                        / 100
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
                    <div className="h-full w-[92%] rounded-full bg-[linear-gradient(90deg,#34d399,#fde68a)]" />
                  </div>
                  {[
                    ['Intent', 'Site visit'],
                    ['Budget', '₹2 crore'],
                    ['Language', 'Hinglish'],
                    ['Sentiment', 'Positive'],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between border-b border-white/7 pb-2 text-[10px]"
                    >
                      <span className="text-white/35">{label}</span>
                      <span className="font-medium text-white/75">{value}</span>
                    </div>
                  ))}
                  <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/8 p-3">
                    <p className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-300">
                      <CheckCircle2 className="size-3" /> Appointment ready
                    </p>
                    <p className="mt-1 text-[9px] leading-4 text-white/40">
                      Saturday · 11:30 AM
                      <br />
                      CRM owner: Neha
                    </p>
                  </div>
                  <div className="rounded-xl border border-violet-300/15 bg-violet-300/[0.055] p-3">
                    <p className="flex items-center gap-1.5 text-[10px] font-medium text-violet-200">
                      <Zap className="size-3" /> Realtime turn-taking
                    </p>
                    <p className="mt-1 text-[9px] leading-4 text-white/40">
                      Full-duplex audio · interruption ready
                      <br />
                      Hindi + English code-switching
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <LandingAgentShowcase />

      <section className="border-y border-white/8 bg-white/[0.018]">
        <div className="mx-auto grid max-w-[1240px] grid-cols-2 divide-x divide-y divide-white/8 px-4 sm:grid-cols-4 sm:px-6 lg:grid-cols-7 lg:divide-y-0">
          {[
            'Meta Lead Ads',
            'Google Ads',
            'Website forms',
            'CRM',
            'WhatsApp',
            'API & webhooks',
            'Google Sheets',
          ].map((source) => (
            <div
              key={source}
              className="flex h-20 items-center justify-center gap-2 px-3 text-center text-[11px] font-medium text-white/48"
            >
              <span className="size-1.5 rounded-full bg-amber-300/70" />{' '}
              {source}
            </div>
          ))}
        </div>
      </section>

      <section
        id="workflow"
        className="landing-lazy scroll-mt-24 border-b border-white/8 py-24 sm:py-28"
      >
        <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
          <div className="grid gap-8 lg:grid-cols-[0.75fr_1.25fr] lg:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">
                From click to close
              </p>
              <h2 className="mt-4 max-w-lg text-4xl font-semibold leading-[1.05] tracking-[-0.045em] sm:text-5xl">
                One continuous revenue loop.
              </h2>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-white/48 lg:justify-self-end lg:text-base">
              Vaani does not stop at making a call. It connects acquisition,
              conversation, CRM action and retargeting so every lead keeps
              moving.
            </p>
          </div>

          <div className="mt-14 grid overflow-hidden rounded-2xl border border-white/10 bg-white/[0.018] md:grid-cols-2 xl:grid-cols-4">
            {revenueLoop.map((item, index) => (
              <div
                key={item.step}
                className="relative border-b border-white/8 p-6 last:border-b-0 md:[&:nth-child(odd)]:border-r xl:border-b-0 xl:border-r xl:last:border-r-0"
              >
                {index < revenueLoop.length - 1 ? (
                  <ArrowRight className="absolute -right-3 top-8 z-10 hidden size-6 rounded-full border border-white/10 bg-[#11141c] p-1 text-white/35 xl:block" />
                ) : null}
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-white/28">
                    {item.step}
                  </span>
                  <item.icon className="size-4 text-amber-300" />
                </div>
                <h3 className="mt-8 text-base font-medium">{item.title}</h3>
                <p className="mt-3 text-xs leading-5 text-white/42">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="product"
        className="landing-grid landing-lazy scroll-mt-24 py-24 sm:py-28"
      >
        <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">
              Complete operating system
            </p>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
              Everything around the conversation.
            </h2>
            <p className="mt-5 text-sm leading-6 text-white/48">
              A focused customer workspace and a powerful platform admin—without
              raw infrastructure leaking into the product.
            </p>
          </div>

          <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {capabilities.map((item, index) => (
              <article
                key={item.title}
                className={`group min-h-[230px] rounded-2xl border border-white/9 bg-[#10131b] p-5 transition-colors hover:border-white/18 hover:bg-[#131722] ${index === 0 || index === 7 ? 'sm:col-span-2' : ''}`}
              >
                <div className="flex items-start justify-between">
                  <span className="grid size-10 place-items-center rounded-xl border border-white/8 bg-white/[0.035] text-amber-300">
                    <item.icon className="size-4.5" />
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/28">
                    {item.meta}
                  </span>
                </div>
                <h3 className="mt-10 text-lg font-medium tracking-tight">
                  {item.title}
                </h3>
                <p className="mt-3 max-w-md text-xs leading-5 text-white/42">
                  {item.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="solutions"
        className="landing-lazy scroll-mt-24 border-y border-white/8 bg-[#0d1017] py-24 sm:py-28"
      >
        <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-[310px_1fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
                Built for outcomes
              </p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-0.045em]">
                One platform.
                <br />
                Different revenue plays.
              </h2>
              <div
                className="mt-8 space-y-2"
                role="tablist"
                aria-label="Industry solutions"
              >
                {(
                  Object.keys(industryStories) as Array<
                    keyof typeof industryStories
                  >
                ).map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="tab"
                    aria-selected={activeUseCase === name}
                    onClick={() => setActiveUseCase(name)}
                    className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-sm transition-colors ${activeUseCase === name ? 'bg-white text-black' : 'text-white/48 hover:bg-white/5 hover:text-white'}`}
                  >
                    {name}
                    <ArrowRight className="size-3.5" />
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-[#11141d] p-6 sm:p-8 lg:p-10">
              <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-xl">
                  <div className="grid size-12 place-items-center rounded-2xl bg-emerald-300/10 text-emerald-300">
                    <CurrentStoryIcon className="size-5" />
                  </div>
                  <p className="mt-8 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">
                    {currentStory.eyebrow}
                  </p>
                  <h3 className="mt-3 text-2xl font-medium leading-tight tracking-[-0.03em] sm:text-3xl">
                    {currentStory.title}
                  </h3>
                  <ul className="mt-7 space-y-3">
                    {currentStory.points.map((point) => (
                      <li
                        key={point}
                        className="flex gap-3 text-sm leading-6 text-white/52"
                      >
                        <CheckCircle2 className="mt-1 size-4 shrink-0 text-emerald-300" />
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="w-full max-w-[255px] rounded-2xl border border-white/9 bg-black/25 p-5">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">
                    Live outcome
                  </p>
                  <p className="mt-5 text-lg font-medium leading-7">
                    {currentStory.outcome}
                  </p>
                  <div className="mt-6 space-y-3">
                    {[
                      'Lead understood',
                      'Call completed',
                      'CRM updated',
                      'Next action queued',
                    ].map((label, index) => (
                      <div
                        key={label}
                        className="flex items-center gap-2 text-[10px] text-white/45"
                      >
                        <span
                          className={`size-1.5 rounded-full ${index < 3 ? 'bg-emerald-400' : 'bg-amber-300'}`}
                        />
                        {label}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="engines"
        className="landing-lazy scroll-mt-24 py-24 sm:py-28"
      >
        <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
          <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
                The Vaani engine family
              </p>
              <h2 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-[-0.045em] sm:text-5xl">
                One brand across the entire voice stack.
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-white/48 lg:justify-self-end">
              Customers work with Vaani’s product capabilities—not a maze of
              infrastructure vendors, model IDs or provider credentials.
            </p>
          </div>
          <div className="mt-14 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {VAANI_ENGINES.map((engine) => (
              <article
                key={engine.name}
                className="rounded-2xl border border-white/9 bg-white/[0.022] p-5"
              >
                <div className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-xl bg-cyan-300/10 text-cyan-300">
                    <engine.icon className="size-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-medium">{engine.name}</h3>
                    <p className="mt-0.5 text-[9px] uppercase tracking-[0.14em] text-white/28">
                      {engine.role}
                    </p>
                  </div>
                </div>
                <p className="mt-6 text-xs leading-5 text-white/42">
                  {engine.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="pricing"
        className="landing-lazy scroll-mt-24 border-y border-white/8 bg-[#0d1017] py-24 sm:py-28"
      >
        <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">
              Simple launch plans
            </p>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
              Start free. Add capacity when calls grow.
            </h2>
            <p className="mt-5 text-sm leading-6 text-white/48">
              A subscription defines product capacity; credits cover calling and
              AI usage. Top up anytime and download a tax invoice for every
              purchase.
            </p>
          </div>
          <div className="mt-14 grid gap-4 lg:grid-cols-3">
            {[
              {
                name: 'Free',
                price: '₹0',
                note: 'Validate your first workflow',
                features: [
                  '100 trial credits',
                  '1 AI agent',
                  'CRM lite',
                  'API sandbox',
                ],
              },
              {
                name: 'Growth',
                price: '₹7,999',
                note: 'For active sales and support teams',
                features: [
                  '10,000 monthly credits',
                  '5 AI agents',
                  'Advanced CRM',
                  'API, webhooks & retargeting',
                ],
                featured: true,
              },
              {
                name: 'Scale',
                price: '₹24,999',
                note: 'For multi-team call operations',
                features: [
                  '50,000 monthly credits',
                  '20 AI agents',
                  'Priority routing',
                  'SLA and advanced controls',
                ],
              },
            ].map((plan) => (
              <article
                key={plan.name}
                className={`relative rounded-2xl border p-6 ${plan.featured ? 'border-amber-300/30 bg-amber-300/[0.045]' : 'border-white/9 bg-white/[0.022]'}`}
              >
                {plan.featured ? (
                  <span className="absolute -top-3 left-6 rounded-full bg-amber-300 px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-[#17120a]">
                    Recommended
                  </span>
                ) : null}
                <h3 className="text-lg font-medium">{plan.name}</h3>
                <p className="mt-2 text-xs text-white/38">{plan.note}</p>
                <p className="mt-7 text-4xl font-semibold tracking-tight">
                  {plan.price}
                  <span className="text-xs font-normal text-white/32">
                    {' '}
                    / month
                  </span>
                </p>
                <div className="mt-7 space-y-3">
                  {plan.features.map((feature) => (
                    <div
                      key={feature}
                      className="flex items-center gap-2 text-xs text-white/52"
                    >
                      <Check className="size-3.5 text-emerald-300" /> {feature}
                    </div>
                  ))}
                </div>
                {plan.name === 'Free' ? (
                  <Link
                    href="/signup"
                    className="mt-8 inline-flex h-8 w-full items-center justify-center rounded-lg bg-white px-2.5 text-sm font-medium text-black transition-colors hover:bg-white/90"
                  >
                    Start free
                  </Link>
                ) : (
                  <Button
                    onClick={onEnterWorkspace}
                    className={`mt-8 w-full ${plan.featured ? 'bg-amber-300 text-[#17120a] hover:bg-amber-200' : 'bg-white text-black hover:bg-white/90'}`}
                  >{`Choose ${plan.name}`}</Button>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="security"
        className="landing-lazy border-y border-white/8 bg-[#0d1017] py-20 sm:py-24"
      >
        <div className="mx-auto grid max-w-[1240px] gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1fr] lg:items-center">
          <div>
            <Badge
              variant="outline"
              className="gap-2 rounded-full border-emerald-400/18 bg-emerald-400/7 text-emerald-300"
            >
              <ShieldCheck className="size-3.5" /> Built for responsible calling
            </Badge>
            <h2 className="mt-6 text-4xl font-semibold tracking-[-0.045em]">
              Strong controls for teams that call at scale.
            </h2>
            <p className="mt-5 max-w-xl text-sm leading-6 text-white/48">
              Tenant isolation, role-based access, consent evidence, DNC
              suppression, audit trails and human escalation are part of the
              operating model—not afterthoughts.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              [
                LockKeyhole,
                'Tenant isolation',
                'Every company’s leads, knowledge and calls stay separated.',
              ],
              [
                UsersRound,
                'Role-based access',
                'Customer, agent and platform-admin permissions stay distinct.',
              ],
              [
                BadgeCheck,
                'Consent evidence',
                'Source, timestamp and calling permission travel with each lead.',
              ],
              [
                Webhook,
                'Auditable automation',
                'Every workflow run and external delivery has a traceable status.',
              ],
            ].map(([Icon, title, description]) => {
              const SecurityIcon = Icon as typeof LockKeyhole;
              return (
                <div
                  key={title as string}
                  className="rounded-2xl border border-white/8 bg-white/[0.02] p-5"
                >
                  <SecurityIcon className="size-4 text-emerald-300" />
                  <h3 className="mt-6 text-sm font-medium">
                    {title as string}
                  </h3>
                  <p className="mt-2 text-xs leading-5 text-white/38">
                    {description as string}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="py-20 sm:py-24">
        <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
          <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_85%_10%,rgba(167,139,250,0.19),transparent_28%),radial-gradient(circle_at_10%_90%,rgba(252,211,77,0.14),transparent_30%),#12151e] px-6 py-12 sm:px-10 lg:flex lg:items-end lg:justify-between lg:px-14 lg:py-16">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">
                Your next lead is already waiting
              </p>
              <h2 className="mt-5 text-4xl font-semibold leading-tight tracking-[-0.045em] sm:text-5xl">
                Give every enquiry a real conversation.
              </h2>
              <p className="mt-5 text-sm leading-6 text-white/48">
                Open the product workspace to explore customer and admin panels,
                CRM, lead capture, calling and retargeting.
              </p>
            </div>
            <Button
              onClick={onEnterWorkspace}
              size="lg"
              className="mt-8 h-12 rounded-full bg-white px-6 text-black hover:bg-white/90 lg:mt-0"
            >
              Open Vaani platform <ArrowRight />
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/8 py-8">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-5 px-4 text-[11px] text-white/32 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 text-white/62">
            <Activity className="size-4 text-amber-300" />
            <span className="font-medium">Vaani</span>
            <span>AI calling operations</span>
          </div>
          <div className="flex flex-wrap gap-5">
            <Link href="/signup" className="hover:text-white">
              Create free account
            </Link>
            <Link href="/login" className="hover:text-white">
              Customer login
            </Link>
            <Link href="/admin/login" className="hover:text-white">
              Admin login
            </Link>
            <Link href="/docs" className="hover:text-white">
              API docs
            </Link>
            <span className="flex items-center gap-1.5">
              <Globe2 className="size-3" /> India-ready
            </span>
            <span className="flex items-center gap-1.5">
              <Languages className="size-3" /> Multilingual
            </span>
            <span className="flex items-center gap-1.5">
              <Zap className="size-3" /> Phase 2: Android & iOS
            </span>
          </div>
        </div>
      </footer>
    </main>
  );
}
