import { validateConsent, voiceGate } from '../lib/voice-consent.ts';

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) pass++;
  else fail++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
};

const verified = {
  state: 'verified',
  relationship: 'employee',
  evidenceKey: 'secure/voice/consent-1.wav',
  verifiedBy: 'admin@vaani.local',
};
const custom = (consent, extra = {}) => ({
  kind: 'custom',
  status: 'active',
  consent,
  ...extra,
});

console.log('prebuilt voices:');
ok(
  'a provider library voice needs no consent',
  voiceGate({ kind: 'prebuilt', status: 'active' }).allowed === true,
);
ok(
  'but a disabled profile is still disabled',
  voiceGate({ kind: 'prebuilt', status: 'archived' }).allowed === false,
);

console.log('custom voices:');
ok('a verified consent allows use', voiceGate(custom(verified)).allowed === true);
ok(
  'THE ONE THAT MATTERS: no consent record at all is refused',
  voiceGate(custom(null)).code === 'consent_missing',
);
ok(
  'absence of evidence is not permission — not_required is refused too',
  voiceGate(custom({ state: 'not_required' })).code === 'consent_missing',
);
ok(
  'pending is not close enough',
  voiceGate(custom({ ...verified, state: 'pending' })).code === 'consent_pending',
);
ok('rejected is refused', voiceGate(custom({ ...verified, state: 'rejected' })).code === 'consent_rejected');
ok(
  'WITHDRAWN: a person can take their voice back',
  voiceGate(custom({ ...verified, state: 'withdrawn' })).code === 'consent_withdrawn',
);
ok(
  'verified by nobody is not verified',
  voiceGate(custom({ ...verified, verifiedBy: null })).code === 'consent_unattributed',
);
ok(
  'verified with no evidence is not verified either',
  voiceGate(custom({ ...verified, evidenceKey: null })).code === 'consent_unevidenced',
);

console.log('the kill switch:');
ok(
  'a platform block beats a verified consent',
  voiceGate(custom(verified, { platformBlocked: true })).code === 'platform_blocked',
);
ok(
  'and it beats everything else too, including a prebuilt voice',
  voiceGate({ kind: 'prebuilt', status: 'active', platformBlocked: true }).allowed === false,
);
ok(
  'a provider disabling the voice also stops it',
  voiceGate(custom(verified, { providerDisabled: true })).code === 'provider_disabled',
);
ok(
  'every refusal explains itself to a human',
  ['consent_missing', 'consent_pending', 'platform_blocked'].every((code) => {
    const cases = {
      consent_missing: voiceGate(custom(null)),
      consent_pending: voiceGate(custom({ ...verified, state: 'pending' })),
      platform_blocked: voiceGate(custom(verified, { platformBlocked: true })),
    };
    return cases[code].reason.length > 30;
  }),
);

console.log('consent submissions:');
const good = validateConsent({
  speakerName: 'Priya Nair',
  relationship: 'employee',
  statement:
    'Priya recorded this statement agreeing to her voice being used for UrbanNest sales calls.',
  evidenceKey: 'secure/voice/priya.wav',
});
ok('a complete submission is accepted', good.ok === true);
ok('a missing name is caught', validateConsent({ ...good, speakerName: '' }).ok === false);
ok(
  'an invented relationship is refused',
  validateConsent({ ...good, relationship: 'borrowed' }).ok === false,
);
ok(
  'A CHECKBOX IS NOT CONSENT: a one-word statement is refused',
  validateConsent({ ...good, statement: 'yes' }).ok === false,
);
ok(
  'and nothing to review is refused',
  validateConsent({ ...good, evidenceKey: '' }).errors.some((e) => e.includes('Attach')),
);
ok(
  'every problem is reported at once, not one per attempt',
  validateConsent({}).errors.length === 4,
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
