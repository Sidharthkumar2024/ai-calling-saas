'use client';

import { useEffect, useRef } from 'react';

const OPENING_SECONDS = 1.2;

/** A full-bleed visual introduction, not a video-player panel. */
export function LandingVideoIntro() {
  const section = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = video.current;
    const root = section.current;
    if (!element || !root) return;

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let targetTime = 0;
    let scrubbed = false;
    let disposed = false;

    // Finish each seek before requesting another: Safari is decoding a 4K clip.
    const seek = () => {
      if (disposed || element.seeking || element.readyState < 1) return;
      if (Math.abs(element.currentTime - targetTime) > 0.035)
        element.currentTime = targetTime;
    };
    const update = () => {
      frame = 0;
      if (motion.matches || document.hidden) {
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
      const travel = Math.max(1, bounds.height - window.innerHeight);
      const progress = Math.max(0, Math.min(1, -bounds.top / travel));
      const end = Math.max(0, element.duration - 0.08);
      const start = Math.min(OPENING_SECONDS, end);
      targetTime = start + progress * (end - start);
      seek();
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const start = () => {
      if (disposed) return;
      update();
      // A short opening movement, never an endless loop into the blank final frame.
      // The rest follows the visitor's scroll, in either direction.
      if (
        !motion.matches &&
        !document.hidden &&
        !scrubbed &&
        root.getBoundingClientRect().top >= -1
      ) {
        void element.play().catch(() => {});
      }
    };
    const opening = () => {
      if (!scrubbed && element.currentTime >= OPENING_SECONDS) element.pause();
    };
    const visibility = () => {
      if (
        !document.hidden &&
        !scrubbed &&
        element.currentTime < OPENING_SECONDS
      )
        start();
      else schedule();
    };
    const onSeeked = () => {
      if (scrubbed && !motion.matches) seek();
    };
    element.addEventListener('loadedmetadata', start);
    element.addEventListener('timeupdate', opening);
    element.addEventListener('seeked', onSeeked);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    document.addEventListener('visibilitychange', visibility);
    motion.addEventListener('change', schedule);
    if (element.readyState >= 1) start();

    return () => {
      disposed = true;
      element.pause();
      window.cancelAnimationFrame(frame);
      element.removeEventListener('loadedmetadata', start);
      element.removeEventListener('timeupdate', opening);
      element.removeEventListener('seeked', onSeeked);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('visibilitychange', visibility);
      motion.removeEventListener('change', schedule);
    };
  }, []);

  return (
    <section
      ref={section}
      id="video-intro"
      className="vani-video-intro"
      aria-label="VANI introduction"
    >
      <div className="vani-video-stage">
        {/* Decorative, always-muted footage. The product description follows below. */}
        {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={video}
          muted
          playsInline
          disablePictureInPicture
          disableRemotePlayback
          preload="auto"
          poster="/media/landing-demo-poster.jpg"
          className="vani-intro-film"
          aria-hidden="true"
          tabIndex={-1}
        >
          <source src="/media/landing-demo.mp4" type="video/mp4" />
        </video>
      </div>
    </section>
  );
}
