import { findLanguage, type SpeechEngine } from './languages.ts';

/**
 * STT Router (§11): pick the transcription provider by language, with a
 * fallback so one provider being down does not kill the turn.
 *
 * The ordering now comes from the language catalog rather than a set of codes
 * kept here. The duplicate had already drifted: it routed Odia and Assamese to
 * Sarvam, neither of which was selectable anywhere in the product, while every
 * language actually added to the catalog after it was written fell through to
 * the global branch by accident rather than by decision.
 *
 * Transcription keeps a fallback to an engine the catalog does not list for the
 * language, which synthesis deliberately does not. The asymmetry is the point:
 * a wrong transcript is visible in the transcript and recoverable on the next
 * turn, whereas wrong audio is heard by the caller and gone.
 */
export type SttProvider = SpeechEngine;

export function sttProviderOrder(languageCode?: string | null): SttProvider[] {
  const code = (languageCode || 'unknown').toLowerCase();
  // Auto-detect on Indian telephony: Sarvam handles code-mixed Hindi best, and
  // an unlabelled call on this platform is far more often Hinglish than not.
  if (code === 'unknown' || code === 'auto') return ['sarvam', 'elevenlabs'];
  const language = findLanguage(code);
  if (!language) return ['elevenlabs', 'sarvam'];
  const ordered = [...language.engines];
  for (const engine of ['elevenlabs', 'sarvam'] as SttProvider[])
    if (!ordered.includes(engine)) ordered.push(engine);
  return ordered;
}
