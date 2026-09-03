/**
 * ElevenLabs webhook signature verification.
 *
 * Kept separate from the route so it is unit-testable without pulling in the
 * framework, and so the one security-critical piece of this integration is
 * readable on its own.
 */

const MAX_SKEW_SECONDS = 30 * 60;

/** ElevenLabs signs as `t=<unix>,v0=<hex>` over `${t}.${rawBody}`. */
export async function verifyElevenLabsSignature(
  header: string | null,
  rawBody: string,
  secret: string,
  now = Date.now(),
): Promise<{ ok: boolean; reason?: string }> {
  if (!header) return { ok: false, reason: 'missing_signature_header' };
  const parts = Object.fromEntries(
    header
      .split(',')
      .map((piece) => piece.trim().split('='))
      .filter((pair) => pair.length >= 2)
      .map((pair) => [pair[0], pair.slice(1).join('=')]),
  ) as Record<string, string>;
  const timestamp = parts.t;
  const provided = parts.v0;
  if (!timestamp || !provided)
    return { ok: false, reason: 'signature_header_must_be_t_and_v0' };
  const age = Math.abs(Math.floor(now / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_SKEW_SECONDS)
    return { ok: false, reason: 'timestamp_outside_tolerance' };

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
    encoder.encode(`${timestamp}.${rawBody}`),
  );
  const expected = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const candidate = provided.startsWith('v0=') ? provided.slice(3) : provided;
  if (expected.length !== candidate.length)
    return { ok: false, reason: 'signature_mismatch' };
  // Constant-time comparison: a length-independent early return would leak.
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ candidate.charCodeAt(index);
  }
  return mismatch === 0
    ? { ok: true }
    : { ok: false, reason: 'signature_mismatch' };
}
