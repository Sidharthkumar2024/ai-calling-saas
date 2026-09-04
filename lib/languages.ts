/**
 * One catalog for conversation languages (§11).
 *
 * Shared by the settings API, the portal UI, the STT router, the TTS router and
 * the agent prompt, so a language can never be selectable in one place and
 * rejected by another. Before this there were three lists — the catalog here,
 * an `INDIAN_LANGUAGES` set inside the STT router, and a `languageName` map
 * inside the prompt builder — none of which agreed. Odia and Assamese routed to
 * Sarvam but could not be selected; Urdu and Hinglish were selectable but had
 * no name in the prompt, so the model was told to open in "natural ur-IN".
 *
 * §11 adds French, Spanish, Chinese and Japanese to what had been an
 * India-only catalog. Adding four rows to a list is the easy half and the
 * useless half: the speech engines have to be able to speak them. That is what
 * `engines` records, and what `lib/tts-router.ts` acts on.
 */

/** Which speech engine can actually produce this language. */
export type SpeechEngine = 'sarvam' | 'elevenlabs';

export type LanguageEntry = {
  code: string;
  label: string;
  /** The language's own name, for the picker and for the agent prompt. */
  nativeName: string;
  region: 'india' | 'global';
  /**
   * The script the agent must write in. Named explicitly because a model asked
   * for "Punjabi" will otherwise reply in Devanagari or transliterated Latin,
   * and a TTS engine reads back exactly what it is given.
   */
  script: string;
  /**
   * Engines that can speak it, most appropriate first.
   *
   * Sarvam's bulbul is an Indian-languages engine; ElevenLabs is the
   * multilingual one. A language absent from an engine's list is never routed
   * there — sending French to an Indic model does not degrade gracefully, it
   * produces confident nonsense.
   */
  engines: SpeechEngine[];
};

export const SUPPORTED_LANGUAGES: readonly LanguageEntry[] = [
  {
    code: 'hinglish',
    label: 'Hinglish',
    nativeName: 'Hinglish',
    region: 'india',
    script: 'Devanagari, with Latin only for common product terms',
    engines: ['sarvam', 'elevenlabs'],
  },
  {
    code: 'hi-IN',
    label: 'Hindi',
    nativeName: 'हिन्दी',
    region: 'india',
    script: 'Devanagari',
    engines: ['sarvam', 'elevenlabs'],
  },
  {
    code: 'en-IN',
    label: 'Indian English',
    nativeName: 'Indian English',
    region: 'india',
    script: 'Latin',
    engines: ['elevenlabs', 'sarvam'],
  },
  {
    code: 'haryanvi',
    label: 'Haryanvi',
    nativeName: 'हरियाणवी',
    region: 'india',
    script: 'Devanagari',
    engines: ['sarvam', 'elevenlabs'],
  },
  {
    code: 'pa-IN',
    label: 'Punjabi',
    nativeName: 'ਪੰਜਾਬੀ',
    region: 'india',
    script: 'Gurmukhi',
    engines: ['sarvam', 'elevenlabs'],
  },
  {
    code: 'mr-IN',
    label: 'Marathi',
    nativeName: 'मराठी',
    region: 'india',
    script: 'Devanagari',
    engines: ['sarvam', 'elevenlabs'],
  },
  {
    code: 'gu-IN',
    label: 'Gujarati',
    nativeName: 'ગુજરાતી',
    region: 'india',
    script: 'Gujarati',
    engines: ['sarvam', 'elevenlabs'],
  },
  {
    code: 'bn-IN',
    label: 'Bengali',
    nativeName: 'বাংলা',
    region: 'india',
    script: 'Bengali',
    engines: ['sarvam', 'elevenlabs'],
  },
  {
    code: 'ta-IN',
    label: 'Tamil',
    nativeName: 'தமிழ்',
    region: 'india',
    script: 'Tamil',
    engines: ['sarvam', 'elevenlabs'],
  },
  {
    code: 'te-IN',
    label: 'Telugu',
    nativeName: 'తెలుగు',
    region: 'india',
    script: 'Telugu',
    engines: ['sarvam', 'elevenlabs'],
  },
  {
    code: 'kn-IN',
    label: 'Kannada',
    nativeName: 'ಕನ್ನಡ',
    region: 'india',
    script: 'Kannada',
    engines: ['sarvam', 'elevenlabs'],
  },
  {
    code: 'ml-IN',
    label: 'Malayalam',
    nativeName: 'മലയാളം',
    region: 'india',
    script: 'Malayalam',
    engines: ['sarvam', 'elevenlabs'],
  },
  {
    code: 'or-IN',
    label: 'Odia',
    nativeName: 'ଓଡ଼ିଆ',
    region: 'india',
    script: 'Odia',
    engines: ['sarvam', 'elevenlabs'],
  },
  {
    code: 'ur-IN',
    label: 'Urdu',
    nativeName: 'اُردُو',
    region: 'india',
    script: 'Perso-Arabic script, right to left',
    engines: ['elevenlabs', 'sarvam'],
  },
  // §11's global languages. These route to the multilingual engine only.
  {
    code: 'fr-FR',
    label: 'French',
    nativeName: 'Français',
    region: 'global',
    script: 'Latin',
    engines: ['elevenlabs'],
  },
  {
    code: 'es-ES',
    label: 'Spanish',
    nativeName: 'Español',
    region: 'global',
    script: 'Latin',
    engines: ['elevenlabs'],
  },
  {
    code: 'zh-CN',
    label: 'Chinese (Mandarin)',
    nativeName: '中文',
    region: 'global',
    script: 'Simplified Chinese characters',
    engines: ['elevenlabs'],
  },
  {
    code: 'ja-JP',
    label: 'Japanese',
    nativeName: '日本語',
    region: 'global',
    script: 'kanji, hiragana and katakana, mixed as normal',
    engines: ['elevenlabs'],
  },
] as const;

export type SupportedLanguageCode =
  (typeof SUPPORTED_LANGUAGES)[number]['code'];

export const SUPPORTED_LANGUAGE_CODES: ReadonlySet<string> = new Set(
  SUPPORTED_LANGUAGES.map((language) => language.code),
);

const BY_CODE = new Map(
  SUPPORTED_LANGUAGES.map((language) => [
    language.code.toLowerCase(),
    language,
  ]),
);

export function findLanguage(code: string): LanguageEntry | null {
  return BY_CODE.get(String(code ?? '').toLowerCase()) ?? null;
}

export function languageLabel(code: string) {
  return findLanguage(code)?.label ?? code;
}

/**
 * How the agent prompt should name a language.
 *
 * Carries the script, because the failure this prevents is silent: a model told
 * to speak "Punjabi" replies in Devanagari or Latin transliteration, the TTS
 * engine reads back what it was given, and the caller hears an accent nobody
 * chose. An unknown code returns the code itself rather than a guess.
 */
export function languageName(code: string): string {
  const language = findLanguage(code);
  if (!language) return code;
  if (language.script === 'Latin') return language.label;
  // A bare script name reads as a repetition next to the language's own name —
  // "Gujarati written in Gujarati" — so it is qualified. Multi-word entries are
  // already phrases and are left alone.
  const script = language.script.includes(' ')
    ? language.script
    : `the ${language.script} script`;
  return `${language.label} written in ${script}`;
}

export function languagesForRegion(region: LanguageEntry['region']) {
  return SUPPORTED_LANGUAGES.filter((language) => language.region === region);
}

/** Engines able to speak this language, most appropriate first. */
export function enginesForLanguage(code: string): SpeechEngine[] {
  return [...(findLanguage(code)?.engines ?? [])];
}
