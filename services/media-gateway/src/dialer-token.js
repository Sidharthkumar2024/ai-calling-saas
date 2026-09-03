/**
 * Short-lived call tokens for the browser dialer.
 *
 * The gateway's shared secret must never reach a browser: anyone could read it
 * and drive the gateway for any tenant. Instead Vaani mints a token bound to
 * one call id with a short expiry, and the gateway verifies it with the secret
 * it already holds — no database lookup, no long-lived credential in the tab.
 *
 * Format: `v2.<callId>.<role>.<mode>.<expiryUnix>.<hex hmac>`, signed over
 * everything before the signature. v1 (`v1.<callId>.<expiry>.<hmac>`) is still
 * accepted and reads as a full-duplex agent leg, so a token already in flight
 * during a deploy keeps working.
 *
 * The role and mode are inside the signature on purpose: a supervisor cannot
 * upgrade their own monitor token into a full participant by editing the URL.
 *
 * NOTE: mirrored from lib/dialer-token.ts in the app.
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

export const LEG_ROLES = ['agent', 'ai', 'customer', 'supervisor'];
export const LEG_MODES = ['duplex', 'listen', 'whisper'];
export async function mintDialerToken(input) {
  if (!input.callId || input.callId.includes('.'))
    throw new Error('A call id without dots is required.');
  const role = input.role ?? 'agent';
  const mode = input.mode ?? 'duplex';
  if (!LEG_ROLES.includes(role)) throw new Error(`Unknown leg role: ${role}`);
  if (!LEG_MODES.includes(mode)) throw new Error(`Unknown leg mode: ${mode}`);
  const now = input.now ?? Date.now();
  const expiry =
    Math.floor(now / 1000) + (input.ttlSeconds ?? DIALER_TOKEN_TTL_SECONDS);
  const payload = `v2.${input.callId}.${role}.${mode}.${expiry}`;
  return `${payload}.${await sign(payload, input.secret)}`;
}

export async function verifyDialerToken(token, secret, now = Date.now()) {
  const parts = String(token ?? '').split('.');
  const version = parts[0];
  let callId;
  let role;
  let mode;
  let expiryRaw;
  let provided;
  if (version === 'v2') {
    if (parts.length !== 6) return { ok: false, reason: 'malformed_token' };
    [, callId, role, mode, expiryRaw, provided] = parts;
  } else if (version === 'v1') {
    if (parts.length !== 4) return { ok: false, reason: 'malformed_token' };
    [, callId, expiryRaw, provided] = parts;
    role = 'agent';
    mode = 'duplex';
  } else {
    return {
      ok: false,
      reason: version ? 'unsupported_version' : 'malformed_token',
    };
  }
  if (!callId) return { ok: false, reason: 'missing_call_id' };
  if (!LEG_ROLES.includes(role))
    return { ok: false, reason: 'unknown_role' };
  if (!LEG_MODES.includes(mode))
    return { ok: false, reason: 'unknown_mode' };
  const expiry = Number(expiryRaw);
  if (!Number.isFinite(expiry)) return { ok: false, reason: 'bad_expiry' };
  if (Math.floor(now / 1000) > expiry) return { ok: false, reason: 'expired' };

  const payload =
    version === 'v2'
      ? `v2.${callId}.${role}.${mode}.${expiryRaw}`
      : `v1.${callId}.${expiryRaw}`;
  const expected = await sign(payload, secret);
  if (expected.length !== provided.length)
    return { ok: false, reason: 'signature_mismatch' };
  // Constant time: an early return on the first differing character leaks.
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  }
  return mismatch === 0
    ? {
        ok: true,
        callId,
        role,
        mode,
        expiresAt: expiry * 1000,
      }
    : { ok: false, reason: 'signature_mismatch' };
}
