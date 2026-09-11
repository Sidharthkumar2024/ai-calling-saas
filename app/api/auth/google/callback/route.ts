import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { sessionCookie } from '@/lib/app-auth';
import { createOpaqueToken, decryptSecret, sha256 } from '@/lib/security';
import { googleAuthConfig } from '@/lib/google-auth-config';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  await ensureSchema();
  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!state || !code)
    return NextResponse.redirect(
      new URL('/login?error=google_cancelled', request.url),
    );
  const stateHash = await sha256(state);
  const browserState = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('vani_oauth_state='))
    ?.slice('vani_oauth_state='.length);
  if (!browserState || browserState !== stateHash)
    return NextResponse.redirect(
      new URL('/login?error=google_state', request.url),
    );
  const provider = await getRawDb()
    .prepare(
      "SELECT enabled, status FROM auth_provider_settings WHERE provider = 'google'",
    )
    .first<{ enabled: number; status: string }>();
  if (!provider?.enabled || provider.status !== 'active')
    return NextResponse.redirect(
      new URL('/login?error=google_disabled', request.url),
    );
  const oauth = await getRawDb()
    .prepare(`SELECT id, code_verifier_encrypted, return_to FROM oauth_states
    WHERE provider = 'google' AND state_hash = ? AND consumed_at IS NULL AND expires_at > ?`)
    .bind(stateHash, new Date().toISOString())
    .first<{
      id: string;
      code_verifier_encrypted: string;
      return_to: string;
    }>();
  if (!oauth)
    return NextResponse.redirect(
      new URL('/login?error=google_state', request.url),
    );
  const config = await googleAuthConfig();
  if (!config)
    return NextResponse.redirect(
      new URL('/login?error=google_config', request.url),
    );
  const { clientId, clientSecret, redirectUri } = config;
  const consumed = await getRawDb()
    .prepare(
      'UPDATE oauth_states SET consumed_at = CURRENT_TIMESTAMP WHERE id = ? AND consumed_at IS NULL RETURNING id',
    )
    .bind(oauth.id)
    .first();
  if (!consumed)
    return NextResponse.redirect(
      new URL('/login?error=google_state', request.url),
    );
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: await decryptSecret(oauth.code_verifier_encrypted),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const token = (await tokenResponse.json()) as { id_token?: string };
  if (!tokenResponse.ok || !token.id_token)
    return NextResponse.redirect(
      new URL('/login?error=google_exchange', request.url),
    );
  const verifiedResponse = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token.id_token)}`,
    { signal: AbortSignal.timeout(8_000) },
  );
  const identity = (await verifiedResponse.json()) as {
    aud?: string;
    iss?: string;
    exp?: string;
    email?: string;
    email_verified?: string;
    name?: string;
    sub?: string;
  };
  const issuerValid =
    identity.iss === 'https://accounts.google.com' ||
    identity.iss === 'accounts.google.com';
  const expiryValid = Number(identity.exp || 0) > Math.floor(Date.now() / 1000);
  if (
    !verifiedResponse.ok ||
    identity.aud !== clientId ||
    !issuerValid ||
    !expiryValid ||
    identity.email_verified !== 'true' ||
    !identity.email ||
    !identity.sub
  ) {
    return NextResponse.redirect(
      new URL('/login?error=google_identity', request.url),
    );
  }
  const user = await getRawDb()
    .prepare(
      `SELECT id, role, status FROM app_users WHERE lower(email) = lower(?)`,
    )
    .bind(identity.email)
    .first<{ id: string; role: string; status: string }>();
  if (!user || user.status !== 'active')
    return NextResponse.redirect(
      new URL('/login?error=google_account_required', request.url),
    );
  if ((oauth.return_to === '/admin') !== (user.role === 'platform_admin')) {
    return NextResponse.redirect(
      new URL('/login?error=wrong_portal', request.url),
    );
  }
  // Password sign-in remains the supported second-factor flow. Never issue an
  // OAuth session that silently bypasses an enrolled authenticator.
  const security = await getRawDb()
    .prepare(
      'SELECT mfa_enabled, email_verified_at FROM user_security_settings WHERE user_id = ?',
    )
    .bind(user.id)
    .first<{ mfa_enabled: number; email_verified_at: string | null }>();
  if (security?.mfa_enabled)
    return NextResponse.redirect(
      new URL('/login?error=google_mfa_use_password', request.url),
    );
  // A verified Google identity does not prove who created this password account.
  // Never silently merge it with an unverified signup and retain that signup's
  // password/sessions. Account ownership must already have been verified.
  if (!security?.email_verified_at)
    return NextResponse.redirect(
      new URL('/login?error=google_verification_required', request.url),
    );
  const sessionToken = createOpaqueToken('vs_');
  const sessionId = `session_${crypto.randomUUID()}`;
  await getRawDb().batch([
    getRawDb()
      .prepare(
        'UPDATE oauth_states SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?',
      )
      .bind(oauth.id),
    getRawDb()
      .prepare(
        `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`,
      )
      .bind(
        sessionId,
        user.id,
        await sha256(sessionToken),
        new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
      ),
  ]);
  const response = NextResponse.redirect(new URL(oauth.return_to, request.url));
  response.headers.set(
    'Set-Cookie',
    sessionCookie(sessionToken, url.protocol === 'https:'),
  );
  response.headers.append(
    'Set-Cookie',
    `vani_oauth_state=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0${url.protocol === 'https:' ? '; Secure' : ''}`,
  );
  return response;
}
