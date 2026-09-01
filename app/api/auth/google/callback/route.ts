import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { sessionCookie } from '@/lib/app-auth';
import { createOpaqueToken, decryptSecret, sha256 } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  await ensureSchema();
  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!state || !code) return NextResponse.redirect(new URL('/login?error=google_cancelled', request.url));
  const stateHash = await sha256(state);
  const oauth = await getRawDb().prepare(`SELECT id, code_verifier_encrypted, return_to FROM oauth_states
    WHERE provider = 'google' AND state_hash = ? AND consumed_at IS NULL AND expires_at > ?`)
    .bind(stateHash, new Date().toISOString()).first<{ id: string; code_verifier_encrypted: string; return_to: string }>();
  if (!oauth) return NextResponse.redirect(new URL('/login?error=google_state', request.url));
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return NextResponse.redirect(new URL('/login?error=google_config', request.url));
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri,
      grant_type: 'authorization_code', code_verifier: await decryptSecret(oauth.code_verifier_encrypted) }),
    signal: AbortSignal.timeout(10_000),
  });
  const token = await tokenResponse.json() as { id_token?: string };
  if (!tokenResponse.ok || !token.id_token) return NextResponse.redirect(new URL('/login?error=google_exchange', request.url));
  const verifiedResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token.id_token)}`, { signal: AbortSignal.timeout(8_000) });
  const identity = await verifiedResponse.json() as { aud?: string; iss?: string; exp?: string; email?: string; email_verified?: string; name?: string; sub?: string };
  const issuerValid = identity.iss === 'https://accounts.google.com' || identity.iss === 'accounts.google.com';
  const expiryValid = Number(identity.exp || 0) > Math.floor(Date.now() / 1000);
  if (!verifiedResponse.ok || identity.aud !== clientId || !issuerValid || !expiryValid || identity.email_verified !== 'true' || !identity.email) {
    return NextResponse.redirect(new URL('/login?error=google_identity', request.url));
  }
  const user = await getRawDb().prepare(`SELECT id, role, status FROM app_users WHERE lower(email) = lower(?)`)
    .bind(identity.email).first<{ id: string; role: string; status: string }>();
  if (!user || user.status !== 'active') return NextResponse.redirect(new URL('/login?error=google_account_required', request.url));
  if ((oauth.return_to === '/admin') !== (user.role === 'platform_admin')) {
    return NextResponse.redirect(new URL('/login?error=wrong_portal', request.url));
  }
  const sessionToken = createOpaqueToken('vs_');
  const sessionId = `session_${crypto.randomUUID()}`;
  await getRawDb().batch([
    getRawDb().prepare('UPDATE oauth_states SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?').bind(oauth.id),
    getRawDb().prepare(`INSERT INTO auth_sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`)
      .bind(sessionId, user.id, await sha256(sessionToken), new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString()),
    getRawDb().prepare(`INSERT INTO user_security_settings (user_id, email_verified_at)
      VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET email_verified_at=CURRENT_TIMESTAMP`).bind(user.id),
  ]);
  const response = NextResponse.redirect(new URL(oauth.return_to, request.url));
  response.headers.set('Set-Cookie', sessionCookie(sessionToken, url.protocol === 'https:'));
  return response;
}
