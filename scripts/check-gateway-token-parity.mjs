/**
 * The gateway is a separate package and cannot import the app's TypeScript, so
 * lib/dialer-token.ts is mirrored as services/media-gateway/src/dialer-token.js.
 * A silent drift between them would mean the gateway accepts tokens the app does
 * not mint, or rejects ones it does — so prove they agree on real vectors.
 */
import * as app from '../lib/dialer-token.ts';
import * as gateway from '../services/media-gateway/src/dialer-token.js';

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) pass++;
  else fail++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
};

const SECRET = 'parity_secret';
const now = 1_780_000_000_000;

ok(
  'both modules expose the same default lifetime',
  app.DIALER_TOKEN_TTL_SECONDS === gateway.DIALER_TOKEN_TTL_SECONDS,
);

ok(
  'both expose the same roles and modes',
  app.LEG_ROLES.join() === gateway.LEG_ROLES.join() &&
    app.LEG_MODES.join() === gateway.LEG_MODES.join(),
);

const shapes = [
  { callId: 'call_abc' },
  { callId: 'call_test_9f2', role: 'supervisor', mode: 'listen' },
  { callId: 'call_' + 'x'.repeat(40), role: 'supervisor', mode: 'whisper' },
];
for (const shape of shapes) {
  const callId = shape.callId;
  const fromApp = await app.mintDialerToken({ ...shape, secret: SECRET, now });
  const fromGateway = await gateway.mintDialerToken({
    ...shape,
    secret: SECRET,
    now,
  });
  ok(`identical token bytes for ${callId.slice(0, 18)}`, fromApp === fromGateway);
  const viaGateway = await gateway.verifyDialerToken(fromApp, SECRET, now);
  const viaApp = await app.verifyDialerToken(fromGateway, SECRET, now);
  ok(
    `both agree on call id, role and mode (${callId.slice(0, 12)})`,
    viaGateway.callId === callId &&
      viaApp.callId === callId &&
      viaGateway.role === (shape.role ?? 'agent') &&
      viaApp.mode === (shape.mode ?? 'duplex'),
  );
}

for (const [label, token] of [
  ['garbage', 'nope'],
  ['wrong version', 'v2.call_a.999.aa'],
  ['expired', await app.mintDialerToken({ callId: 'call_a', secret: SECRET, now: now - 600_000 })],
]) {
  const a = await app.verifyDialerToken(token, SECRET, now);
  const g = await gateway.verifyDialerToken(token, SECRET, now);
  ok(`both reject ${label} with the same reason`, a.ok === false && g.ok === false && a.reason === g.reason);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
