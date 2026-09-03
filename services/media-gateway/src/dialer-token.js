/**
 * Short-lived call tokens for the browser dialer.
 *
 * The gateway's shared secret must never reach a browser: anyone could read it
 * and drive the gateway for any tenant. Instead Vaani mints a token bound to
 * one call id with a short expiry, and the gateway verifies it with the secret
 * it already holds — no database lookup, no long-lived credential in the tab.
 *
 * Format: `v1.<callId>.<expiryUnix>.<hex hmac>` over `v1.<callId>.<expiry>`.
 *
 * NOTE: kept byte-identical in behaviour to lib/dialer-token.ts in the app.
 * scripts/check-gateway-token-parity.mjs fails if the two drift apart.
 */

export const DIALER_TOKEN_TTL_SECONDS = 120;

async function sign(payload, secret) {
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
    encoder.encode(payload),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export async function mintDialerToken(input) {
  if (!input.callId || input.callId.includes('.'))
    throw new Error('A call id without dots is required.');
  const now = input.now ?? Date.now();
  const expiry =
    Math.floor(now / 1000) + (input.ttlSeconds ?? DIALER_TOKEN_TTL_SECONDS);
  const payload = `v1.${input.callId}.${expiry}`;
  return `${payload}.${await sign(payload, input.secret)}`;
}

export async function verifyDialerToken(token, secret, now = Date.now()) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 4) return { ok: false, reason: 'malformed_token' };
  const [version, callId, expiryRaw, provided] = parts;
  if (version !== 'v1') return { ok: false, reason: 'unsupported_version' };
  if (!callId) return { ok: false, reason: 'missing_call_id' };
  const expiry = Number(expiryRaw);
  if (!Number.isFinite(expiry)) return { ok: false, reason: 'bad_expiry' };
  if (Math.floor(now / 1000) > expiry) return { ok: false, reason: 'expired' };

  const expected = await sign(`v1.${callId}.${expiryRaw}`, secret);
  if (expected.length !== provided.length)
    return { ok: false, reason: 'signature_mismatch' };
  // Constant time: an early return on the first differing character leaks.
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  }
  return mismatch === 0
    ? { ok: true, callId, expiresAt: expiry * 1000 }
    : { ok: false, reason: 'signature_mismatch' };
}
