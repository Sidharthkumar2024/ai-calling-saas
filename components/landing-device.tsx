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
      {/* The rail: a titanium band whose light runs along its length, brightest
          where the light source is and dark on the turn away. One flat grey
          border is what made it read as a drawing of a phone. */}
      <div className="relative aspect-[9/19] w-full rounded-[42px] bg-[linear-gradient(155deg,#8f98a6_0%,#3f4756_14%,#1b2130_34%,#141926_58%,#3a4353_82%,#9aa3b2_100%)] p-[2px] shadow-[0_0_0_1px_rgba(255,255,255,0.10),0_1px_0_rgba(255,255,255,0.45)_inset]">
        {/* The bezel between rail and glass. Black, and slightly inset, which
            is the shadow line every real device has under its frame. */}
        <div className="stage-sheen relative size-full overflow-hidden rounded-[40px] bg-[#05070f] p-[7px] shadow-[0_0_14px_rgba(0,0,0,0.75)_inset]">
          <div className="vani-device-screen relative size-full overflow-hidden rounded-[33px]">
            {/* Dynamic-island shaped cutout, floating rather than notched into
                the top edge. */}
            <div className="absolute left-1/2 top-2 z-30 h-[18px] w-[76px] -translate-x-1/2 rounded-full bg-[#05070f]">
              <span className="absolute right-3 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-[#1b2740] ring-1 ring-white/10" />
            </div>
            {/* Two reflections, not one: a broad sheet from the top edge, and a
                narrow diagonal streak — which is what makes glass read as
                curved rather than as a flat pane. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-20 rounded-[33px] bg-[linear-gradient(168deg,rgba(255,255,255,0.30)_0%,rgba(255,255,255,0.08)_14%,transparent_32%)]"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-y-6 left-[-30%] z-20 w-[45%] rotate-[16deg] bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.16),transparent)]"
            />
            {children}
          </div>
        </div>
        {/* Side buttons, on the rail rather than drawn on the glass. */}
        <span
          aria-hidden="true"
          className="absolute -left-[3px] top-[18%] h-8 w-[3px] rounded-l-sm bg-[linear-gradient(180deg,#7c8593,#2b3242)]"
        />
        <span
          aria-hidden="true"
          className="absolute -left-[3px] top-[29%] h-12 w-[3px] rounded-l-sm bg-[linear-gradient(180deg,#7c8593,#2b3242)]"
        />
        <span
          aria-hidden="true"
          className="absolute -right-[3px] top-[24%] h-16 w-[3px] rounded-r-sm bg-[linear-gradient(180deg,#7c8593,#2b3242)]"
        />
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
