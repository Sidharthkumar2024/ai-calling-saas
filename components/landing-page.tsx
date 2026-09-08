'use client';

import { useEffect } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Check,
  LockKeyhole,
  ShieldCheck,
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
import {
  LandingConnectedPlatform,
  LandingControlBento,
  LandingWorkforceDemo,
} from '@/components/landing-platform-story';
import { LandingPhoneScene } from '@/components/landing-phone-scene';
import { ProviderLogo } from '@/components/provider-logo';
import { displayBrand } from '@/lib/display-brand';
import { PLANS } from '@/lib/commercial-catalog';
import { useLocale } from '@/components/locale-provider';
import { type TranslationKey } from '@/lib/i18n';

type LandingPageProps = {
  onEnterWorkspace: () => void;
};

export function LandingPage({ onEnterWorkspace }: LandingPageProps) {
  const { t, locale } = useLocale();

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
        <div className="cv-source-grid">
          {[
            ['meta_ads', 'Meta Lead Ads'],
            ['google_ads', 'Google Ads'],
            ['forms', t('landing.sources.forms')],
            ['hubspot', 'CRM'],
            ['whatsapp', 'WhatsApp'],
            ['api', t('landing.sources.apis')],
            ['google_sheets', 'Google Sheets'],
          ].map(([id, source]) => (
            <div
              key={source}
              className="landing-source flex h-20 items-center justify-center gap-2 px-3 text-center text-sm font-medium text-ink-muted"
            >
              <ProviderLogo provider={id} size={23} /> <span>{source}</span>
            </div>
          ))}
        </div>
      </section>

      <LandingScrollStory />

      <LandingProofBand />

      <LandingConnectedPlatform />
      <LandingWorkforceDemo />
      <LandingControlBento />

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
                    <h3 className="text-sm font-medium">
                      {displayBrand(engine.name)}
                    </h3>
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
              {locale === 'hi'
                ? 'पहले मुफ़्त ट्रायल करें। सब्सक्रिप्शन और इस्तेमाल अलग—कोई अनलिमिटेड कॉल का वादा नहीं।'
                : 'Start with a free trial. Subscription and usage are separate—no unlimited-call promises.'}
            </p>
          </div>
          <div className="mt-14 grid gap-4 lg:grid-cols-3">
            {PLANS.map((plan, index) => (
              <article
                key={plan.id}
                className={`relative rounded-2xl border p-6 ${index === 1 ? 'border-primary/30 bg-primary/[0.045]' : 'border-hairline bg-surface-muted'}`}
              >
                <h3 className="text-xl font-medium">{plan.name}</h3>
                <p className="mt-7 text-4xl font-semibold tracking-tight">
                  ₹{plan.monthly.toLocaleString('en-IN')}
                  <span className="text-sm font-normal text-ink-muted">
                    {' '}
                    / month
                  </span>
                </p>
                <div className="mt-7 space-y-3">
                  {plan.features.map((feature) => (
                    <div
                      key={feature}
                      className="flex items-center gap-2 text-sm text-ink-body"
                    >
                      <Check className="size-4 text-success-text" />
                      {feature}
                    </div>
                  ))}
                </div>
                <Button onClick={onEnterWorkspace} className="mt-8 w-full">
                  Choose {plan.name}
                </Button>
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
          <div className="vani-footer-cta cv-dark-cta">
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
              <Button
                onClick={onEnterWorkspace}
                size="lg"
                className="mt-8 h-12 rounded-full bg-primary px-6 text-primary-foreground hover:bg-[#1d4ed8] lg:mt-0"
              >
                {t('landing.cta.button')} <ArrowRight />
              </Button>
            </div>
            <LandingPhoneScene compact />
          </div>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
