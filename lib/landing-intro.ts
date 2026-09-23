// The supplied reference screenshot is the authored film's exact 2.32 s frame
// (the source runs at 25 fps). At 2 s the camera push-in has not finished and
// the robot is visibly too small. Hold the matched frame until the visitor
// scrolls, then scrub the rest into the durable product scene below the film.
export const INTRO_OPENING_SECONDS = 2.32;
export const INTRO_LAST_FRAME_SECONDS = 6.36;
export function introFrame(progress: number, duration: number) {
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const end = Math.max(
    0,
    Math.min(
      INTRO_LAST_FRAME_SECONDS,
      Number.isFinite(duration) ? duration - 0.15 : 0,
    ),
  );
  const start = Math.min(INTRO_OPENING_SECONDS, end);
  const scrub = Math.min(1, p / 0.8);
  return {
    // Decimal source-frame times can introduce a tiny overshoot at the end;
    // clamp to the authored final frame so Safari never seeks into white tail.
    time: Math.min(end, start + scrub * (end - start)),
    reveal: Math.max(0, Math.min(1, (p - 0.62) / 0.22)),
  };
}
