'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CalendarCheck2,
  Languages,
  MessageSquareText,
  PhoneIncoming,
  UserRoundPlus,
  ArrowUpRight,
  CheckCheck,
  FileText,
  PhoneCall,
  Headphones,
} from 'lucide-react';

import { DeviceHalo, DeviceShell } from '@/components/landing-device';
import { LandingCallPreview } from '@/components/landing-call-preview';
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
  id: 'answer' | 'understand' | 'act' | 'handover' | 'language';
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
    const tall = window.matchMedia(
      '(min-width: 1024px) and (min-height: 760px)',
    );
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
        className="vani-story-section vani-story-static scroll-mt-24 py-16"
      >
        <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
          <StoryHeading t={t} />
          <div className="mt-12 space-y-16">
            {STEPS.map((step, index) => (
              <div
                key={step.id}
                className="grid items-center gap-8 lg:grid-cols-2"
              >
                <StoryCopy step={step} index={index} t={t} active />
                <div className="vani-story-panel-wrap">
                  <StoryPanel step={step} active />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );

  return (
    <>
      {/* The heading scrolls away before the panel pins, rather than riding
          along inside it. Keeping it in the sticky frame cost the panel 160px
          of a 900px screen and clipped the top of both. */}
      <div className="vani-story-heading-wrap">
        <div className="mx-auto w-full max-w-[1240px] px-4 sm:px-6">
          <StoryHeading t={t} />
        </div>
      </div>

      <section
        id="story"
        ref={sectionRef}
        className="vani-story-section relative scroll-mt-0"
        style={{ height: `${STEPS.length * 100}vh` }}
      >
        <div className="vani-story-sticky sticky top-0 flex h-screen flex-col justify-center overflow-hidden">
          <div className="mx-auto w-full max-w-[1240px] px-4 sm:px-6">
            {/* The panel takes the larger share, as in the layout this
                follows: the copy is four lines, the product screen is the
                point. */}
            <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
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

              <div className="vani-story-panel-wrap relative mx-auto">
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

            <div
              className="mt-8 flex justify-center gap-1.5"
              aria-hidden="true"
            >
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
    </>
  );
}

/**
 * The section's own heading: a small eyebrow over a very large, very light
 * headline. The weight is deliberate — at this size a semibold line shouts,
 * and the reference this layout follows carries 72px at weight 400.
 */
function StoryHeading({ t }: { t: (key: TranslationKey) => string }) {
  const { locale } = useLocale();
  return (
    <div>
      <p className="text-lg font-medium text-ink-muted">
        {t('landing.story.eyebrow')}
      </p>
      {/* The catalog carries the line break, because where a two-line
          headline breaks is a decision about that language's word order and
          belongs with the translation rather than in the JSX. */}
      <h2 className="mt-3 max-w-4xl whitespace-pre-line text-[38px] font-normal leading-[1.06] tracking-[-0.03em] sm:text-[56px] lg:text-[72px]">
        <mark className="cv-brand-highlight">Call Vani</mark>
        <br />
        {locale === 'hi' ? 'बातचीत से अगले कदम तक।' : 'Beyond the conversation.'}
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
        <div className="cv-story-icons" aria-hidden="true">
          {STEPS.map((item, i) => (
            <span key={item.id} data-active={active && i === index}>
              <item.icon size={19} />
            </span>
          ))}
        </div>
        <span className="font-mono text-xs text-ink-muted">
          {String(index + 1).padStart(2, '0')} /{' '}
          {String(STEPS.length).padStart(2, '0')}
        </span>
      </div>
      <h3 className="mt-4 text-[26px] font-medium leading-[1.15] tracking-[-0.02em] sm:text-[32px]">
        {t(`${step.key}.title` as TranslationKey)}
      </h3>
      <p className="mt-4 max-w-md text-base leading-7 text-ink-body">
        {t(`${step.key}.body` as TranslationKey)}
      </p>
      <p className="mt-4 text-xs text-ink-muted">
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
  const { locale } = useLocale();
  const hi = locale === 'hi';
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
    /* The same stage the hero uses, at rest: a tinted plate, the device in
       perspective, the light behind it. Below the fold the page should not
       look like it stopped trying. */
    <div
      className={`vani-story-panel stage-scene cv-story-preview cv-story-${step.id}`}
      data-active={active}
    >
      <span className="cv-story-demo-label">
        {hi ? 'प्रोडक्ट प्रीव्यू' : 'Product preview'}
      </span>
      {step.id === 'language' ? (
        <div className="cv-language-grid">
          {[
            ['E', 'English'],
            ['ह', 'Hindi'],
            ['த', 'Tamil'],
            ['म', 'Marathi'],
            ['മ', 'Malayalam'],
            ['ಕ', 'Kannada'],
            ['ગ', 'Gujarati'],
            ['ਪ', 'Punjabi'],
            ['ব', 'Bengali'],
          ].map(([letter, name], index) => (
            <div key={name} style={{ animationDelay: `${index * 80}ms` }}>
              <strong>{letter}</strong>
              <span>{name}</span>
            </div>
          ))}
          <p>
            {hi
              ? 'आवाज़ और भाषा की उपलब्धता चुने हुए प्रोवाइडर पर निर्भर है।'
              : 'Voice and language availability depends on your configured provider.'}
          </p>
        </div>
      ) : step.id === 'handover' ? (
        <div className="cv-category-board">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="cv-category-row" aria-hidden={row > 0}>
              {[
                [PhoneCall, hi ? 'नई लीड' : 'New leads'],
                [Headphones, hi ? 'सपोर्ट' : 'Support'],
                [CalendarCheck2, hi ? 'बुकिंग' : 'Bookings'],
                [FileText, hi ? 'भुगतान' : 'Payments'],
                [UserRoundPlus, hi ? 'हैंडऑफ़' : 'Handoffs'],
              ].map(([Icon, name], index) => {
                const I = Icon as typeof PhoneCall;
                return (
                  <span key={String(name)} data-tone={(index + row) % 4}>
                    <I size={24} />
                    {String(name)}
                  </span>
                );
              })}
            </div>
          ))}
          <div className="cv-category-caption">
            <CheckCheck size={19} />
            {hi ? 'सही संदर्भ। सही टीम।' : 'The right context. The right team.'}
          </div>
        </div>
      ) : (
        <>
          <DeviceHalo className="size-[420px]" />
          <DeviceShell tilt={-4} className="vani-story-device">
            <LandingCallPreview
              step={
                { answer: 1, understand: 2, act: 3, handover: 4, language: 5 }[
                  step.id
                ] ?? 0
              }
              active={active}
            />
          </DeviceShell>
          {step.id === 'answer' && (
            <div className="cv-caller-insight">
              <header>
                <PhoneIncoming size={17} />
                {hi ? 'नई पूछताछ' : 'Incoming enquiry'}
                <span>Call Vani</span>
              </header>
              <div>
                <small>
                  {hi ? 'वेबसाइट लीड · सेल्स' : 'WEBSITE LEAD · SALES'}
                </small>
                <strong>
                  {hi
                    ? '“मुझे डेमो देखना है। क्या आपकी टीम बात कर सकती है?”'
                    : '“I’d like a demo. Can someone walk me through it?”'}
                </strong>
                <p>
                  <ArrowUpRight size={17} />
                  {hi
                    ? 'इरादा समझें। अगला कदम तय करें।'
                    : 'Understand the intent. Prepare the next step.'}
                </p>
              </div>
            </div>
          )}
          {step.id === 'understand' && (
            <div className="cv-transcript-note">
              <MessageSquareText size={20} />
              <div>
                <strong>
                  {hi ? 'बातचीत का पूरा संदर्भ' : 'The conversation, captured'}
                </strong>
                <p>
                  {hi
                    ? 'ट्रांसक्रिप्ट · सारांश · लीड की जानकारी'
                    : 'Transcript · Summary · Lead context'}
                </p>
              </div>
              <CheckCheck size={18} />
            </div>
          )}
          {step.id === 'act' && (
            <div
              className="cv-action-cloud"
              aria-label={hi ? 'उदाहरण कार्रवाइयाँ' : 'Example actions'}
            >
              {[
                [CalendarCheck2, hi ? 'बुकिंग रिक्वेस्ट' : 'Request a booking'],
                [
                  MessageSquareText,
                  hi ? 'WhatsApp फॉलो-अप' : 'WhatsApp follow-up',
                ],
                [FileText, hi ? 'CRM अपडेट' : 'Update the CRM'],
                [UserRoundPlus, hi ? 'टीम को सौंपें' : 'Hand over to team'],
              ].map(([Icon, label], index) => {
                const I = Icon as typeof FileText;
                return (
                  <span key={String(label)} className={`cv-action-${index}`}>
                    <I size={21} />
                    {String(label)}
                    <ArrowUpRight size={16} />
                  </span>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
