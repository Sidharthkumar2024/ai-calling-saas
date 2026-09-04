import {
  MAX_PIN_ATTEMPTS,
  VISIBLE_FIELDS,
  containsForbiddenField,
  generatePin,
  normalisePin,
  pinMessage,
  pinState,
  project,
  sessionState,
} from '../lib/support-access.ts';

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) pass++;
  else fail++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
};

const NOW = new Date('2026-09-04T12:00:00.000Z');
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const ahead = (ms) => new Date(NOW.getTime() + ms).toISOString();
const pin = (extra = {}) => ({ expires_at: ahead(600_000), used_at: null, revoked_at: null, attempts: 0, ...extra });

console.log('PIN shape:');
const generated = generatePin();
ok('a PIN is grouped for dictation', /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(generated));
ok(
  'READ ALOUD: no characters that sound or look alike',
  !/[IO01]/.test(generated.replace('-', '')),
);
ok('grouping and case do not decide validity', normalisePin('acde-4679') === 'ACDE4679');
ok('a thousand PINs are all well-formed', Array.from({ length: 1000 }, () => generatePin()).every((p) => /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(p)));
ok(
  'and they are not all the same',
  new Set(Array.from({ length: 200 }, () => generatePin())).size > 190,
);

console.log('PIN lifecycle:');
ok('a fresh PIN is valid', pinState(pin(), NOW) === 'valid');
ok('an expired one is expired', pinState(pin({ expires_at: ago(1000) }), NOW) === 'expired');
ok(
  'SINGLE USE: a used PIN cannot be used again',
  pinState(pin({ used_at: ago(1000) }), NOW) === 'used',
);
ok('a revoked one is refused', pinState(pin({ revoked_at: ago(1) }), NOW) === 'revoked');
ok('a missing PIN is refused, not accepted', pinState(null, NOW) === 'revoked');
ok(
  'too many attempts locks it',
  pinState(pin({ attempts: MAX_PIN_ATTEMPTS }), NOW) === 'locked',
);
ok(
  'locking is reported before expiry, so brute force is visible as brute force',
  pinState(pin({ attempts: MAX_PIN_ATTEMPTS, expires_at: ago(1000) }), NOW) === 'locked',
);
ok('one attempt short still works', pinState(pin({ attempts: MAX_PIN_ATTEMPTS - 1 }), NOW) === 'valid');
ok('an unparseable expiry is treated as expired', pinState(pin({ expires_at: 'soon' }), NOW) === 'expired');
ok('every state has a message', ['valid', 'expired', 'used', 'locked', 'revoked'].every((s) => pinMessage(s).length > 5));
ok('the expired message tells support what to do', pinMessage('expired').includes('generate a new one'));

console.log('session lifecycle:');
ok('an unexpired session is active', sessionState({ expires_at: ahead(600_000), ended_at: null }, NOW) === 'active');
ok(
  'IT ENDS BY ITSELF: a session past its expiry is not active',
  sessionState({ expires_at: ago(1000), ended_at: null }, NOW) === 'expired',
);
ok('an explicitly ended session stays ended', sessionState({ expires_at: ahead(600_000), ended_at: ago(10) }, NOW) === 'ended');
ok('no session is not an active one', sessionState(null, NOW) === 'ended');

console.log('field exposure:');
const workspace = {
  id: 'org_1',
  name: 'UrbanNest',
  status: 'active',
  razorpay_key_secret: 'sk_live_should_never_leave',
  webhook_secret: 'whsec_1',
  internal_notes: 'do not show',
};
const projected = project('workspace', workspace);
ok('listed fields come through', projected.id === 'org_1' && projected.name === 'UrbanNest');
ok(
  'THE ALLOW-LIST: a secret nobody listed is simply absent',
  !('razorpay_key_secret' in projected) && !('webhook_secret' in projected),
);
ok(
  'and so is an unlisted non-secret — new columns are private until someone decides',
  !('internal_notes' in projected),
);
ok('a missing listed field is omitted, not null', !('slug' in projected));
ok(
  'no visible list contains anything secret-shaped',
  Object.values(VISIBLE_FIELDS).every(
    (fields) => containsForbiddenField(Object.fromEntries(fields.map((f) => [f, 1]))).length === 0,
  ),
);
ok(
  'the belt-and-braces check does catch a mistake',
  containsForbiddenField({ id: 1, api_key: 'x' }).includes('api_key'),
);
ok(
  'projecting is not mutating: the source row is untouched',
  workspace.razorpay_key_secret === 'sk_live_should_never_leave',
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
