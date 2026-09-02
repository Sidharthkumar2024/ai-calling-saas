import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { enforceRateLimit, requestFingerprint } from '@/lib/rate-limit';
import { createOpaqueToken, hashPassword, sha256 } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  await ensureSchema();
  const body = (await request.json()) as {
    action?: string;
    email?: string;
    token?: string;
    password?: string;
  };
  if (body.action === 'request') {
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
      developmentToken =
        process.env.NODE_ENV === 'production' ? undefined : token;
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
    const challenge = await getRawDb()
      .prepare(`SELECT id, user_id FROM security_challenges
      WHERE token_hash = ? AND type = 'password_reset' AND consumed_at IS NULL AND expires_at > ?`)
      .bind(tokenHash, new Date().toISOString())
      .first<{ id: string; user_id: string }>();
    if (!challenge)
      return NextResponse.json(
        { error: 'Reset link is invalid or expired.' },
        { status: 400 },
      );
    await getRawDb().batch([
      getRawDb()
        .prepare('UPDATE app_users SET password_hash = ? WHERE id = ?')
        .bind(await hashPassword(password), challenge.user_id),
      getRawDb()
        .prepare(
          'UPDATE security_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?',
        )
        .bind(challenge.id),
      getRawDb()
        .prepare('DELETE FROM auth_sessions WHERE user_id = ?')
        .bind(challenge.user_id),
    ]);
    return NextResponse.json({ reset: true });
  }
  return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
}
