/**
 * One catalog for conversation languages, shared by the settings API and the
 * portal UI so a language can never be selectable in one and rejected by the
 * other.
 */
export const SUPPORTED_LANGUAGES = [
  { code: 'hinglish', label: 'Hinglish' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'en-IN', label: 'Indian English' },
  { code: 'haryanvi', label: 'Haryanvi' },
  { code: 'pa-IN', label: 'Punjabi' },
  { code: 'mr-IN', label: 'Marathi' },
  { code: 'gu-IN', label: 'Gujarati' },
  { code: 'bn-IN', label: 'Bengali' },
  { code: 'ta-IN', label: 'Tamil' },
  { code: 'te-IN', label: 'Telugu' },
  { code: 'kn-IN', label: 'Kannada' },
  { code: 'ml-IN', label: 'Malayalam' },
  { code: 'ur-IN', label: 'Urdu' },
] as const;

export type SupportedLanguageCode =
  (typeof SUPPORTED_LANGUAGES)[number]['code'];

export const SUPPORTED_LANGUAGE_CODES: ReadonlySet<string> = new Set(
  SUPPORTED_LANGUAGES.map((language) => language.code),
);

export function languageLabel(code: string) {
  return (
    SUPPORTED_LANGUAGES.find((language) => language.code === code)?.label ??
    code
  );
}
