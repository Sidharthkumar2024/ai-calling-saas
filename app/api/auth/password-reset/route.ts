import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { sendTransactionalEmail } from '@/lib/commerce';
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
    const email = body.email?.trim().toLowerCase() || '';
    const limit = await enforceRateLimit({
      namespace: 'password-reset',
      identifier: requestFingerprint(request, email),
      limit: 4,
      windowSeconds: 300,
    });
    if (!limit.allowed)
      return NextResponse.json(
        {
          error:
            'Too many reset requests. Check your inbox or wait before requesting another link.',
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.max(1, limit.retryAfterSeconds)),
          },
        },
      );
    const user = await getRawDb()
      .prepare('SELECT id, organization_id FROM app_users WHERE lower(email) = ? AND status = ?')
      .bind(email, 'active')
      .first<{ id: string; organization_id: string | null }>();
    let developmentToken: string | undefined;
    if (user) {
      const token = createOpaqueToken('reset_');
      const challengeId = `challenge_${crypto.randomUUID()}`;
      await getRawDb()
        .prepare(`INSERT INTO security_challenges
        (id, user_id, type, token_hash, expires_at) VALUES (?, ?, 'password_reset', ?, ?)`)
        .bind(
          challengeId,
          user.id,
          await sha256(token),
          new Date(Date.now() + 30 * 60_000).toISOString(),
        )
        .run();
      if (process.env.NODE_ENV === 'production') {
        const resetUrl = new URL(
          portalPathFor(request),
          process.env.PUBLIC_BASE_URL || request.url,
        );
        resetUrl.searchParams.set('reset_token', token);
        try {
          const delivery = await sendTransactionalEmail({
            organizationId: user.organization_id ?? '',
            to: email,
            subject: 'Reset your Call Vani password',
            html: `<p>A password reset was requested for your Call Vani account.</p><p><a href="${escapeAttribute(resetUrl.toString())}">Reset password</a></p><p>This secure link expires in 30 minutes. If you did not request it, you can ignore this email.</p>`,
          });
          if (delivery.status !== 'sent')
            throw new Error('No production email provider is connected.');
        } catch (error) {
          const smtpError = error as {
            name?: unknown;
            code?: unknown;
            command?: unknown;
          };
          console.error('password_reset.delivery_failed', {
            name:
              typeof smtpError?.name === 'string'
                ? smtpError.name
                : 'Error',
            code:
              typeof smtpError?.code === 'string'
                ? smtpError.code
                : 'unknown',
            command:
              typeof smtpError?.command === 'string'
                ? smtpError.command
                : 'unknown',
          });
          await getRawDb()
            .prepare('DELETE FROM security_challenges WHERE id = ?')
            .bind(challengeId)
            .run();
        }
      } else {
        developmentToken = token;
      }
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

function portalPathFor(request: Request) {
  return new URL(request.url).searchParams.get('portal') === 'admin'
    ? '/admin/login'
    : '/login';
}

function escapeAttribute(value: string) {
  return value.replace(/[&<>"']/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
      character
    ] || character,
  );
}
