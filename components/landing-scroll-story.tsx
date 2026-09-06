'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CalendarCheck2,
  Languages,
  MessageSquareText,
  PhoneIncoming,
  UserRoundPlus,
} from 'lucide-react';

import { useLocale } from '@/components/locale-provider';
import type { TranslationKey } from '@/lib/i18n';

/**
 * The pinned scroll story.
 *
 * The section is as tall as one viewport per step; the panel inside it sticks
 * to the top and the step changes with scroll position, so a reader moves
 * through the product by scrolling rather than by reading five stacked cards.
 *
 * Two things this deliberately does not do:
 *
 *  - It does not hijack the scroll. The page scrolls at its own speed and the
 *    panel follows; nothing is intercepted, so a trackpad flick, a keyboard
 *    PageDown and a screen reader all behave normally.
 *  - It does not pin when the reader has asked for less motion, or on a short
 *    screen where a pinned panel leaves no room for its own text. In both
 *    cases the same five steps render as a plain list — the content is the
 *    same, only the choreography is dropped.
 *
 * Each step can carry a `video` (a file under `public/`). Where one is absent
 * the panel renders Vaani's own interface instead of a placeholder, because a
 * grey box with a play triangle tells a visitor nothing about the product.
 */

type Step = {
  id: string;
  key: string;
  icon: typeof PhoneIncoming;
  /** Optional: a looping clip under `public/`, e.g. `/story/answer.mp4`. */
  video?: string;
};

const STEPS: Step[] = [
  { id: 'answer', key: 'landing.story.answer', icon: PhoneIncoming },
  {
    id: 'understand',
    key: 'landing.story.understand',
    icon: MessageSquareText,
  },
  { id: 'act', key: 'landing.story.act', icon: CalendarCheck2 },
  { id: 'handover', key: 'landing.story.handover', icon: UserRoundPlus },
  { id: 'language', key: 'landing.story.language', icon: Languages },
];

export function LandingScrollStory() {
  const { t } = useLocale();
  const sectionRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    // A pinned panel needs room for itself and its text. Below that, pinning
    // hides one to show the other.
    const tall = window.matchMedia('(min-height: 620px)');
    const decide = () => setPinned(!reduced.matches && tall.matches);
    decide();
    reduced.addEventListener('change', decide);
    tall.addEventListener('change', decide);
    return () => {
      reduced.removeEventListener('change', decide);
      tall.removeEventListener('change', decide);
    };
  }, []);

  useEffect(() => {
    if (!pinned) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const section = sectionRef.current;
      if (!section) return;
      const rect = section.getBoundingClientRect();
      // How far through the tall section the reader is, 0 to 1. The travel is
      // the section's height minus one viewport, because the last viewport is
      // spent with the panel already stuck at the top.
      const travel = rect.height - window.innerHeight;
      const progress =
        travel > 0 ? Math.min(1, Math.max(0, -rect.top / travel)) : 0;
      const index = Math.min(
        STEPS.length - 1,
        Math.floor(progress * STEPS.length),
      );
      setActive(index);
    };
    const onScroll = () => {
      // One measurement per frame: a scroll event fires far more often than
      // the screen redraws, and reading `getBoundingClientRect` on each one
      // makes the browser lay the page out again every time.
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [pinned]);

  if (!pinned)
    return (
      <section
        id="story"
        className="scroll-mt-24 border-y border-hairline bg-surface py-20"
      >
        <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
          <StoryHeading t={t} />
          <div className="mt-12 space-y-14">
            {STEPS.map((step, index) => (
              <div
                key={step.id}
                className="grid items-center gap-8 lg:grid-cols-2"
              >
                <StoryCopy step={step} index={index} t={t} active />
                <StoryPanel step={step} active />
              </div>
            ))}
          </div>
        </div>
      </section>
    );

  return (
    <section
      id="story"
      ref={sectionRef}
      className="relative scroll-mt-24 border-y border-hairline bg-surface"
      style={{ height: `${STEPS.length * 100}vh` }}
    >
      <div className="sticky top-0 flex h-screen items-center overflow-hidden">
        <div className="mx-auto w-full max-w-[1240px] px-4 sm:px-6">
          <StoryHeading t={t} />

          <div className="mt-8 grid items-center gap-10 lg:grid-cols-2">
            {/* Both columns keep every step mounted and cross-fade between
                them. Swapping the DOM instead would restart each panel's
                animation and make the video reload on every step. */}
            <div className="relative min-h-[168px]">
              {STEPS.map((step, index) => (
                <div
                  key={step.id}
                  className={`transition-all duration-500 ${
                    index === active
                      ? 'relative translate-y-0 opacity-100'
                      : 'pointer-events-none absolute inset-0 translate-y-3 opacity-0'
                  }`}
                  aria-hidden={index !== active}
                >
                  <StoryCopy
                    step={step}
                    index={index}
                    t={t}
                    active={index === active}
                  />
                </div>
              ))}
            </div>

            <div className="relative mx-auto aspect-[4/5] w-full max-w-[380px]">
              {STEPS.map((step, index) => (
                <div
                  key={step.id}
                  className={`absolute inset-0 transition-all duration-500 ${
                    index === active
                      ? 'scale-100 opacity-100'
                      : 'pointer-events-none scale-[0.97] opacity-0'
                  }`}
                  aria-hidden={index !== active}
                >
                  <StoryPanel step={step} active={index === active} />
                </div>
              ))}
            </div>
          </div>

          <div className="mt-10 flex justify-center gap-1.5" aria-hidden="true">
            {STEPS.map((step, index) => (
              <span
                key={step.id}
                className={`h-1 rounded-full transition-all duration-300 ${
                  index === active ? 'w-8 bg-primary' : 'w-3 bg-hairline'
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function StoryHeading({ t }: { t: (key: TranslationKey) => string }) {
  return (
    <div className="text-center">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-warning-text">
        {t('landing.story.eyebrow')}
      </p>
      <h2 className="mx-auto mt-3 max-w-2xl text-3xl font-semibold leading-[1.08] tracking-[-0.04em] sm:text-4xl">
        {t('landing.story.title')}
      </h2>
    </div>
  );
}

function StoryCopy({
  step,
  index,
  t,
  active,
}: {
  step: Step;
  index: number;
  t: (key: TranslationKey) => string;
  active: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span
          className={`grid size-9 place-items-center rounded-xl border ${
            active
              ? 'border-primary/30 bg-primary/10 text-primary'
              : 'border-hairline text-ink-muted'
          }`}
        >
          <step.icon className="size-4" />
        </span>
        <span className="font-mono text-[11px] text-ink-muted">
          {String(index + 1).padStart(2, '0')} /{' '}
          {String(STEPS.length).padStart(2, '0')}
        </span>
      </div>
      <h3 className="mt-4 text-2xl font-semibold leading-tight tracking-[-0.03em] sm:text-3xl">
        {t(`${step.key}.title` as TranslationKey)}
      </h3>
      <p className="mt-3 max-w-md text-sm leading-6 text-ink-body">
        {t(`${step.key}.body` as TranslationKey)}
      </p>
      <p className="mt-4 text-[11px] text-ink-muted">
        {t(`${step.key}.proof` as TranslationKey)}
      </p>
    </div>
  );
}

/**
 * The right-hand panel: a real clip if one has been added, otherwise Vaani's
 * own interface. Never a placeholder — a grey rectangle with a play triangle
 * is a promise the page cannot keep.
 */
function StoryPanel({ step, active }: { step: Step; active: boolean }) {
  if (step.video)
    return (
      <video
        className="size-full rounded-2xl border border-hairline object-cover"
        src={step.video}
        autoPlay={active}
        loop
        muted
        playsInline
        preload="metadata"
      />
    );
  return (
    <div className="flex size-full items-center justify-center rounded-2xl border border-hairline bg-surface-muted p-5">
      <PhoneFrame>
        <StoryScreen id={step.id} active={active} />
      </PhoneFrame>
    </div>
  );
}

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative aspect-[9/17] h-full max-h-[420px] rounded-[26px] border-[6px] border-ink/85 bg-surface shadow-2xl">
      <div className="absolute left-1/2 top-0 h-4 w-20 -translate-x-1/2 rounded-b-xl bg-ink/85" />
      <div className="size-full overflow-hidden rounded-[20px] p-3 pt-6">
        {children}
      </div>
    </div>
  );
}

/**
 * What each step shows on the phone.
 *
 * These are Vaani's own screens, rendered rather than filmed: a real call
 * card, a real transcript line, a real booking confirmation. Rendering them
 * means they stay true when the product changes, and it costs the page no
 * download at all.
 */
function StoryScreen({ id, active }: { id: string; active: boolean }) {
  if (id === 'answer')
    return (
      <div className="flex h-full flex-col justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-ink-muted">
            Incoming
          </p>
          <p className="mt-1.5 font-mono text-[13px]">+91 98765 43210</p>
          <p className="mt-0.5 text-[11px] text-ink-muted">Website enquiry</p>
        </div>
        <div className="flex items-end justify-center gap-1" aria-hidden="true">
          {[10, 22, 16, 30, 20, 26, 12, 24, 14].map((height, index) => (
            <span
              key={index}
              className={`w-1.5 rounded-full bg-primary/70 ${active ? 'landing-wave' : ''}`}
              style={{
                height: `${height}px`,
                animationDelay: `${index * 90}ms`,
              }}
            />
          ))}
        </div>
        <div className="rounded-xl border border-hairline bg-surface-muted p-2.5">
          <p className="text-[11px] font-medium text-success-text">
            Answered in 1.2s
          </p>
          <p className="mt-0.5 text-[11px] text-ink-muted">
            Sara · Sales · Hinglish
          </p>
        </div>
      </div>
    );

  if (id === 'understand')
    return (
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-[0.16em] text-ink-muted">
          Live transcript
        </p>
        {[
          ['caller', '2 BHK chahiye, Sector 82 mein'],
          ['agent', 'Sector 82 mein 3 ready-to-move options hain'],
          ['caller', 'Budget 85 lakh tak'],
        ].map(([who, line], index) => (
          <div
            key={line}
            className={`max-w-[90%] rounded-lg px-2.5 py-1.5 text-[11px] leading-4 ${
              who === 'caller'
                ? 'bg-surface-muted text-ink-body'
                : 'ml-auto bg-primary text-primary-foreground'
            }`}
            style={{
              opacity: active ? 1 : 0,
              transitionDelay: `${index * 160}ms`,
            }}
          >
            {line}
          </div>
        ))}
        <div className="rounded-lg border border-hairline p-2">
          <p className="text-[11px] text-ink-muted">Intent</p>
          <p className="text-[11px] font-medium">Site visit · high</p>
        </div>
      </div>
    );

  if (id === 'act')
    return (
      <div className="flex h-full flex-col justify-center gap-2.5">
        <div className="rounded-xl border border-success-text/30 bg-success-text/[0.06] p-3">
          <p className="text-[11px] font-medium text-success-text">
            Site visit booked
          </p>
          <p className="mt-1 text-[11px] text-ink-body">
            Sat 11:00 · Sector 82
          </p>
        </div>
        <div className="rounded-xl border border-hairline p-3">
          <p className="text-[11px] text-ink-muted">Sent on WhatsApp</p>
          <p className="mt-1 text-[11px]">Location, floor plan, token link</p>
        </div>
        <div className="rounded-xl border border-hairline p-3">
          <p className="text-[11px] text-ink-muted">Added to calendar</p>
          <p className="mt-1 text-[11px]">Rahul · Sales</p>
        </div>
      </div>
    );

  if (id === 'handover')
    return (
      <div className="flex h-full flex-col justify-center gap-2.5">
        <div className="rounded-xl border border-hairline p-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-ink-muted">
            New lead
          </p>
          <p className="mt-1 text-[13px] font-medium">Neha Kapoor</p>
          <p className="text-[11px] text-ink-muted">
            Score 82 · site visit · Sector 82
          </p>
        </div>
        <div className="rounded-xl border border-hairline bg-surface-muted p-3">
          <p className="text-[11px] text-ink-body">
            Summary, recording and next step already attached.
          </p>
        </div>
        <div className="flex gap-1.5">
          {['CRM', 'WhatsApp', 'Sheet'].map((where) => (
            <span
              key={where}
              className="rounded-md border border-hairline px-2 py-1 text-[11px] text-ink-muted"
            >
              {where}
            </span>
          ))}
        </div>
      </div>
    );

  return (
    <div className="flex h-full flex-col justify-center gap-2">
      <p className="text-[11px] uppercase tracking-[0.16em] text-ink-muted">
        Same agent, caller&rsquo;s language
      </p>
      {[
        ['हिन्दी', 'मैं आपकी साइट विज़िट बुक कर देती हूँ।'],
        ['Hinglish', 'Aapke liye Saturday 11 baje slot rakh doon?'],
        ['English', 'I can hold Saturday 11 for you.'],
      ].map(([language, line], index) => (
        <div
          key={language}
          className="rounded-lg border border-hairline p-2.5"
          style={{
            opacity: active ? 1 : 0.4,
            transitionDelay: `${index * 140}ms`,
          }}
        >
          <p className="text-[11px] font-medium text-primary">{language}</p>
          <p className="mt-0.5 text-[11px] leading-4 text-ink-body">{line}</p>
        </div>
      ))}
    </div>
  );
}
