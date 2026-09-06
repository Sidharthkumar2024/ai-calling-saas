'use client';

/**
 * The phone, once.
 *
 * The hero built one and the scroll story built another, and they drifted
 * immediately: the hero's had a metal shell, a reflection and a sheen, the
 * story's had a 6px black border. Below the fold that reads as the page giving
 * up. One shell, both places, and any polish added here lands in both.
 *
 * `tilt` is how far the device is turned away from the reader, in degrees. The
 * hero drives it from scroll; the story holds it at a fixed angle.
 */
export function DeviceShell({
  children,
  tilt = 0,
  className = '',
}: {
  children: React.ReactNode;
  tilt?: number;
  className?: string;
}) {
  return (
    <div
      className={`stage-device relative ${className}`}
      style={{
        transform: `rotateY(${tilt}deg) rotateX(${Math.abs(tilt) * 0.34}deg)`,
      }}
    >
      <div className="stage-sheen relative aspect-[9/19] w-full overflow-hidden rounded-[38px] bg-[linear-gradient(150deg,#4b5563_0%,#111827_28%,#0b1020_62%,#374151_100%)] p-[3px] shadow-[0_2px_0_rgba(255,255,255,0.28)_inset]">
        <div className="relative size-full overflow-hidden rounded-[35px] border border-black/60 bg-surface-muted">
          <div className="absolute left-1/2 top-0 z-20 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-[#0b0f1a]" />
          {/* The screen's own reflection: brightest at the top edge, gone by a
              third of the way down, the way glass under a ceiling light is. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 rounded-[35px] bg-[linear-gradient(168deg,rgba(255,255,255,0.22)_0%,rgba(255,255,255,0.05)_16%,transparent_34%)]"
          />
          {children}
        </div>
      </div>
    </div>
  );
}

/** The light a device stands in. Rendered behind it, never over it. */
export function DeviceHalo({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`stage-halo pointer-events-none absolute rounded-full ${className}`}
    />
  );
}
