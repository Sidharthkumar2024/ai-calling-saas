// Play enough of the supplied film for the first visit to feel intentional,
// then stop before its white tail and reveal the durable product scene. The
// old 1.2 second cut made the video appear to be missing on slower devices.
export const INTRO_OPENING_SECONDS = 5.8;
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
  return {
    time: start + Math.min(1, p / 0.8) * (end - start),
    reveal: Math.max(0, Math.min(1, (p - 0.62) / 0.22)),
  };
}
