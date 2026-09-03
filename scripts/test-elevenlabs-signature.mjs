import { verifyElevenLabsSignature } from '../lib/elevenlabs-webhook.ts';

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) pass++;
  else fail++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
};

const SECRET = 'wsec_test_shared_secret';
const BODY = JSON.stringify({ type: 'voice_removal_notice', data: { voice_id: 'v1' } });

async function sign(body, secret, timestamp) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${timestamp}.${body}`),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

const now = Date.now();
const t = Math.floor(now / 1000);
const good = await sign(BODY, SECRET, t);

console.log('signature verification:');
ok(
  'a correctly signed payload is accepted',
  (await verifyElevenLabsSignature(`t=${t},v0=${good}`, BODY, SECRET, now)).ok,
);
ok(
  'whitespace around the parts is tolerated',
  (await verifyElevenLabsSignature(` t=${t} , v0=${good} `, BODY, SECRET, now))
    .ok,
);
ok(
  'a missing header is rejected',
  !(await verifyElevenLabsSignature(null, BODY, SECRET, now)).ok,
);
ok(
  'a header without v0 is rejected',
  (await verifyElevenLabsSignature(`t=${t}`, BODY, SECRET, now)).reason ===
    'signature_header_must_be_t_and_v0',
);
ok(
  'a tampered body is rejected',
  !(
    await verifyElevenLabsSignature(
      `t=${t},v0=${good}`,
      BODY.replace('v1', 'v2'),
      SECRET,
      now,
    )
  ).ok,
);
ok(
  'the wrong secret is rejected',
  !(await verifyElevenLabsSignature(`t=${t},v0=${good}`, BODY, 'wrong', now)).ok,
);
ok(
  'a signature over the body alone (no timestamp) is rejected',
  !(
    await verifyElevenLabsSignature(
      `t=${t},v0=${await sign(BODY, SECRET, '')}`,
      BODY,
      SECRET,
      now,
    )
  ).ok,
);

console.log('replay protection:');
const old = t - 60 * 60;
ok(
  'an hour-old timestamp is rejected even with a valid signature',
  (
    await verifyElevenLabsSignature(
      `t=${old},v0=${await sign(BODY, SECRET, old)}`,
      BODY,
      SECRET,
      now,
    )
  ).reason === 'timestamp_outside_tolerance',
);
const recent = t - 60;
ok(
  'a one-minute-old timestamp is still accepted',
  (
    await verifyElevenLabsSignature(
      `t=${recent},v0=${await sign(BODY, SECRET, recent)}`,
      BODY,
      SECRET,
      now,
    )
  ).ok,
);
ok(
  'a non-numeric timestamp is rejected',
  !(await verifyElevenLabsSignature(`t=abc,v0=${good}`, BODY, SECRET, now)).ok,
);
ok(
  'a future timestamp beyond tolerance is rejected',
  (
    await verifyElevenLabsSignature(
      `t=${t + 7200},v0=${await sign(BODY, SECRET, t + 7200)}`,
      BODY,
      SECRET,
      now,
    )
  ).reason === 'timestamp_outside_tolerance',
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
