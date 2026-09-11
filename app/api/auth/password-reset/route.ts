import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { enforceRateLimit, requestFingerprint } from '@/lib/rate-limit';
import { createOpaqueToken, hashPassword, sha256 } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  await ensureSchema();
  const body = (await request.json().catch(() => null)) as {
    action?: string;
    email?: string;
    token?: string;
    password?: string;
  } | null;
  if (
    !body ||
    !['request', 'confirm'].includes(body.action ?? '') ||
    Object.values(body).some((value) => typeof value !== 'string')
  )
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  if (body.action === 'request') {
    // Do not claim to have sent a recovery email when no delivery is wired.
    if (process.env.NODE_ENV === 'production')
      return NextResponse.json(
        {
          error:
            'Email password recovery is not configured yet. Contact your workspace administrator.',
        },
        { status: 503 },
      );
    const email = body.email?.trim().toLowerCase() || '';
    const limit = await enforceRateLimit({
      namespace: 'password-reset',
      identifier: requestFingerprint(request, email),
      limit: 4,
      windowSeconds: 3600,
    });
    if (!limit.allowed)
      return NextResponse.json({ error: 'Try again later.' }, { status: 429 });
    const user = await getRawDb()
      .prepare('SELECT id FROM app_users WHERE lower(email) = ? AND status = ?')
      .bind(email, 'active')
      .first<{ id: string }>();
    let developmentToken: string | undefined;
    if (user) {
      const token = createOpaqueToken('reset_');
      developmentToken = token;
      await getRawDb()
        .prepare(`INSERT INTO security_challenges
        (id, user_id, type, token_hash, expires_at) VALUES (?, ?, 'password_reset', ?, ?)`)
        .bind(
          `challenge_${crypto.randomUUID()}`,
          user.id,
          await sha256(token),
          new Date(Date.now() + 30 * 60_000).toISOString(),
        )
        .run();
    }
    return NextResponse.json({
      accepted: true,
      message: 'If the account exists, a secure reset link will be sent.',
      ...(developmentToken ? { developmentToken } : {}),
    });
  }
  if (body.action === 'confirm') {
    const limit = await enforceRateLimit({
      namespace: 'password-reset-confirm',
      identifier: requestFingerprint(request),
      limit: 10,
      windowSeconds: 900,
    });
    if (!limit.allowed)
      return NextResponse.json({ error: 'Try again later.' }, { status: 429 });
    const password = body.password || '';
    if (
      !body.token ||
      password.length < 10 ||
      !/[a-zA-Z]/.test(password) ||
      !/\d/.test(password)
    ) {
      return NextResponse.json(
        { error: 'A valid token and strong password are required.' },
        { status: 400 },
      );
    }
    const tokenHash = await sha256(body.token);
    const passwordHash = await hashPassword(password);
    const db = getRawDb();
    const now = new Date().toISOString();
    const validUser = `SELECT user_id FROM security_challenges WHERE token_hash = ? AND type = 'password_reset' AND consumed_at IS NULL AND expires_at > ?`;
    // Password, session revocation and token consumption succeed or roll back together.
    const results = await db.batch([
      db
        .prepare(
          `UPDATE app_users SET password_hash = ? WHERE id IN (${validUser})`,
        )
        .bind(passwordHash, tokenHash, now),
      db
        .prepare(`DELETE FROM auth_sessions WHERE user_id IN (${validUser})`)
        .bind(tokenHash, now),
      db
        .prepare(
          `UPDATE security_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND type = 'password_reset' AND consumed_at IS NULL AND expires_at > ?`,
        )
        .bind(tokenHash, now),
    ]);
    if (!results[0]?.meta?.changes)
      return NextResponse.json(
        { error: 'Reset link is invalid or expired.' },
        { status: 400 },
      );
    return NextResponse.json({ reset: true });
  }
  return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
}
