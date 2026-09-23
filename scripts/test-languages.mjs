import assert from 'node:assert/strict';

import {
  SUPPORTED_LANGUAGES,
  sarvamSttLanguageCode,
  SUPPORTED_LANGUAGE_CODES,
  enginesForLanguage,
  findLanguage,
  languageLabel,
  languageName,
  languagesForRegion,
} from '../lib/languages.ts';
import { sttProviderOrder } from '../lib/stt-router.ts';
import { routeSynthesis } from '../lib/tts-router.ts';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

console.log('catalog');

check('§11 global languages are present', () => {
  for (const code of ['fr-FR', 'es-ES', 'zh-CN', 'ja-JP'])
    assert.ok(SUPPORTED_LANGUAGE_CODES.has(code), `${code} missing`);
  assert.equal(languagesForRegion('global').length, 4);
});

check('Sarvam STT receives only provider-supported language codes', () => {
  assert.equal(sarvamSttLanguageCode('hi-IN'), 'hi-IN');
  assert.equal(sarvamSttLanguageCode('en-IN'), 'en-IN');
  assert.equal(sarvamSttLanguageCode('hinglish'), 'unknown');
  assert.equal(sarvamSttLanguageCode('haryanvi'), 'unknown');
  assert.equal(sarvamSttLanguageCode('fr-FR'), 'unknown');
  assert.equal(sarvamSttLanguageCode(''), 'unknown');
});

check('the Indian catalog is not diminished by adding global ones', () => {
  const india = languagesForRegion('india').map((l) => l.code);
  for (const code of [
    'hinglish',
    'hi-IN',
    'en-IN',
    'haryanvi',
    'pa-IN',
    'mr-IN',
    'gu-IN',
    'bn-IN',
    'ta-IN',
    'te-IN',
    'kn-IN',
    'ml-IN',
    'ur-IN',
  ])
    assert.ok(india.includes(code), `${code} missing`);
});

check('every entry is complete, so no field can be silently absent', () => {
  for (const language of SUPPORTED_LANGUAGES) {
    assert.ok(language.code, 'code');
    assert.ok(language.label, `label for ${language.code}`);
    assert.ok(language.nativeName, `nativeName for ${language.code}`);
    assert.ok(language.script, `script for ${language.code}`);
    assert.ok(
      language.engines.length > 0,
      `${language.code} must name an engine that can speak it`,
    );
  }
});

check('codes are unique', () => {
  const codes = SUPPORTED_LANGUAGES.map((l) => l.code);
  assert.equal(new Set(codes).size, codes.length);
});

check('lookup is case-insensitive, because stored codes vary', () => {
  assert.equal(findLanguage('HI-IN')?.code, 'hi-IN');
  assert.equal(findLanguage('fr-fr')?.code, 'fr-FR');
});

check('an unknown code is returned as itself, not guessed at', () => {
  assert.equal(findLanguage('xx-YY'), null);
  assert.equal(languageLabel('xx-YY'), 'xx-YY');
  // The map this replaced fell back to "Hindi written in Devanagari" for any
  // code it did not know — so a Spanish agent was told to open in Hindi.
  assert.equal(languageName('es-MX'), 'es-MX');
});

console.log('languageName');

check('a non-Latin language carries its script', () => {
  assert.match(languageName('pa-IN'), /Gurmukhi/);
  assert.match(languageName('zh-CN'), /Simplified Chinese/);
  assert.match(languageName('ja-JP'), /kanji/);
});

check('a Latin-script language is named plainly', () => {
  assert.equal(languageName('fr-FR'), 'French');
  assert.equal(languageName('es-ES'), 'Spanish');
  assert.equal(languageName('en-IN'), 'Indian English');
});

check('a script sharing the language name is not repeated back', () => {
  assert.equal(
    languageName('gu-IN'),
    'Gujarati written in the Gujarati script',
  );
  assert.ok(!languageName('ta-IN').includes('in Tamil written'));
});

console.log('sttProviderOrder');

check('Indian languages start on the Indic engine', () => {
  assert.deepEqual(sttProviderOrder('hi-IN'), ['sarvam', 'elevenlabs']);
  assert.deepEqual(sttProviderOrder('hinglish'), ['sarvam', 'elevenlabs']);
});

check('global languages start on the multilingual engine', () => {
  for (const code of ['fr-FR', 'es-ES', 'zh-CN', 'ja-JP'])
    assert.equal(sttProviderOrder(code)[0], 'elevenlabs', code);
});

check('an unlabelled call assumes Indian telephony', () => {
  assert.deepEqual(sttProviderOrder('unknown'), ['sarvam', 'elevenlabs']);
  assert.deepEqual(sttProviderOrder('auto'), ['sarvam', 'elevenlabs']);
  assert.deepEqual(sttProviderOrder(null), ['sarvam', 'elevenlabs']);
});

check('transcription always keeps a fallback', () => {
  // Unlike synthesis: a wrong transcript is visible and recoverable next turn,
  // wrong audio is heard by the caller and gone.
  for (const language of SUPPORTED_LANGUAGES)
    assert.equal(
      sttProviderOrder(language.code).length,
      2,
      `${language.code} lost its fallback`,
    );
});

console.log('routeSynthesis');

const both = ['sarvam', 'elevenlabs'];

check('an Indian language prefers the Indic engine', () => {
  const routing = routeSynthesis({ languageCode: 'hi-IN', connected: both });
  assert.equal(routing.ok, true);
  assert.equal(routing.engine, 'sarvam');
  assert.deepEqual(routing.fallbacks, ['elevenlabs']);
});

check('a global language never routes to the Indic engine', () => {
  // The bug this module exists for: an Indic model handed French returns audio
  // rather than an error, so the caller hears the wrong thing and no log says
  // anything happened.
  for (const code of ['fr-FR', 'es-ES', 'zh-CN', 'ja-JP']) {
    const routing = routeSynthesis({ languageCode: code, connected: both });
    assert.equal(routing.ok, true, code);
    assert.equal(routing.engine, 'elevenlabs', code);
    assert.deepEqual(
      routing.fallbacks,
      [],
      `${code} must have no Indic fallback`,
    );
  }
});

check(
  'a global language with only the Indic engine connected is refused',
  () => {
    const routing = routeSynthesis({
      languageCode: 'ja-JP',
      connected: ['sarvam'],
    });
    assert.equal(routing.ok, false);
    assert.equal(routing.code, 'no_connected_engine');
    // The error has to name what to connect; "voice synthesis failed" sends a
    // workspace looking at its phone numbers.
    assert.match(routing.reason, /elevenlabs/);
    assert.match(routing.reason, /Japanese/);
  },
);

check('a voice profile wins when it is both connected and capable', () => {
  const routing = routeSynthesis({
    languageCode: 'hi-IN',
    connected: both,
    preferred: 'elevenlabs',
  });
  assert.equal(routing.engine, 'elevenlabs');
});

check('a voice profile loses to capability', () => {
  // A profile pointing at an engine that cannot say the words is a
  // misconfiguration, not an instruction.
  const routing = routeSynthesis({
    languageCode: 'fr-FR',
    connected: both,
    preferred: 'sarvam',
  });
  assert.equal(routing.ok, true);
  assert.equal(routing.engine, 'elevenlabs');
});

check(
  'a profile naming a disconnected engine falls back rather than failing',
  () => {
    const routing = routeSynthesis({
      languageCode: 'hi-IN',
      connected: ['elevenlabs'],
      preferred: 'sarvam',
    });
    assert.equal(routing.ok, true);
    assert.equal(routing.engine, 'elevenlabs');
  },
);

check('nothing connected is refused, not attempted', () => {
  const routing = routeSynthesis({ languageCode: 'hi-IN', connected: [] });
  assert.equal(routing.ok, false);
  assert.equal(routing.code, 'no_connected_engine');
});

check('an unknown language is refused before any engine is chosen', () => {
  const routing = routeSynthesis({ languageCode: 'kl-GL', connected: both });
  assert.equal(routing.ok, false);
  assert.equal(routing.code, 'unknown_language');
});

check(
  'every catalog language can be synthesised by some connected engine',
  () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const routing = routeSynthesis({
        languageCode: language.code,
        connected: both,
      });
      assert.equal(
        routing.ok,
        true,
        `${language.code} is selectable but unspeakable`,
      );
      assert.ok(enginesForLanguage(language.code).includes(routing.engine));
    }
  },
);

console.log(`\n${passed} assertions passed.`);
