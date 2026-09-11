import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { getSessionFromHeaders } from '@/lib/app-auth';
import {
  createOpaqueToken,
  decryptSecret,
  encryptSecret,
  sha256,
} from '@/lib/security';
import { createTotpSecret, verifyTotp } from '@/lib/totp';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await getSessionFromHeaders(request.headers);
  if (!session)
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    );
  await ensureSchema();
  const settings = await getRawDb()
    .prepare(`SELECT email_verified_at, mfa_enabled, updated_at
    FROM user_security_settings WHERE user_id = ?`)
    .bind(session.userId)
    .first();
  const sessions = await getRawDb()
    .prepare(`SELECT id, expires_at, created_at FROM auth_sessions
    WHERE user_id = ? ORDER BY created_at DESC`)
    .bind(session.userId)
    .all();
  return NextResponse.json({
    settings: settings || { email_verified_at: null, mfa_enabled: 0 },
    sessions: sessions.results,
  });
}

export async function POST(request: Request) {
  const session = await getSessionFromHeaders(request.headers);
  if (!session)
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    );
  await ensureSchema();
  const body = (await request.json()) as {
    action?: string;
    code?: string;
    sessionId?: string;
  };
  const db = getRawDb();
  if (body.action === 'mfa_begin') {
    const existing = await db
      .prepare(
        'SELECT mfa_enabled FROM user_security_settings WHERE user_id = ?',
      )
      .bind(session.userId)
      .first<{ mfa_enabled: number }>();
    if (existing?.mfa_enabled)
      return NextResponse.json(
        {
          error:
            'An authenticator is already enabled. Contact your workspace administrator for account recovery.',
        },
        { status: 409 },
      );
    const secret = createTotpSecret();
    await db
      .prepare(`INSERT INTO user_security_settings (user_id, mfa_enabled, totp_secret_encrypted, updated_at)
      VALUES (?, 0, ?, CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET mfa_enabled=0,
      totp_secret_encrypted=excluded.totp_secret_encrypted, updated_at=CURRENT_TIMESTAMP`)
      .bind(session.userId, await encryptSecret(secret))
      .run();
    const issuer = encodeURIComponent('Vaani AI Calling');
    const label = encodeURIComponent(`Vaani:${session.email}`);
    return NextResponse.json({
      secret,
      otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&digits=6&period=30`,
    });
  }
  if (body.action === 'mfa_confirm') {
    const row = await db
      .prepare(
        'SELECT totp_secret_encrypted FROM user_security_settings WHERE user_id = ?',
      )
      .bind(session.userId)
      .first<{ totp_secret_encrypted: string | null }>();
    if (
      !row?.totp_secret_encrypted ||
      !body.code ||
      !(await verifyTotp(
        await decryptSecret(row.totp_secret_encrypted),
        body.code,
      ))
    ) {
      return NextResponse.json(
        { error: 'Verification code is invalid.' },
        { status: 400 },
      );
    }
    const recoveryCodes = Array.from({ length: 8 }, () =>
      createOpaqueToken().slice(0, 12),
    );
    const hashes = await Promise.all(recoveryCodes.map(sha256));
    await db
      .prepare(`UPDATE user_security_settings SET mfa_enabled = 1,
      recovery_code_hashes_json = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`)
      .bind(JSON.stringify(hashes), session.userId)
      .run();
    return NextResponse.json({ enabled: true, recoveryCodes });
  }
  if (body.action === 'revoke_session') {
    if (!body.sessionId || body.sessionId === session.sessionId)
      return NextResponse.json(
        { error: 'Select another active session.' },
        { status: 400 },
      );
    await db
      .prepare('DELETE FROM auth_sessions WHERE id = ? AND user_id = ?')
      .bind(body.sessionId, session.userId)
      .run();
    return NextResponse.json({ revoked: true });
  }
  return NextResponse.json(
    { error: 'Unsupported security action.' },
    { status: 400 },
  );
}
