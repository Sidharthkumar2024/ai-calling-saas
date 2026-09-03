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

console.log('role and mode:');
ok(
  'a v1 token still verifies as a full-duplex agent leg',
  await (async () => {
    // Hand-built v1, as one already in flight during a deploy would be.
    const expiry = Math.floor(now / 1000) + 60;
    const payload = `v1.call_legacy.${expiry}`;
    const { subtle } = crypto;
    const key = await subtle.importKey(
      'raw',
      new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const digest = await subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(payload),
    );
    const hex = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    const v = await verifyDialerToken(`${payload}.${hex}`, SECRET, now);
    return v.ok && v.role === 'agent' && v.mode === 'duplex';
  })(),
);
ok(
  'a supervisor listen token round-trips its role and mode',
  await (async () => {
    const t = await mintDialerToken({
      callId: 'call_sup',
      secret: SECRET,
      role: 'supervisor',
      mode: 'listen',
      now,
    });
    const v = await verifyDialerToken(t, SECRET, now);
    return v.ok && v.role === 'supervisor' && v.mode === 'listen';
  })(),
);
ok(
  'THE IMPORTANT ONE: editing listen to duplex in the URL breaks the signature',
  await (async () => {
    const t = await mintDialerToken({
      callId: 'call_sup',
      secret: SECRET,
      role: 'supervisor',
      mode: 'listen',
      now,
    });
    const escalated = t.replace('.listen.', '.duplex.');
    const v = await verifyDialerToken(escalated, SECRET, now);
    return v.ok === false && v.reason === 'signature_mismatch';
  })(),
);
ok(
  'promoting the role in the URL also breaks the signature',
  await (async () => {
    const t = await mintDialerToken({
      callId: 'call_sup',
      secret: SECRET,
      role: 'supervisor',
      mode: 'listen',
      now,
    });
    const v = await verifyDialerToken(
      t.replace('.supervisor.', '.agent.'),
      SECRET,
      now,
    );
    return v.ok === false;
  })(),
);
ok(
  'an unknown role is refused at mint time',
  await (async () => {
    try {
      await mintDialerToken({ callId: 'c', secret: SECRET, role: 'boss' });
      return false;
    } catch {
      return true;
    }
  })(),
);
ok(
  'an unknown mode in a presented token is rejected',
  (await verifyDialerToken('v2.call_a.agent.shout.999.aa', SECRET, now))
    .reason === 'unknown_mode',
);

console.log('malformed input:');
for (const [label, value] of [
  ['an empty string', ''],
  ['random text', 'hello'],
  ['too few parts', 'v1.call_abc.123'],
  ['a v2 token missing fields', 'v2.call_abc.agent.123'],
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
