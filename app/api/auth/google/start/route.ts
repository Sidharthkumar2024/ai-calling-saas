import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { createOpaqueToken, encryptSecret, sha256 } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  await ensureSchema();
  const provider = await getRawDb()
    .prepare(`SELECT enabled, status FROM auth_provider_settings
    WHERE provider = 'google'`)
    .first<{ enabled: number; status: string }>();
  if (!provider?.enabled)
    return NextResponse.json(
      { error: 'Google sign-in is disabled by the platform admin.' },
      { status: 503 },
    );
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !redirectUri)
    return NextResponse.json(
      { error: 'Google sign-in credentials are not configured.' },
      { status: 503 },
    );
  const state = createOpaqueToken('oauth_');
  const verifier = createOpaqueToken('pkce_');
  const challenge = base64Url(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  );
  const returnToValue = new URL(request.url).searchParams.get('returnTo');
  const returnTo = returnToValue === '/admin' ? '/admin' : '/app';
  await getRawDb()
    .prepare(`INSERT INTO oauth_states
    (id, provider, state_hash, code_verifier_encrypted, return_to, expires_at)
    VALUES (?, 'google', ?, ?, ?, ?)`)
    .bind(
      `oauth_state_${crypto.randomUUID()}`,
      await sha256(state),
      await encryptSecret(verifier),
      returnTo,
      new Date(Date.now() + 10 * 60_000).toISOString(),
    )
    .run();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'select_account',
  }).toString();
  return NextResponse.redirect(url);
}

function base64Url(buffer: ArrayBuffer) {
  let binary = '';
  for (const byte of new Uint8Array(buffer))
    binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
