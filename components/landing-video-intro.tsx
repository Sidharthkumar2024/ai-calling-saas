'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { LandingPhoneScene } from '@/components/landing-phone-scene';
import { useLocale } from '@/components/locale-provider';
import { introFrame, INTRO_OPENING_SECONDS } from '@/lib/landing-intro';

export function LandingVideoIntro() {
  const section = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [reveal, setReveal] = useState(0);
  const { locale } = useLocale();
  const hi = locale === 'hi';

  useEffect(() => {
    const element = video.current;
    const root = section.current;
    if (!element || !root) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let targetTime = 0;
    let scrubbed = false;
    let disposed = false;
    let failed = false;
    const showFallback = () => {
      if (disposed) return;
      failed = true;
      element.pause();
      setFallback(true);
    };
    // Serial seeks prevent Safari's decoder from chasing hundreds of frames.
    const seek = () => {
      if (disposed || failed || element.seeking || element.readyState < 1)
        return;
      if (Math.abs(element.currentTime - targetTime) > 0.035)
        element.currentTime = targetTime;
    };
    const update = () => {
      frame = 0;
      setFallback(failed || motion.matches);
      if (failed || motion.matches || document.hidden) {
        element.pause();
        return;
      }
      const bounds = root.getBoundingClientRect();
      if (bounds.bottom <= 0 || bounds.top >= window.innerHeight) {
        element.pause();
        return;
      }
      if (bounds.top >= -1 && !scrubbed) return;
      if (!Number.isFinite(element.duration) || element.duration <= 0) return;
      scrubbed = true;
      element.pause();
      const progress = Math.max(
        0,
        Math.min(
          1,
          -bounds.top / Math.max(1, bounds.height - window.innerHeight),
        ),
      );
      const next = introFrame(progress, element.duration);
      setReveal(next.reveal);
      targetTime = next.time;
      seek();
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const start = () => {
      if (disposed || failed) return;
      schedule();
      if (
        !motion.matches &&
        !document.hidden &&
        !scrubbed &&
        root.getBoundingClientRect().top >= -1
      )
        void element.play().catch((error: unknown) => {
          // A deliberate pause may abort a pending play promise; it is not a media failure.
          if (error instanceof DOMException && error.name === 'AbortError')
            return;
          showFallback();
        });
    };
    const loaded = () => {
      if (!disposed) {
        setReady(true);
        start();
      }
    };
    const opening = () => {
      if (!scrubbed && element.currentTime >= INTRO_OPENING_SECONDS)
        element.pause();
    };
    const ended = () => {
      if (!disposed) setReveal(1);
    };
    const onSeeked = () => {
      if (scrubbed && !motion.matches) seek();
    };
    const visibility = () => {
      if (!document.hidden && !scrubbed) start();
      else schedule();
    };
    const motionChanged = () => {
      schedule();
      if (!motion.matches && !scrubbed) start();
    };
    const loadingTimeout = window.setTimeout(() => {
      if (element.readyState < 2) showFallback();
    }, 8000);
    element.addEventListener('loadeddata', loaded);
    element.addEventListener('timeupdate', opening);
    element.addEventListener('seeked', onSeeked);
    element.addEventListener('ended', ended);
    element.addEventListener('error', showFallback);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    document.addEventListener('visibilitychange', visibility);
    motion.addEventListener('change', motionChanged);
    schedule();
    if (element.readyState >= 2) loaded();
    return () => {
      disposed = true;
      element.pause();
      window.clearTimeout(loadingTimeout);
      window.cancelAnimationFrame(frame);
      element.removeEventListener('loadeddata', loaded);
      element.removeEventListener('timeupdate', opening);
      element.removeEventListener('seeked', onSeeked);
      element.removeEventListener('ended', ended);
      element.removeEventListener('error', showFallback);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('visibilitychange', visibility);
      motion.removeEventListener('change', motionChanged);
    };
  }, []);

  const showingProduct = fallback || !ready || reveal > 0.5;
  return (
    <section
      ref={section}
      id="video-intro"
      className="vani-video-intro"
      data-fallback={fallback}
      aria-label="Call Vani introduction"
    >
      <div className="vani-video-stage">
        <div className="cv-intro-product">
          <div className="cv-intro-heading">
            <p>{hi ? 'मिलिए Call Vani से।' : 'Meet Call Vani.'}</p>
            <h1>
              {hi ? (
                <>
                  आपके बिज़नेस की आवाज़।
                  <br />
                  हर बातचीत में साथ।
                </>
              ) : (
                <>
                  Your business, answered.
                  <br />
                  Your next step, handled.
                </>
              )}
            </h1>
            <div
              className="cv-intro-actions"
              aria-hidden={!showingProduct}
              inert={!showingProduct}
            >
              <Link href="/signup">
                {hi ? 'शुरू करें' : 'Get started'} <ArrowUpRight size={18} />
              </Link>
              <a href="#solutions">
                {hi ? 'डेमो देखें' : 'See it in action'} <ArrowDown size={17} />
              </a>
            </div>
          </div>
          <LandingPhoneScene />
        </div>
        {/* Decorative film; meaningful content stays mounted beneath it. */}
        {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={video}
          autoPlay
          muted
          playsInline
          disablePictureInPicture
          disableRemotePlayback
          preload="auto"
          poster="/media/landing-demo-poster.jpg"
          className="vani-intro-film"
          // Keep the poster visible from the first paint. Previously this was
          // transparent until `loadeddata`, which looked like a blank/missing
          // video on mobile Safari and slower connections.
          style={{ opacity: fallback ? 0 : 1 - reveal }}
          aria-hidden="true"
          tabIndex={-1}
        >
          <source src="/media/landing-demo.mp4" type="video/mp4" />
        </video>
        <a className="cv-intro-skip" href="#vani-platform">
          {hi ? 'प्लेटफ़ॉर्म देखें' : 'Explore the platform'} <ArrowDown size={15} />
        </a>
      </div>
    </section>
  );
}
