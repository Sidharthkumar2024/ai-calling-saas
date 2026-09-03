import {
  DIALER_TOKEN_TTL_SECONDS,
  mintDialerToken,
  verifyDialerToken,
} from '../lib/dialer-token.ts';

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) pass++;
  else fail++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
};

const SECRET = 'gw_secret_for_tests';
const now = Date.now();

console.log('minting and verifying:');
const token = await mintDialerToken({ callId: 'call_abc', secret: SECRET, now });
ok(
  'a fresh token verifies and returns its call id',
  (await verifyDialerToken(token, SECRET, now)).callId === 'call_abc',
);
ok(
  'the token carries no secret material',
  !token.includes(SECRET),
);
ok(
  'a token is bound to one call id',
  (() => {
    const swapped = token.replace('call_abc', 'call_xyz');
    return verifyDialerToken(swapped, SECRET, now).then(
      (v) => v.ok === false && v.reason === 'signature_mismatch',
    );
  })(),
);
ok(
  'the wrong secret is rejected',
  (await verifyDialerToken(token, 'other', now)).reason === 'signature_mismatch',
);
ok(
  'a tampered signature is rejected',
  (await verifyDialerToken(`${token}0`, SECRET, now)).reason ===
    'signature_mismatch',
);

console.log('expiry:');
ok(
  `the default lifetime is short (${DIALER_TOKEN_TTL_SECONDS}s)`,
  DIALER_TOKEN_TTL_SECONDS <= 300,
);
ok(
  'a token is rejected after it expires',
  (await verifyDialerToken(token, SECRET, now + (DIALER_TOKEN_TTL_SECONDS + 5) * 1000))
    .reason === 'expired',
);
ok(
  'a token is still valid just before expiry',
  (await verifyDialerToken(token, SECRET, now + (DIALER_TOKEN_TTL_SECONDS - 5) * 1000))
    .ok === true,
);
ok(
  'extending the expiry by hand invalidates the signature',
  (async () => {
    const parts = token.split('.');
    parts[2] = String(Number(parts[2]) + 9999);
    const v = await verifyDialerToken(parts.join('.'), SECRET, now);
    return v.ok === false;
  })(),
);

console.log('malformed input:');
for (const [label, value] of [
  ['an empty string', ''],
  ['random text', 'hello'],
  ['too few parts', 'v1.call_abc.123'],
  ['an unknown version', 'v2.call_abc.123.abcd'],
  ['a non-numeric expiry', 'v1.call_abc.soon.abcd'],
]) {
  ok(`${label} is rejected without throwing`, (await verifyDialerToken(value, SECRET, now)).ok === false);
}
ok(
  'a call id containing a dot is refused at mint time',
  await (async () => {
    try {
      await mintDialerToken({ callId: 'call.abc', secret: SECRET });
      return false;
    } catch {
      return true;
    }
  })(),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
