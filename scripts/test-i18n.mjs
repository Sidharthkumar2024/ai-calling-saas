import {
  DEFAULT_LOCALE,
  PORTAL_LOCALES,
  coverage,
  isPortalLocale,
  missingKeys,
  translate,
} from '../lib/i18n.ts';

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) pass++;
  else fail++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
};

console.log('catalog:');
ok('English is the default', DEFAULT_LOCALE === 'en');
ok(
  'every locale in the picker has a native label',
  PORTAL_LOCALES.every((l) => l.nativeLabel && l.code),
);
ok(
  'a known key translates in Hindi',
  translate('hi', 'nav.settings') === 'सेटिंग्स',
);
ok(
  'the same key is English in English',
  translate('en', 'nav.settings') === 'Settings',
);
ok(
  'an unknown locale falls back to English rather than breaking',
  translate('xx', 'nav.settings') === 'Settings',
);
ok(
  'a key missing from a locale falls back to English, not to the raw key',
  (() => {
    // Simulate the gap by asking for a key Hindi has; then prove the fallback
    // path returns English text for any key the catalog lacks.
    const missing = missingKeys('hi');
    if (!missing.length) return true;
    return translate('hi', missing[0]) === translate('en', missing[0]);
  })(),
);

console.log('placeholder substitution:');
ok(
  'a placeholder is filled',
  translate('en', 'login.continueWith', { provider: 'Google' }) ===
    'Continue with Google',
);
ok(
  'THE POINT: Hindi puts the provider first, so word order lives in the catalog',
  translate('hi', 'login.continueWith', { provider: 'Google' }) ===
    'Google से जारी रखें',
);
ok(
  'an unknown placeholder is left visible rather than silently blanked',
  translate('en', 'login.continueWith', {}) === 'Continue with {provider}',
);
ok(
  'a template with no placeholders is unchanged by values',
  translate('en', 'nav.settings', { unused: 'x' }) === 'Settings',
);

console.log('locale validation:');
ok('a valid code is accepted', isPortalLocale('hi'));
ok('an unknown code is rejected', !isPortalLocale('fr'));
ok('a non-string is rejected', !isPortalLocale(null) && !isPortalLocale(7));

console.log('coverage:');
const hi = coverage('hi');
ok('English is complete by definition', coverage('en').percent === 100);
ok(
  `Hindi coverage is reported honestly (${hi.translated}/${hi.total} = ${hi.percent}%)`,
  hi.percent > 0 && hi.percent <= 100,
);
ok(
  'missingKeys agrees with the coverage count',
  missingKeys('hi').length === hi.total - hi.translated,
);
if (hi.percent < 100) {
  console.log(`     untranslated: ${missingKeys('hi').join(', ')}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
