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
import { useLocale } from '@/components/locale-provider';
import { PORTAL_LOCALES, type TranslationKey } from '@/lib/i18n';

type LandingPageProps = {
  onEnterWorkspace: () => void;
};

/**
 * Copy lives in the translation catalog, not here, so word order belongs to
 * each language rather than to the JSX.
 */
const revenueLoop = [
  { step: '01', key: 'landing.loop.1', icon: Megaphone },
  { step: '02', key: 'landing.loop.2', icon: Target },
  { step: '03', key: 'landing.loop.3', icon: PhoneCall },
  { step: '04', key: 'landing.loop.4', icon: CalendarCheck2 },
] as const;

const capabilities = [
  { key: 'landing.cap.studio', icon: Bot },
  { key: 'landing.cap.leads', icon: Database },
  { key: 'landing.cap.live', icon: Radio },
  { key: 'landing.cap.campaigns', icon: Route },
  { key: 'landing.cap.knowledge', icon: FileText },
  { key: 'landing.cap.crm', icon: CalendarCheck2 },
  { key: 'landing.cap.whatsapp', icon: MessageCircleMore },
  { key: 'landing.cap.retargeting', icon: Target },
] as const;

const industryStories = [
  { key: 'landing.industry.realEstate', icon: Home },
  { key: 'landing.industry.healthcare', icon: HeartPulse },
  { key: 'landing.industry.education', icon: GraduationCap },
  { key: 'landing.industry.commerce', icon: ShoppingBag },
] as const;

export function LandingPage({ onEnterWorkspace }: LandingPageProps) {
  const { locale, setLocale, t } = useLocale();
  const [activeUseCase, setActiveUseCase] = useState(0);
  const currentStory = industryStories[activeUseCase];
  const CurrentStoryIcon = currentStory.icon;
  /** Builds a sub-key of one catalog entry, e.g. `…realEstate.point2`. */
  const sub = (base: string, leaf: string) =>
    t(`${base}.${leaf}` as TranslationKey);

  return (
    <main className="min-h-screen overflow-hidden bg-[#090b11] text-white">
      <div className="border-b border-white/8 bg-[#0d1018] px-4 py-2 text-center text-[11px] text-white/65 sm:text-xs">
        <span className="mr-2 inline-flex items-center gap-1.5 font-medium text-amber-300">
          <Sparkles className="size-3" /> {t('landing.banner.new')}
        </span>
        {t('landing.banner.text')}
      </div>

      <header className="sticky top-0 z-50 border-b border-white/8 bg-[#090b11]/88 backdrop-blur-xl">
        <div className="mx-auto flex h-[70px] max-w-[1240px] items-center justify-between px-4 sm:px-6">
          <a
            href="#top"
            className="flex items-center gap-3"
            aria-label={t('landing.home.aria')}
          >
            <span className="grid size-9 place-items-center rounded-xl bg-amber-300 text-[#17120a] shadow-[0_10px_35px_-12px_#fcd34d]">
              <Activity className="size-5" strokeWidth={2.4} />
            </span>
            <span>
              <span className="block text-[15px] font-semibold tracking-tight">
                Vaani
              </span>
              <span className="block text-[9px] font-semibold uppercase tracking-[0.2em] text-white/40">
                {t('landing.tagline')}
              </span>
            </span>
          </a>

          <nav
            className="hidden items-center gap-7 text-xs text-white/60 lg:flex"
            aria-label={t('landing.nav.aria')}
          >
            {(
              [
                ['#product', 'landing.nav.product'],
                ['#workflow', 'landing.nav.workflow'],
                ['#agent-demos', 'landing.nav.demos'],
                ['#solutions', 'landing.nav.solutions'],
                ['#engines', 'landing.nav.engines'],
                ['#pricing', 'landing.nav.pricing'],
                ['#security', 'landing.nav.security'],
              ] as Array<[string, TranslationKey]>
            ).map(([href, key]) => (
              <a
                key={href}
                className="transition-colors hover:text-white"
                href={href}
              >
                {t(key)}
              </a>
            ))}
            <Link className="transition-colors hover:text-white" href="/docs">
              {t('landing.nav.apiDocs')}
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            {/* A visitor whose browser is set to Hindi already lands in Hindi;
                this is for everyone else, and for changing your mind. */}
            <label>
              <span className="sr-only">{t('shell.language')}</span>
              <select
                aria-label={t('shell.language')}
                value={locale}
                onChange={(event) =>
                  setLocale(event.target.value as typeof locale)
                }
                className="rounded-full border border-white/12 bg-white/5 px-2.5 py-1.5 text-[11px] text-white/70 outline-none focus:border-white/30"
              >
                {PORTAL_LOCALES.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.nativeLabel}
                  </option>
                ))}
              </select>
            </label>
            <Button
              onClick={onEnterWorkspace}
              className="h-9 rounded-full bg-white px-4 text-xs text-black hover:bg-white/90"
            >
              {t('landing.openPlatform')} <ArrowRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </header>

      <section id="top" className="landing-grid relative scroll-mt-24">
        <div className="pointer-events-none absolute inset-x-0 top-0 mx-auto h-[580px] max-w-[1220px] bg-[radial-gradient(circle_at_72%_6%,rgba(139,92,246,0.20),transparent_44%),radial-gradient(circle_at_28%_0%,rgba(56,189,248,0.08),transparent_42%),radial-gradient(circle_at_50%_46%,rgba(251,191,36,0.05),transparent_58%)]" />
        <div className="relative mx-auto grid max-w-[1240px] gap-12 px-4 pb-20 pt-16 sm:px-6 sm:pt-24 xl:grid-cols-[minmax(0,0.95fr)_minmax(520px,1.05fr)] xl:items-center xl:gap-14 xl:pb-28">
          <div>
            <Badge
              variant="outline"
              className="mb-6 gap-2 rounded-full border-white/12 bg-white/5 px-3 py-1.5 text-[11px] text-white/75"
            >
              <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_12px_#34d399]" />
              {t('landing.hero.badge')}
            </Badge>
            <h1 className="max-w-3xl overflow-visible pb-2 text-[43px] font-semibold leading-[1.2] tracking-[-0.02em] sm:text-[58px] sm:leading-[1.18] lg:text-[64px]">
              <span className="block pb-[0.08em]">
                {t('landing.hero.line1')}
              </span>
              <span className="mt-2 block pb-[0.12em]">
                {t('landing.hero.line2')}{' '}
                <span className="bg-[linear-gradient(96deg,#fcd34d_0%,#fb9ec8_50%,#a78bfa_100%)] bg-clip-text text-transparent">
                  {t('landing.hero.line2Accent')}
                </span>
              </span>
              {/* Value-forward slogan: human-like AI conversation → revenue */}
            </h1>
            <p className="mt-7 max-w-xl text-base leading-7 text-white/58 sm:text-lg">
              {t('landing.hero.sub')}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button
                onClick={onEnterWorkspace}
                size="lg"
                className="h-12 rounded-full bg-amber-300 px-6 text-[#17120a] shadow-[0_14px_40px_-14px_#fcd34d] hover:bg-amber-200"
              >
                {t('landing.hero.cta')} <ArrowRight />
              </Button>
              <a
                href="#workflow"
                className="inline-flex h-12 items-center justify-center rounded-full border border-white/14 bg-white/4 px-6 text-sm font-medium text-white transition-colors hover:bg-white/8"
              >
                {t('landing.hero.secondary')}
              </a>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[11px] text-white/45">
              {(
                [
                  'landing.hero.check1',
                  'landing.hero.check2',
                  'landing.hero.check3',
                ] as TranslationKey[]
              ).map((key) => (
                <span key={key} className="flex items-center gap-1.5">
                  <Check className="size-3 text-emerald-400" /> {t(key)}
                </span>
              ))}
            </div>
            <div className="mt-7 grid max-w-xl grid-cols-3 gap-2">
              {(
                [
                  ['8', 'landing.hero.stat1'],
                  ['10+', 'landing.hero.stat2'],
                  ['1', 'landing.hero.stat3'],
                ] as Array<[string, TranslationKey]>
              ).map(([value, key]) => (
                <div
                  key={key}
                  className="rounded-2xl border border-white/8 bg-white/[0.025] p-3 backdrop-blur-xl"
                >
                  <p className="text-lg font-semibold tracking-tight text-white">
                    {value}
                  </p>
                  <p className="mt-1 text-[9px] leading-4 text-white/34">
                    {t(key)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-5 rounded-[34px] bg-[linear-gradient(135deg,rgba(252,211,77,0.12),rgba(244,114,182,0.10),rgba(139,92,246,0.15),transparent)] blur-2xl" />
            <div className="relative overflow-hidden rounded-[26px] border border-white/12 bg-[#10131c] shadow-2xl shadow-black/45">
              <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-violet-400/12 text-violet-300">
                    <Sparkles className="size-3.5" />
                  </span>
                  <div>
                    <p className="text-xs font-medium">
                      Vaani Sara · {t('landing.demo.live')}
                    </p>
                    <p className="text-[9px] text-white/38">
                      {t('landing.demo.context')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-emerald-300">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50" />
                    <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
                  </span>
                  {t('landing.demo.connected')} · 02:18
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
                        {t('landing.demo.source')}
                      </p>
                    </div>
                    <Badge className="border-0 bg-emerald-400/10 text-[9px] text-emerald-300">
                      {t('landing.demo.highIntent')}
                    </Badge>
                  </div>

                  <div className="space-y-4 text-xs leading-5">
                    <div className="max-w-[88%] rounded-2xl rounded-tl-md bg-white/[0.055] p-3 text-white/72">
                      Hi Aditi, मैं Sara बोल रही हूँ UrbanNest से. आपने Dwarka
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
                    aria-label={t('landing.demo.voiceAria')}
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
                      {t('landing.demo.leadScore')}
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
                  {(
                    [
                      [t('landing.demo.intent'), t('landing.demo.intentValue')],
                      [t('landing.demo.budget'), '₹2 crore'],
                      [t('landing.demo.language'), 'Hinglish'],
                      [
                        t('landing.demo.sentiment'),
                        t('landing.demo.sentimentValue'),
                      ],
                    ] as Array<[string, string]>
                  ).map(([label, value]) => (
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
                      <CheckCircle2 className="size-3" />{' '}
                      {t('landing.demo.appointmentReady')}
                    </p>
                    <p className="mt-1 text-[9px] leading-4 text-white/40">
                      {t('landing.demo.appointmentWhen')}
                      <br />
                      {t('landing.demo.crmOwner')}
                    </p>
                  </div>
                  <div className="rounded-xl border border-violet-300/15 bg-violet-300/[0.055] p-3">
                    <p className="flex items-center gap-1.5 text-[10px] font-medium text-violet-200">
                      <Zap className="size-3" /> {t('landing.demo.turnTaking')}
                    </p>
                    <p className="mt-1 text-[9px] leading-4 text-white/40">
                      {t('landing.demo.duplex')}
                      <br />
                      {t('landing.demo.codeSwitch')}
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
            t('landing.sources.forms'),
            'CRM',
            'WhatsApp',
            t('landing.sources.apis'),
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
                {t('landing.loop.eyebrow')}
              </p>
              <h2 className="mt-4 max-w-lg text-4xl font-semibold leading-[1.05] tracking-[-0.045em] sm:text-5xl">
                {t('landing.loop.title')}
              </h2>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-white/48 lg:justify-self-end lg:text-base">
              {t('landing.loop.sub')}
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
                <h3 className="mt-8 text-base font-medium">
                  {sub(item.key, 'title')}
                </h3>
                <p className="mt-3 text-xs leading-5 text-white/42">
                  {sub(item.key, 'description')}
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
              {t('landing.product.eyebrow')}
            </p>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
              {t('landing.product.title')}
            </h2>
            <p className="mt-5 text-sm leading-6 text-white/48">
              {t('landing.product.sub')}
            </p>
          </div>

          <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {capabilities.map((item, index) => (
              <article
                key={item.key}
                className={`group min-h-[230px] rounded-2xl border border-white/9 bg-[#10131b] p-5 transition-colors hover:border-white/18 hover:bg-[#131722] ${index === 0 || index === 7 ? 'sm:col-span-2' : ''}`}
              >
                <div className="flex items-start justify-between">
                  <span className="grid size-10 place-items-center rounded-xl border border-white/8 bg-white/[0.035] text-amber-300">
                    <item.icon className="size-4.5" />
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/28">
                    {sub(item.key, 'meta')}
                  </span>
                </div>
                <h3 className="mt-10 text-lg font-medium tracking-tight">
                  {sub(item.key, 'title')}
                </h3>
                <p className="mt-3 max-w-md text-xs leading-5 text-white/42">
                  {sub(item.key, 'description')}
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
                {t('landing.solutions.eyebrow')}
              </p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-0.045em]">
                {t('landing.solutions.title')}
              </h2>
              <div
                className="mt-8 space-y-2"
                role="tablist"
                aria-label={t('landing.solutions.aria')}
              >
                {industryStories.map((story, index) => (
                  <button
                    key={story.key}
                    type="button"
                    role="tab"
                    aria-selected={activeUseCase === index}
                    onClick={() => setActiveUseCase(index)}
                    className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-sm transition-colors ${activeUseCase === index ? 'bg-white text-black' : 'text-white/48 hover:bg-white/5 hover:text-white'}`}
                  >
                    {t(story.key)}
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
                    {sub(currentStory.key, 'eyebrow')}
                  </p>
                  <h3 className="mt-3 text-2xl font-medium leading-tight tracking-[-0.03em] sm:text-3xl">
                    {sub(currentStory.key, 'title')}
                  </h3>
                  <ul className="mt-7 space-y-3">
                    {['point1', 'point2', 'point3'].map((leaf) => (
                      <li
                        key={leaf}
                        className="flex gap-3 text-sm leading-6 text-white/52"
                      >
                        <CheckCircle2 className="mt-1 size-4 shrink-0 text-emerald-300" />
                        {sub(currentStory.key, leaf)}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="w-full max-w-[255px] rounded-2xl border border-white/9 bg-black/25 p-5">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">
                    {t('landing.solutions.liveOutcome')}
                  </p>
                  <p className="mt-5 text-lg font-medium leading-7">
                    {sub(currentStory.key, 'outcome')}
                  </p>
                  <div className="mt-6 space-y-3">
                    {(
                      [
                        'landing.solutions.step1',
                        'landing.solutions.step2',
                        'landing.solutions.step3',
                        'landing.solutions.step4',
                      ] as TranslationKey[]
                    ).map((key, index) => (
                      <div
                        key={key}
                        className="flex items-center gap-2 text-[10px] text-white/45"
                      >
                        <span
                          className={`size-1.5 rounded-full ${index < 3 ? 'bg-emerald-400' : 'bg-amber-300'}`}
                        />
                        {t(key)}
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
                {t('landing.engines.eyebrow')}
              </p>
              <h2 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-[-0.045em] sm:text-5xl">
                {t('landing.engines.title')}
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-white/48 lg:justify-self-end">
              {t('landing.engines.sub')}
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
                      {sub(engine.key, 'role')}
                    </p>
                  </div>
                </div>
                <p className="mt-6 text-xs leading-5 text-white/42">
                  {sub(engine.key, 'description')}
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
              {t('landing.pricing.eyebrow')}
            </p>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
              {t('landing.pricing.title')}
            </h2>
            <p className="mt-5 text-sm leading-6 text-white/48">
              {t('landing.pricing.sub')}
            </p>
          </div>
          <div className="mt-14 grid gap-4 lg:grid-cols-3">
            {(
              [
                {
                  key: 'landing.plan.free',
                  price: '₹0',
                  slug: 'free',
                  featured: false,
                },
                {
                  key: 'landing.plan.growth',
                  price: '₹7,999',
                  slug: 'growth',
                  featured: true,
                },
                {
                  key: 'landing.plan.scale',
                  price: '₹24,999',
                  slug: 'scale',
                  featured: false,
                },
              ] as const
            ).map((plan) => (
              <article
                key={plan.key}
                className={`relative rounded-2xl border p-6 ${plan.featured ? 'border-amber-300/30 bg-amber-300/[0.045]' : 'border-white/9 bg-white/[0.022]'}`}
              >
                {plan.featured ? (
                  <span className="absolute -top-3 left-6 rounded-full bg-amber-300 px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-[#17120a]">
                    {t('landing.pricing.recommended')}
                  </span>
                ) : null}
                <h3 className="text-lg font-medium">{t(plan.key)}</h3>
                <p className="mt-2 text-xs text-white/38">
                  {sub(plan.key, 'note')}
                </p>
                <p className="mt-7 text-4xl font-semibold tracking-tight">
                  {plan.price}
                  <span className="text-xs font-normal text-white/32">
                    {' '}
                    {t('landing.pricing.perMonth')}
                  </span>
                </p>
                <div className="mt-7 space-y-3">
                  {['f1', 'f2', 'f3', 'f4'].map((leaf) => (
                    <div
                      key={leaf}
                      className="flex items-center gap-2 text-xs text-white/52"
                    >
                      <Check className="size-3.5 text-emerald-300" />{' '}
                      {sub(plan.key, leaf)}
                    </div>
                  ))}
                </div>
                {plan.slug === 'free' ? (
                  <Link
                    href="/signup"
                    className="mt-8 inline-flex h-8 w-full items-center justify-center rounded-lg bg-white px-2.5 text-sm font-medium text-black transition-colors hover:bg-white/90"
                  >
                    {t('landing.pricing.startFree')}
                  </Link>
                ) : (
                  <Button
                    onClick={onEnterWorkspace}
                    className={`mt-8 w-full ${plan.featured ? 'bg-amber-300 text-[#17120a] hover:bg-amber-200' : 'bg-white text-black hover:bg-white/90'}`}
                  >
                    {t('landing.pricing.choose', { plan: t(plan.key) })}
                  </Button>
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
              <ShieldCheck className="size-3.5" /> {t('landing.security.badge')}
            </Badge>
            <h2 className="mt-6 text-4xl font-semibold tracking-[-0.045em]">
              {t('landing.security.title')}
            </h2>
            <p className="mt-5 max-w-xl text-sm leading-6 text-white/48">
              {t('landing.security.sub')}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                [LockKeyhole, 'landing.security.isolation'],
                [UsersRound, 'landing.security.roles'],
                [BadgeCheck, 'landing.security.consent'],
                [Webhook, 'landing.security.audit'],
              ] as Array<[typeof LockKeyhole, string]>
            ).map(([SecurityIcon, key]) => (
              <div
                key={key}
                className="rounded-2xl border border-white/8 bg-white/[0.02] p-5"
              >
                <SecurityIcon className="size-4 text-emerald-300" />
                <h3 className="mt-6 text-sm font-medium">
                  {sub(key, 'title')}
                </h3>
                <p className="mt-2 text-xs leading-5 text-white/38">
                  {sub(key, 'description')}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 sm:py-24">
        <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
          <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_85%_10%,rgba(167,139,250,0.19),transparent_28%),radial-gradient(circle_at_10%_90%,rgba(252,211,77,0.14),transparent_30%),#12151e] px-6 py-12 sm:px-10 lg:flex lg:items-end lg:justify-between lg:px-14 lg:py-16">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">
                {t('landing.cta.eyebrow')}
              </p>
              <h2 className="mt-5 text-4xl font-semibold leading-tight tracking-[-0.045em] sm:text-5xl">
                {t('landing.cta.title')}
              </h2>
              <p className="mt-5 text-sm leading-6 text-white/48">
                {t('landing.cta.sub')}
              </p>
            </div>
            <Button
              onClick={onEnterWorkspace}
              size="lg"
              className="mt-8 h-12 rounded-full bg-white px-6 text-black hover:bg-white/90 lg:mt-0"
            >
              {t('landing.cta.button')} <ArrowRight />
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/8 py-8">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-5 px-4 text-[11px] text-white/32 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 text-white/62">
            <Activity className="size-4 text-amber-300" />
            <span className="font-medium">Vaani</span>
            <span>{t('landing.footer.tagline')}</span>
          </div>
          <div className="flex flex-wrap gap-5">
            <Link href="/signup" className="hover:text-white">
              {t('landing.footer.createAccount')}
            </Link>
            <Link href="/login" className="hover:text-white">
              {t('landing.footer.customerLogin')}
            </Link>
            <Link href="/admin/login" className="hover:text-white">
              {t('landing.footer.adminLogin')}
            </Link>
            <Link href="/docs" className="hover:text-white">
              {t('landing.nav.apiDocs')}
            </Link>
            <span className="flex items-center gap-1.5">
              <Globe2 className="size-3" /> {t('landing.footer.indiaReady')}
            </span>
            <span className="flex items-center gap-1.5">
              <Languages className="size-3" />{' '}
              {t('landing.footer.multilingual')}
            </span>
            <span className="flex items-center gap-1.5">
              <Zap className="size-3" /> {t('landing.footer.mobile')}
            </span>
          </div>
        </div>
      </footer>
    </main>
  );
}
