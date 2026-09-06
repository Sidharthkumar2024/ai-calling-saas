'use client';

import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX, ArrowDown } from 'lucide-react';

export function LandingVideoIntro() {
  const section = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [sound, setSound] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const element = video.current;
    const root = section.current;
    if (!element || !root) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) void element.play().catch(() => {});
    let frame = 0;
    const update = () => {
      frame = 0;
      const bounds = root.getBoundingClientRect();
      if (bounds.bottom <= 0 || bounds.top >= innerHeight) {
        element.pause();
        return;
      }
      if (sound || reduced || bounds.top >= 0) return;
      const duration = element.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;
      element.pause();
      const progress = Math.max(0, Math.min(1, -bounds.top / Math.max(1, bounds.height - innerHeight)));
      element.currentTime = progress * Math.max(0, duration - 0.05);
    };
    const scroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener('scroll', scroll, { passive: true });
    window.addEventListener('resize', scroll);
    return () => {
      window.removeEventListener('scroll', scroll);
      window.removeEventListener('resize', scroll);
      cancelAnimationFrame(frame);
    };
  }, [sound]);

  async function toggleSound() {
    const element = video.current;
    if (!element) return;
    element.muted = sound;
    setSound(!sound);
    try { await element.play(); setNotice(''); }
    catch { setNotice('Use the video play control to begin playback.'); }
  }

  return (
    <section ref={section} className="vani-video-intro relative h-[240svh] bg-[#101911] motion-reduce:h-auto" aria-label="VANI video introduction">
      <div className="sticky top-0 flex h-[100svh] flex-col bg-[#101911] motion-reduce:relative">
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-4 text-white sm:px-10">
          <a href="#vani-platform" className="text-xl font-semibold tracking-[0.15em]">V-A-N-I</a>
          <div className="flex items-center gap-4">
            <button type="button" onClick={toggleSound} aria-pressed={sound} className="flex items-center gap-2 rounded-full border border-white/30 px-4 py-2 text-sm">
              {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}{sound ? 'Mute' : 'Sound on'}
            </button>
            <a href="#vani-platform" className="text-sm underline underline-offset-4">Skip intro</a>
          </div>
        </div>
        {/* The supplied clip has no accompanying caption file. Native controls remain available. */}
        {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={video} muted playsInline controls preload="auto" className="min-h-0 w-full flex-1 object-contain" aria-label="Video introduction; scroll to explore, or enable sound for playback">
          <source src="/media/landing-demo.mp4" type="video/mp4" />
        </video>
        <output className="flex shrink-0 items-center justify-center gap-2 px-4 py-3 text-center text-sm text-white/80">
          <ArrowDown size={16} />{notice || (sound ? 'Playing with sound · scroll down to discover VANI' : 'Scroll to explore · enable sound to watch with audio')}
        </output>
      </div>
    </section>
  );
}
