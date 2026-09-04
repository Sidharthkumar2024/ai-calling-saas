import {
  enginesForLanguage,
  findLanguage,
  type SpeechEngine,
} from './languages.ts';

/**
 * TTS Router (§11).
 *
 * The STT side has always routed by language. Synthesis did not: it chose an
 * engine from which API key happened to exist, plus one special case for
 * `en-IN`. With an India-only catalog that was survivable — every language in
 * the list was one the Indic engine could speak. §11 adds French, Spanish,
 * Chinese and Japanese, and the same code would have sent them to a model
 * trained on Indian languages, which does not fail loudly. It returns audio.
 * The caller hears a French sentence read with Indic phonemes, and nothing in
 * the logs says anything went wrong.
 *
 * So the order comes from the catalog, and an engine that cannot speak the
 * language is never tried — not even as a last resort. Producing the wrong
 * audio is worse than producing none, because only one of those is visible.
 *
 * Pure: no keys, no network. Which engines are *connected* is the caller's
 * business; which engines are *capable* is this module's.
 */

export type TtsRouting =
  | { ok: true; engine: SpeechEngine; fallbacks: SpeechEngine[] }
  | { ok: false; reason: string; code: TtsRoutingFailure };

export type TtsRoutingFailure =
  | 'unknown_language'
  | 'no_capable_engine'
  | 'no_connected_engine';

/**
 * Picks the engine for one synthesis.
 *
 * `preferred` is the voice profile's own engine. It wins whenever it is both
 * connected and capable — a workspace that chose a specific voice chose how it
 * sounds. It loses to capability, because a profile pointing at an engine that
 * cannot say the words is a misconfiguration, not an instruction.
 */
export function routeSynthesis(input: {
  languageCode: string;
  /** Engines with a usable API key right now. */
  connected: SpeechEngine[];
  /** The engine named by the resolved voice profile, if any. */
  preferred?: SpeechEngine | null;
}): TtsRouting {
  const language = findLanguage(input.languageCode);
  if (!language)
    return {
      ok: false,
      code: 'unknown_language',
      reason: `${input.languageCode} is not a language this workspace can speak. Add it in workspace settings first.`,
    };

  const capable = enginesForLanguage(language.code);
  if (!capable.length)
    return {
      ok: false,
      code: 'no_capable_engine',
      reason: `No speech engine in Vaani can synthesise ${language.label}.`,
    };

  const connected = new Set(input.connected);
  const usable = capable.filter((engine) => connected.has(engine));
  if (!usable.length)
    return {
      ok: false,
      code: 'no_connected_engine',
      // Names the engine to connect, because "voice synthesis failed" sends a
      // workspace looking at its phone numbers.
      reason: `${language.label} needs ${capable.join(' or ')}, and no such voice engine is connected. Connect one in Integrations to run calls in ${language.label}.`,
    };

  const preferred =
    input.preferred && usable.includes(input.preferred)
      ? input.preferred
      : null;
  const engine = preferred ?? usable[0];
  return {
    ok: true,
    engine,
    fallbacks: usable.filter((candidate) => candidate !== engine),
  };
}
