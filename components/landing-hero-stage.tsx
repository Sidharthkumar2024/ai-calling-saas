'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  CalendarCheck2,
  CheckCheck,
  MessageCircle,
  PhoneIncoming,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DeviceHalo, DeviceShell } from '@/components/landing-device';
import { LandingCallPreview } from '@/components/landing-call-preview';
import { useLocale } from '@/components/locale-provider';

const CHAPTERS = [
  ['Answer', 'कॉल उठाएँ', PhoneIncoming],
  ['Listen', 'सुनें', Activity],
  ['Understand', 'समझें', MessageCircle],
  ['Act', 'काम करें', CalendarCheck2],
  ['Sync', 'सेव करें', CheckCheck],
] as const;

/** The same studio palette as the intro, with a scroll-driven product demo. */
export function LandingHeroStage({
  onEnterWorkspace,
}: {
  onEnterWorkspace: () => void;
}) {
  const { locale, t } = useLocale();
  const sectionRef = useRef<HTMLElement>(null);
  const [pinned, setPinned] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    const screen = matchMedia('(min-width: 1024px) and (min-height: 760px)');
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const decide = () => setPinned(screen.matches && !motion.matches);
    decide();
    screen.addEventListener('change', decide);
    motion.addEventListener('change', decide);
    return () => {
      screen.removeEventListener('change', decide);
      motion.removeEventListener('change', decide);
    };
  }, []);

  useEffect(() => {
    if (!pinned) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const bounds = sectionRef.current?.getBoundingClientRect();
      if (!bounds) return;
      setProgress(
        Math.max(
          0,
          Math.min(1, -bounds.top / Math.max(1, bounds.height - innerHeight)),
        ),
      );
    };
    const scroll = () => {
      setSelected(null);
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', scroll, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', scroll);
      window.removeEventListener('resize', measure);
      cancelAnimationFrame(frame);
    };
  }, [pinned]);

  const chapter =
    selected ??
    Math.min(CHAPTERS.length - 1, Math.floor(progress * CHAPTERS.length));
  return (
    <section
      id="top"
      ref={sectionRef}
      className="vani-product-hero"
      data-pinned={pinned}
    >
      <div className="vani-product-stage">
        <div className="vani-product-layout">
          <div className="vani-product-copy">
            <p className="vani-product-eyebrow">
              <span />
              {t('landing.hero.badge')}
            </p>
            <h1>{t('landing.stage.title')}</h1>
            <p className="vani-product-sub">{t('landing.stage.sub')}</p>
            <div className="vani-product-actions">
              <Button onClick={onEnterWorkspace} className="vani-demo-cta">
                {t('landing.hero.cta')}
                <ArrowRight size={18} />
              </Button>
              <a href="#story">
                {t('landing.hero.secondary')}
                <ArrowRight size={17} />
              </a>
            </div>
            <div className="vani-language-tags">
              <span>हिन्दी</span>
              <span>Hinglish</span>
              <span>English</span>
            </div>
            <fieldset className="vani-chapters">
              <legend className="sr-only">
                {locale === 'hi' ? 'कॉल की झलक चुनें' : 'Preview a call stage'}
              </legend>
              {CHAPTERS.map(([en, hi, Icon], index) => (
                <Button
                  key={en}
                  variant="ghost"
                  aria-pressed={chapter === index}
                  aria-label={locale === 'hi' ? hi : en}
                  onClick={() => setSelected(index)}
                >
                  <Icon size={17} />
                  <span>{locale === 'hi' ? hi : en}</span>
                </Button>
              ))}
            </fieldset>
            <p className="vani-demo-caption">
              {locale === 'hi'
                ? 'एक कॉल की झलक · चरण चुनें या स्क्रॉल करें'
                : 'An illustrative call · choose a stage or scroll to explore'}
            </p>
          </div>
          <div className="vani-product-scene stage-scene">
            <DeviceHalo className="size-[460px]" />
            <div className="vani-product-device">
              <DeviceShell tilt={pinned ? 7 - progress * 10 : 0}>
                <LandingCallPreview step={chapter} />
              </DeviceShell>
            </div>
            <div className="vani-float-card vani-float-top">
              <span className="vani-float-icon">
                <Activity size={19} />
              </span>
              <div>
                <strong>
                  {locale === 'hi'
                    ? 'बातचीत, स्वाभाविक'
                    : 'Conversation, naturally.'}
                </strong>
                <p>
                  {locale === 'hi'
                    ? 'संदर्भ के साथ हर जवाब'
                    : 'Every reply, in context'}
                </p>
              </div>
            </div>
            <div className="vani-float-card vani-float-bottom">
              <span className="vani-float-icon">
                <CheckCheck size={20} />
              </span>
              <div>
                <strong>
                  {locale === 'hi'
                    ? 'कॉल से अगला कदम'
                    : 'From call to next step'}
                </strong>
                <p>CRM · WhatsApp · Calendar</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
