import assert from 'node:assert/strict';

import {
  canStartSession,
  checkOriginRule,
  DEFAULT_DAILY_CAP,
  DEFAULT_HOURLY_CAP,
  isWidgetMode,
  normaliseBranding,
  originAllowed,
  WIDGET_MODES,
} from '../lib/web-widget.ts';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

console.log('origin matching — this is what stands between a public endpoint and a drained wallet');

check('an exact origin matches', () => {
  assert.equal(originAllowed('https://example.com', ['https://example.com']), true);
});

check('an entry with no scheme means https, not either', () => {
  assert.equal(originAllowed('https://example.com', ['example.com']), true);
  // An http page embedding the widget is a different origin and is not covered.
  assert.equal(originAllowed('http://example.com', ['example.com']), false);
});

check('www is a different origin and does not come along for free', () => {
  assert.equal(originAllowed('https://www.example.com', ['https://example.com']), false);
});

check('a wildcard covers one level of subdomain', () => {
  assert.equal(originAllowed('https://app.example.com', ['*.example.com']), true);
  assert.equal(originAllowed('https://www.example.com', ['*.example.com']), true);
});

check('a wildcard does NOT match a lookalike domain — the classic hole', () => {
  // A suffix check would let every one of these through.
  for (const attacker of [
    'https://example.com.attacker.net',
    'https://notexample.com',
    'https://evilexample.com',
  ])
    assert.equal(originAllowed(attacker, ['*.example.com']), false, attacker);
});

check('a wildcard does not match the bare domain', () => {
  // Surprising either way, so it is the narrower reading; list both if you
  // want both.
  assert.equal(originAllowed('https://example.com', ['*.example.com']), false);
});

check('a wildcard covers one level only, not a nested one', () => {
  assert.equal(originAllowed('https://a.b.example.com', ['*.example.com']), false);
});

check('the port has to match', () => {
  assert.equal(originAllowed('https://example.com:8443', ['https://example.com']), false);
  assert.equal(originAllowed('http://localhost:3000', ['http://localhost:3000']), true);
});

check('no Origin header is a refusal, not a pass', () => {
  // A browser always sends one on a cross-origin POST; anything that does not
  // is not the browser this endpoint is for.
  assert.equal(originAllowed(null, ['https://example.com']), false);
  assert.equal(originAllowed('', ['https://example.com']), false);
});

check('a bare * in the list is inert even if it got stored somehow', () => {
  assert.equal(originAllowed('https://anything.test', ['*']), false);
});

check('an unparseable origin is refused rather than thrown on', () => {
  assert.equal(originAllowed('not a url', ['https://example.com']), false);
});

check('an empty list allows nothing', () => {
  assert.equal(originAllowed('https://example.com', []), false);
});

console.log('\nchecking an entry when it is saved, not at 2am');

check('a bare * is refused with the reason spelled out', () => {
  const rule = checkOriginRule('*');
  assert.match(rule.problem, /any website on the internet/);
});

check('a path is refused, because an origin has none', () => {
  assert.match(checkOriginRule('https://example.com/pricing').problem, /drop the path/);
});

check('a non-web scheme is refused', () => {
  assert.match(checkOriginRule('ftp://example.com').problem, /http and https/);
});

check('nonsense is refused', () => {
  assert.ok(checkOriginRule('   ').problem);
  assert.ok(checkOriginRule('http://').problem);
});

check('ordinary entries pass', () => {
  for (const entry of ['https://example.com', 'example.com', '*.example.com', 'http://localhost:3000'])
    assert.equal(checkOriginRule(entry).problem, null, entry);
});

console.log('\nstarting a session');

const start = (overrides = {}) =>
  canStartSession({
    status: 'active',
    origin: 'https://example.com',
    allowedOrigins: ['https://example.com'],
    mode: 'voice',
    enabledModes: ['voice', 'callback'],
    sessionsToday: 0,
    sessionsThisHour: 0,
    walletBalance: 500,
    ...overrides,
  });

check('a well-formed request from a listed site is allowed', () => {
  const decision = start();
  assert.equal(decision.allowed, true);
  assert.equal(decision.code, 'ok');
});

check('an unlisted origin is refused, and the reason names it', () => {
  const decision = start({ origin: 'https://attacker.test' });
  assert.equal(decision.code, 'origin_not_allowed');
  assert.match(decision.operatorMessage, /attacker\.test/);
});

check('a mode nobody switched on cannot be started', () => {
  assert.equal(start({ mode: 'text' }).code, 'mode_disabled');
});

check('an inactive widget is refused before anything else is checked', () => {
  assert.equal(start({ status: 'paused', origin: 'https://attacker.test' }).code, 'widget_disabled');
});

check('the hourly cap bites before the daily one', () => {
  const decision = start({
    sessionsThisHour: DEFAULT_HOURLY_CAP,
    sessionsToday: DEFAULT_DAILY_CAP,
  });
  assert.equal(decision.code, 'hourly_cap');
});

check('the daily cap holds even when the hour is quiet', () => {
  assert.equal(start({ sessionsToday: DEFAULT_DAILY_CAP }).code, 'daily_cap');
});

check('an empty wallet stops a public call, same as the dialer', () => {
  assert.equal(start({ walletBalance: 9 }).code, 'no_credit');
});

console.log('\nwhat the visitor is told versus what the workspace is told');

check('a visitor never learns the cap, the credit balance, or that they were profiled', () => {
  // They are standing on somebody else's website. The workspace's billing is
  // not their business, and a stated cap is a map for whoever is probing.
  for (const overrides of [
    { walletBalance: 0 },
    { sessionsToday: 9999 },
    { sessionsThisHour: 9999 },
    { origin: 'https://attacker.test' },
  ]) {
    const decision = start(overrides);
    assert.equal(decision.allowed, false);
    for (const leak of ['credit', 'cap', 'wallet', 'origin', String(DEFAULT_DAILY_CAP)])
      assert.doesNotMatch(decision.visitorMessage.toLowerCase(), new RegExp(leak.toLowerCase()));
  }
});

check('and every refusal still offers the visitor the callback', () => {
  for (const overrides of [{ walletBalance: 0 }, { sessionsToday: 9999 }]) {
    assert.match(start(overrides).visitorMessage, /call you back/);
  }
});

check('the workspace gets the real reason, with the numbers', () => {
  assert.match(start({ sessionsToday: 9999 }).operatorMessage, /9999/);
  assert.match(start({ walletBalance: 0 }).operatorMessage, /10 credits/);
});

console.log('\nmodes and branding');

check('the three §8 modes are the modes', () => {
  assert.deepEqual([...WIDGET_MODES], ['voice', 'text', 'callback']);
  assert.equal(isWidgetMode('voice'), true);
  assert.equal(isWidgetMode('telepathy'), false);
});

check('a colour that is not a colour is dropped, not escaped and hoped', () => {
  // It ends up inside a <style> on somebody else's page.
  assert.equal(normaliseBranding({ accent: 'red; } body { display:none' }, 'X').accent, '#2563EB');
  assert.equal(normaliseBranding({ accent: '#16A34A' }, 'X').accent, '#16A34A');
});

check('a logo must be https or it is dropped', () => {
  // An http image on an https page is blocked anyway and reads as broken.
  assert.equal(normaliseBranding({ logoUrl: 'http://x.test/a.png' }, 'X').logoUrl, null);
  assert.equal(
    normaliseBranding({ logoUrl: 'javascript:alert(1)' }, 'X').logoUrl,
    null,
  );
  assert.equal(
    normaliseBranding({ logoUrl: 'https://x.test/a.png' }, 'X').logoUrl,
    'https://x.test/a.png',
  );
});

check('the workspace name is the fallback, and text is bounded', () => {
  assert.equal(normaliseBranding({}, 'UrbanNest').name, 'UrbanNest');
  assert.equal(normaliseBranding({ name: 'x'.repeat(500) }, 'X').name.length, 60);
});

check('an unknown position falls back rather than becoming a class name', () => {
  assert.equal(normaliseBranding({ position: 'middle' }, 'X').position, 'bottom_right');
  assert.equal(normaliseBranding({ position: 'bottom_left' }, 'X').position, 'bottom_left');
});

check('a non-object config does not throw', () => {
  assert.equal(normaliseBranding(null, 'X').name, 'X');
  assert.equal(normaliseBranding('nope', 'X').name, 'X');
});

console.log(`\n${passed} assertions passed.`);
