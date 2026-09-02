/**
 * STT Router (architecture §8): pick the transcription provider by language,
 * with a fallback so one provider being down or unsupported does not kill the
 * turn. Indian languages and auto-detect go to Sarvam first; everything else
 * starts on the global provider.
 */
export type SttProvider = 'sarvam' | 'elevenlabs';

const INDIAN_LANGUAGES = new Set([
  'hi-in',
  'en-in',
  'hinglish',
  'haryanvi',
  'pa-in',
  'mr-in',
  'gu-in',
  'bn-in',
  'ta-in',
  'te-in',
  'kn-in',
  'ml-in',
  'ur-in',
  'or-in',
  'as-in',
]);

export function sttProviderOrder(languageCode?: string | null): SttProvider[] {
  const code = (languageCode || 'unknown').toLowerCase();
  // Auto-detect on Indian telephony: Sarvam handles code-mixed Hindi best.
  if (code === 'unknown' || code === 'auto' || INDIAN_LANGUAGES.has(code))
    return ['sarvam', 'elevenlabs'];
  return ['elevenlabs', 'sarvam'];
}
