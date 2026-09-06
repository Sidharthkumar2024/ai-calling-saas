'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, PhoneCall } from 'lucide-react';

import { useLocale } from '@/components/locale-provider';

/**
 * The hero as a pinned stage.
 *
 * The shape follows myequal.ai's hero, measured rather than guessed: a 100vh
 * stage pinned inside a parent 3.5 viewports tall, a line of text sliding
 * behind it, the headline held to one side, a phone in the middle whose screen
 * changes as you scroll, and two glass panels either side of it.
 *
 * What changes on that screen here is Vaani's own call — a real number ringing,
 * the agent answering, the booking it makes, the message it sends, the lead it
 * files. Five states, each one a thing this product actually does.
 *
 * Scroll is read, never taken over. The page moves at its own speed and the
 * stage follows, so a trackpad flick, a PageDown and a screen reader all behave
 * normally; and where the reader asked for less motion, or the screen is too
 * short to hold the phone, the whole choreography is dropped for a plain hero
 * with the same words.
 */

const SCREENS = 5;

export function LandingHeroStage({
  onEnterWorkspace,
}: {
  onEnterWorkspace: () => void;
}) {
  const { t } = useLocale();
  const sectionRef = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState(0);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const tall = window.matchMedia('(min-height: 680px)');
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
      const travel = rect.height - window.innerHeight;
      setProgress(
        travel > 0 ? Math.min(1, Math.max(0, -rect.top / travel)) : 0,
      );
    };
    const onScroll = () => {
      // One read per frame. A scroll event fires far more often than the
      // screen repaints, and `getBoundingClientRect` on each one makes the
      // browser lay out the page again every time.
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

  const screen = Math.min(SCREENS - 1, Math.floor(progress * SCREENS));
  // The stage starts dark and turns light as the call is answered, which is
  // the same beat the phone screen is on. Unpinned there is no dark stage at
  // all, so it is lit from the start — otherwise the secondary button renders
  // its on-dark styling onto a white page and disappears.
  const lit = !pinned || progress > 0.34;

  const copy = (
    <div className="max-w-xl">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-warning-text">
        {t('landing.hero.badge')}
      </p>
      <h1 className="mt-5 text-[40px] font-normal leading-[1.05] tracking-[-0.03em] sm:text-[56px] lg:text-[64px]">
        {t('landing.stage.title')}
      </h1>
      <p className="mt-5 whitespace-pre-line text-lg leading-8 text-ink-body sm:text-xl">
        {t('landing.stage.sub')}
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onEnterWorkspace}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[linear-gradient(96deg,#4f46e5_0%,#2563eb_52%,#0ea5e9_100%)] px-6 text-sm font-medium text-white shadow-[0_16px_40px_-16px_rgba(37,99,235,0.9),inset_0_1px_0_rgba(255,255,255,0.35)] transition-transform hover:-translate-y-px"
        >
          {t('landing.hero.cta')} <ArrowRight className="size-4" />
        </button>
        <a
          href="#story"
          className={`inline-flex h-12 items-center justify-center rounded-full px-6 text-sm font-medium transition-colors ${
            lit
              ? 'border border-hairline bg-surface text-ink hover:bg-surface-strong'
              : 'border border-white/20 bg-white/10 text-white backdrop-blur hover:bg-white/15'
          }`}
        >
          {t('landing.hero.secondary')}
        </a>
      </div>
    </div>
  );

  if (!pinned)
    return (
      <section id="top" className="scroll-mt-24 bg-surface py-16 sm:py-24">
        <div className="mx-auto grid max-w-[1240px] items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
          {copy}
          <div className="mx-auto w-full max-w-[300px]">
            <Phone screen={1} />
          </div>
        </div>
      </section>
    );

  return (
    <section
      id="top"
      ref={sectionRef}
      className="relative scroll-mt-24"
      style={{ height: `${SCREENS * 70}vh` }}
    >
      <div className="stage-grain sticky top-0 h-screen overflow-hidden bg-[#070b1c]">
        {/* The floor: an aurora that drifts, with a light plate over it that
            fades in on the beat the call is answered. Two layers rather than a
            colour swap, so the light does not arrive as a flash. */}
        <div className="stage-aurora absolute inset-0" />
        <div
          className="absolute inset-0 bg-surface transition-opacity duration-1000"
          style={{ opacity: lit ? 1 : 0 }}
        />
        {/* Edges fall away rather than stopping at a hard rectangle. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_86%_at_50%_36%,transparent_46%,rgba(4,7,20,0.55)_100%)] transition-opacity duration-1000"
          style={{ opacity: lit ? 0 : 1 }}
        />

        {/* The line sliding behind everything. `aria-hidden` because it is
            scenery: a screen reader announcing it between the eyebrow and the
            headline would read as a third heading. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-[18%] overflow-hidden"
        >
          <p
            className={`whitespace-nowrap bg-clip-text text-[76px] font-semibold uppercase leading-none tracking-[-0.02em] text-transparent transition-opacity duration-700 sm:text-[136px] ${
              lit
                ? 'bg-[linear-gradient(92deg,rgba(17,24,39,0.10),rgba(17,24,39,0.04))]'
                : 'bg-[linear-gradient(92deg,rgba(165,180,252,0.30),rgba(56,189,248,0.10))]'
            }`}
            style={{
              // Moves faster than the phone below it, which is what puts the
              // two on different planes rather than on one flat card.
              transform: `translateX(${18 - progress * 46}%)`,
            }}
          >
            {t('landing.stage.marquee')} · {t('landing.stage.marquee')}
          </p>
        </div>

        <div className="relative mx-auto flex h-full max-w-[1240px] items-center px-4 sm:px-6">
          <div className="grid w-full items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
            <div
              className={`transition-colors duration-700 ${lit ? '' : 'text-white [&_p]:text-white/70'}`}
            >
              {copy}
            </div>

            <div className="stage-scene relative mx-auto flex w-full max-w-[420px] items-center justify-center">
              <div
                aria-hidden="true"
                className="stage-halo absolute size-[380px] rounded-full"
              />
              {/* The two glass panels either side of the phone, in from the
                  edges as the call gets going. */}
              <Glass
                side="left"
                shown={progress > 0.18}
                lit={lit}
                label={t('landing.stage.widgetHears')}
              />
              <Glass
                side="right"
                shown={progress > 0.5}
                lit={lit}
                label={t('landing.stage.widgetActs')}
              />
              <div
                className="stage-device relative w-[248px] sm:w-[280px]"
                style={{
                  // The device turns towards the reader as the call is
                  // answered: 14° away at the start, square on by the end.
                  transform: `rotateY(${(1 - progress) * 14 - 3}deg) rotateX(${(1 - progress) * 5}deg) translateZ(0)`,
                }}
              >
                <Phone screen={screen} />
              </div>
            </div>
          </div>
        </div>

        <div
          className="absolute inset-x-0 bottom-8 flex justify-center gap-1.5"
          aria-hidden="true"
        >
          {Array.from({ length: SCREENS }).map((_, index) => (
            <span
              key={index}
              className={`h-1 rounded-full transition-all duration-300 ${
                index === screen
                  ? 'w-8 bg-primary'
                  : lit
                    ? 'w-3 bg-hairline'
                    : 'w-3 bg-white/25'
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function Glass({
  side,
  shown,
  lit,
  label,
}: {
  side: 'left' | 'right';
  shown: boolean;
  lit: boolean;
  label: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute z-10 hidden w-[196px] rounded-2xl p-3.5 transition-all duration-700 lg:block ${
        side === 'left' ? '-left-28 top-[18%]' : '-right-28 bottom-[18%]'
      } ${
        lit
          ? 'border border-hairline bg-surface/85 shadow-xl'
          : 'stage-glass text-white'
      } ${shown ? 'translate-x-0 opacity-100 blur-0' : `${side === 'left' ? '-translate-x-8' : 'translate-x-8'} opacity-0 blur-[2px]`}`}
    >
      <p className="text-[11px] font-medium">{label}</p>
      <div className="mt-2 flex items-end gap-1">
        {[8, 16, 11, 20, 13, 18, 9, 15].map((height, index) => (
          <span
            key={index}
            className="landing-wave w-1 rounded-full bg-primary/70"
            style={{
              height: `${height}px`,
              animationDelay: `${index * 110}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** The phone itself. Its screen is whichever beat of the call we are on. */
function Phone({ screen }: { screen: number }) {
  return (
    <div className="stage-sheen relative aspect-[9/19] w-full overflow-hidden rounded-[38px] bg-[linear-gradient(150deg,#4b5563_0%,#111827_28%,#0b1020_62%,#374151_100%)] p-[3px] shadow-[0_2px_0_rgba(255,255,255,0.28)_inset]">
      <div className="relative size-full overflow-hidden rounded-[35px] border border-black/60 bg-surface-muted">
        <div className="absolute left-1/2 top-0 z-20 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-[#0b0f1a]" />
        {/* The screen's own reflection: brightest at the top edge, gone by a
            third of the way down, the way glass under a ceiling light is. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 rounded-[35px] bg-[linear-gradient(168deg,rgba(255,255,255,0.22)_0%,rgba(255,255,255,0.05)_16%,transparent_34%)]"
        />
        {[0, 1, 2, 3, 4].map((index) => (
          <div
            key={index}
            className={`absolute inset-0 p-3.5 pt-8 transition-all duration-500 ${
              index === screen
                ? 'translate-y-0 opacity-100'
                : 'pointer-events-none translate-y-2 opacity-0'
            }`}
            aria-hidden={index !== screen}
          >
            <PhoneScreen index={index} active={index === screen} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The five beats of one call, as they appear on the phone.
 *
 * These are popups over a home screen, which is what a caller's phone actually
 * shows — not a marketing illustration of one. Each carries a figure this
 * deployment can stand behind: the answer time, the language, the booking.
 */
function PhoneScreen({ index, active }: { index: number; active: boolean }) {
  if (index === 0)
    return (
      <div className="flex h-full flex-col">
        <p className="text-center text-[11px] text-ink-muted">9:41</p>
        <p className="mt-8 text-center text-4xl font-light tracking-tight">
          9:41
        </p>
        <p className="mt-1 text-center text-[11px] text-ink-muted">
          Saturday, 6 September
        </p>
        <div className="mt-auto grid grid-cols-4 gap-2.5 pb-2">
          {Array.from({ length: 8 }).map((_, slot) => (
            <span
              key={slot}
              className="aspect-square rounded-xl bg-surface-strong"
            />
          ))}
        </div>
      </div>
    );

  if (index === 1)
    return (
      <div className="flex h-full flex-col justify-center">
        <div className="rounded-2xl border border-hairline bg-surface p-3 shadow-lg">
          <p className="text-[11px] uppercase tracking-[0.16em] text-ink-muted">
            Incoming call
          </p>
          <p className="mt-1.5 font-mono text-[13px]">+91 98765 43210</p>
          <p className="mt-0.5 text-[11px] text-ink-muted">
            Website enquiry · Gurgaon
          </p>
          <div className="mt-3 flex gap-2">
            <span className="flex-1 rounded-lg bg-surface-strong py-1.5 text-center text-[11px] text-ink-muted">
              Decline
            </span>
            <span className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-500 py-1.5 text-center text-[11px] text-white">
              <PhoneCall className="size-3" /> Vaani
            </span>
          </div>
        </div>
      </div>
    );

  if (index === 2)
    return (
      <div className="flex h-full flex-col justify-center gap-2">
        <div className="rounded-2xl border border-hairline bg-surface p-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium text-success-text">
              Answered in 1.2s
            </p>
            <p className="text-[11px] text-ink-muted">Hinglish</p>
          </div>
          <div className="mt-2 flex items-end justify-center gap-1">
            {[10, 20, 14, 26, 18, 24, 12, 22, 15].map((height, slot) => (
              <span
                key={slot}
                className={`w-1.5 rounded-full bg-primary/70 ${active ? 'landing-wave' : ''}`}
                style={{
                  height: `${height}px`,
                  animationDelay: `${slot * 90}ms`,
                }}
              />
            ))}
          </div>
        </div>
        <div className="rounded-xl bg-surface-strong px-2.5 py-1.5 text-[11px] leading-4">
          2 BHK chahiye, Sector 82 mein
        </div>
        <div className="ml-auto max-w-[88%] rounded-xl bg-primary px-2.5 py-1.5 text-[11px] leading-4 text-primary-foreground">
          Sector 82 mein 3 ready-to-move options hain
        </div>
      </div>
    );

  if (index === 3)
    return (
      <div className="flex h-full flex-col justify-center gap-2">
        <div className="rounded-2xl border border-success-text/30 bg-success-text/[0.07] p-3">
          <p className="text-[11px] font-medium text-success-text">
            Site visit booked
          </p>
          <p className="mt-1 text-[12px]">Sat 11:00 · Sector 82</p>
        </div>
        <div className="rounded-2xl border border-hairline bg-surface p-3">
          <p className="text-[11px] text-ink-muted">WhatsApp sent</p>
          <p className="mt-1 text-[11px] leading-4">
            Location, floor plan and the token link.
          </p>
        </div>
      </div>
    );

  return (
    <div className="flex h-full flex-col justify-center gap-2">
      <p className="text-[11px] uppercase tracking-[0.16em] text-ink-muted">
        In your workspace
      </p>
      <div className="rounded-2xl border border-hairline bg-surface p-3">
        <p className="text-[13px] font-medium">Neha Kapoor</p>
        <p className="mt-0.5 text-[11px] text-ink-muted">
          Score 82 · site visit · Sector 82
        </p>
        <p className="mt-2 text-[11px] leading-4 text-ink-body">
          Summary, recording and next step attached.
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
}
