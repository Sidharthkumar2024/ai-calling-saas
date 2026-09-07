'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  CalendarCheck2,
  Check,
  CheckCircle2,
  Database,
  FileText,
  GraduationCap,
  HeartPulse,
  Home,
  LockKeyhole,
  Megaphone,
  MessageCircleMore,
  PhoneCall,
  Radio,
  Route,
  ShieldCheck,
  ShoppingBag,
  Target,
  UsersRound,
  Webhook,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { VAANI_ENGINES } from '@/lib/vaani-engine-catalog';
import { LandingHeroStage } from '@/components/landing-hero-stage';
import { LandingVideoIntro } from '@/components/landing-video-intro';
import { LandingHeader } from '@/components/landing-header';
import { PublicFooter } from '@/components/public-footer';
import { LandingProofBand } from '@/components/landing-proof-band';
import { LandingScrollStory } from '@/components/landing-scroll-story';
import { useLocale } from '@/components/locale-provider';
import { type TranslationKey } from '@/lib/i18n';

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
  const { t } = useLocale();
  const [activeUseCase, setActiveUseCase] = useState(0);
  const currentStory = industryStories[activeUseCase];
  const CurrentStoryIcon = currentStory.icon;

  // Safari does not expose scroll-driven CSS timelines consistently yet. The
  // observer keeps the narrative animation working on localhost and on older
  // browsers while still letting CSS view-timeline enhance newer engines.
  useEffect(() => {
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>('.landing-lazy'),
    );
    sections.forEach((section) =>
      section.classList.add('landing-reveal-ready'),
    );
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('landing-reveal-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);
  /** Builds a sub-key of one catalog entry, e.g. `…realEstate.point2`. */
  const sub = (base: string, leaf: string) =>
    t(`${base}.${leaf}` as TranslationKey);

  // `overflow-x-clip`, not `overflow-hidden`, on <main> below. Hidden makes it
  // a scroll container, and a scroll container is where `position: sticky`
  // stops working — the pinned scroll story slid off the top of the screen
  // instead of holding. Clip keeps decorative overflow off the page without
  // creating one.
  return (
    <main className="landing-equal-theme min-h-screen overflow-x-clip bg-surface-muted text-ink">
      <LandingHeader onEnterWorkspace={onEnterWorkspace} />
      <LandingVideoIntro />
      <div id="vani-platform" className="scroll-mt-0" />

      <LandingHeroStage onEnterWorkspace={onEnterWorkspace} />

      <section className="bg-surface-muted">
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
              className="landing-source flex h-20 items-center justify-center gap-2 px-3 text-center text-sm font-medium text-ink-muted"
            >
              <span className="size-1.5 rounded-full bg-primary/70" /> {source}
            </div>
          ))}
        </div>
      </section>

      <LandingScrollStory />

      <LandingProofBand />

      <section
        id="workflow"
        className="landing-lazy scroll-mt-24 border-b border-hairline py-24 sm:py-28"
      >
        <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
          <div className="grid gap-8 lg:grid-cols-[0.75fr_1.25fr] lg:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-warning-text">
                {t('landing.loop.eyebrow')}
              </p>
              <h2 className="stage-heading mt-4 max-w-lg text-[38px] sm:text-[52px]">
                {t('landing.loop.title')}
              </h2>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-ink-muted lg:justify-self-end lg:text-base">
              {t('landing.loop.sub')}
            </p>
          </div>

          <div className="stage-card mt-14 grid overflow-hidden rounded-2xl md:grid-cols-2 xl:grid-cols-4">
            {revenueLoop.map((item, index) => (
              <div
                key={item.step}
                className="relative border-b border-hairline p-6 last:border-b-0 md:[&:nth-child(odd)]:border-r xl:border-b-0 xl:border-r xl:last:border-r-0"
              >
                {index < revenueLoop.length - 1 ? (
                  <ArrowRight className="absolute -right-3 top-8 z-10 hidden size-6 rounded-full border border-hairline bg-surface p-1 text-ink-muted xl:block" />
                ) : null}
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-ink-muted">
                    {item.step}
                  </span>
                  <item.icon className="size-4 text-warning-text" />
                </div>
                <h3 className="mt-8 text-base font-medium">
                  {sub(item.key, 'title')}
                </h3>
                <p className="mt-3 text-xs leading-5 text-ink-muted">
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
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">
              {t('landing.product.eyebrow')}
            </p>
            <h2 className="stage-heading mt-4 text-[38px] sm:text-[52px]">
              {t('landing.product.title')}
            </h2>
            <p className="mt-5 text-sm leading-6 text-ink-muted">
              {t('landing.product.sub')}
            </p>
          </div>

          <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {capabilities.map((item, index) => (
              <article
                key={item.key}
                className={`stage-card group min-h-[230px] rounded-2xl p-5 transition-transform hover:-translate-y-0.5 ${index === 0 || index === 7 ? 'sm:col-span-2' : ''}`}
              >
                <div className="flex items-start justify-between">
                  <span className="grid size-10 place-items-center rounded-xl border border-hairline bg-surface-strong text-warning-text">
                    <item.icon className="size-4.5" />
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">
                    {sub(item.key, 'meta')}
                  </span>
                </div>
                <h3 className="mt-10 text-lg font-medium tracking-tight">
                  {sub(item.key, 'title')}
                </h3>
                <p className="mt-3 max-w-md text-xs leading-5 text-ink-muted">
                  {sub(item.key, 'description')}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="solutions"
        className="landing-lazy scroll-mt-24 border-y border-hairline bg-surface-muted py-24 sm:py-28"
      >
        <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-[310px_1fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-success-text">
                {t('landing.solutions.eyebrow')}
              </p>
              <h2 className="stage-heading mt-4 text-[38px] sm:text-[52px]">
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
                    className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-sm transition-colors ${activeUseCase === index ? 'bg-white text-black' : 'text-ink-muted hover:bg-surface-strong hover:text-ink'}`}
                  >
                    {t(story.key)}
                    <ArrowRight className="size-3.5" />
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-[24px] border border-hairline bg-surface p-6 sm:p-8 lg:p-10">
              <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-xl">
                  <div className="grid size-12 place-items-center rounded-2xl bg-emerald-300/10 text-success-text">
                    <CurrentStoryIcon className="size-5" />
                  </div>
                  <p className="mt-8 text-xs font-semibold uppercase tracking-[0.16em] text-success-text">
                    {sub(currentStory.key, 'eyebrow')}
                  </p>
                  <h3 className="mt-3 text-2xl font-medium leading-tight tracking-[-0.03em] sm:text-3xl">
                    {sub(currentStory.key, 'title')}
                  </h3>
                  <ul className="mt-7 space-y-3">
                    {['point1', 'point2', 'point3'].map((leaf) => (
                      <li
                        key={leaf}
                        className="flex gap-3 text-sm leading-6 text-ink-body"
                      >
                        <CheckCircle2 className="mt-1 size-4 shrink-0 text-success-text" />
                        {sub(currentStory.key, leaf)}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="w-full max-w-[255px] stage-card rounded-2xl p-5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
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
                        className="flex items-center gap-2 text-[11px] text-ink-muted"
                      >
                        <span
                          className={`size-1.5 rounded-full ${index < 3 ? 'bg-emerald-400' : 'bg-primary'}`}
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
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
                {t('landing.engines.eyebrow')}
              </p>
              <h2 className="stage-heading mt-4 text-[38px] sm:text-[52px]">
                {t('landing.engines.title')}
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-ink-muted lg:justify-self-end">
              {t('landing.engines.sub')}
            </p>
          </div>
          <div className="mt-14 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {VAANI_ENGINES.map((engine) => (
              <article key={engine.name} className="stage-card rounded-2xl p-5">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-xl bg-surface-strong text-primary">
                    <engine.icon className="size-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-medium">{engine.name}</h3>
                    <p className="mt-0.5 text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                      {sub(engine.key, 'role')}
                    </p>
                  </div>
                </div>
                <p className="mt-6 text-xs leading-5 text-ink-muted">
                  {sub(engine.key, 'description')}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="pricing"
        className="landing-lazy scroll-mt-24 border-y border-hairline bg-surface-muted py-24 sm:py-28"
      >
        <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-warning-text">
              {t('landing.pricing.eyebrow')}
            </p>
            <h2 className="stage-heading mt-4 text-[38px] sm:text-[52px]">
              {t('landing.pricing.title')}
            </h2>
            <p className="mt-5 text-sm leading-6 text-ink-muted">
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
                className={`relative rounded-2xl border p-6 ${plan.featured ? 'border-primary/30 bg-primary/[0.045]' : 'border-hairline bg-surface-muted'}`}
              >
                {plan.featured ? (
                  <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-primary-foreground">
                    {t('landing.pricing.recommended')}
                  </span>
                ) : null}
                <h3 className="text-lg font-medium">{t(plan.key)}</h3>
                <p className="mt-2 text-xs text-ink-muted">
                  {sub(plan.key, 'note')}
                </p>
                <p className="mt-7 text-4xl font-semibold tracking-tight">
                  {plan.price}
                  <span className="text-xs font-normal text-ink-muted">
                    {' '}
                    {t('landing.pricing.perMonth')}
                  </span>
                </p>
                <div className="mt-7 space-y-3">
                  {['f1', 'f2', 'f3', 'f4'].map((leaf) => (
                    <div
                      key={leaf}
                      className="flex items-center gap-2 text-xs text-ink-body"
                    >
                      <Check className="size-3.5 text-success-text" />{' '}
                      {sub(plan.key, leaf)}
                    </div>
                  ))}
                </div>
                {plan.slug === 'free' ? (
                  <Link
                    href="/signup"
                    className="mt-8 inline-flex h-8 w-full items-center justify-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-[#1d4ed8]"
                  >
                    {t('landing.pricing.startFree')}
                  </Link>
                ) : (
                  <Button
                    onClick={onEnterWorkspace}
                    className={`mt-8 w-full ${plan.featured ? 'bg-primary text-primary-foreground hover:bg-[#1d4ed8]' : 'bg-primary text-primary-foreground hover:bg-[#1d4ed8]'}`}
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
        className="landing-lazy border-y border-hairline bg-surface-muted py-20 sm:py-24"
      >
        <div className="mx-auto grid max-w-[1240px] gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1fr] lg:items-center">
          <div>
            <Badge
              variant="outline"
              className="gap-2 rounded-full border-emerald-400/18 bg-emerald-400/7 text-success-text"
            >
              <ShieldCheck className="size-3.5" /> {t('landing.security.badge')}
            </Badge>
            <h2 className="stage-heading mt-6 text-[38px] sm:text-[52px]">
              {t('landing.security.title')}
            </h2>
            <p className="mt-5 max-w-xl text-sm leading-6 text-ink-muted">
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
              <div key={key} className="stage-card rounded-2xl p-5">
                <SecurityIcon className="size-4 text-success-text" />
                <h3 className="mt-6 text-sm font-medium">
                  {sub(key, 'title')}
                </h3>
                <p className="mt-2 text-xs leading-5 text-ink-muted">
                  {sub(key, 'description')}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 sm:py-24">
        <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
          <div className="vani-footer-cta overflow-hidden rounded-[28px] border border-hairline px-6 py-12 sm:px-10 lg:flex lg:items-end lg:justify-between lg:px-14 lg:py-16">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-warning-text">
                {t('landing.cta.eyebrow')}
              </p>
              <h2 className="stage-heading mt-5 text-[38px] sm:text-[52px]">
                {t('landing.cta.title')}
              </h2>
              <p className="mt-5 text-sm leading-6 text-ink-muted">
                {t('landing.cta.sub')}
              </p>
            </div>
            <Button
              onClick={onEnterWorkspace}
              size="lg"
              className="mt-8 h-12 rounded-full bg-primary px-6 text-primary-foreground hover:bg-[#1d4ed8] lg:mt-0"
            >
              {t('landing.cta.button')} <ArrowRight />
            </Button>
          </div>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
