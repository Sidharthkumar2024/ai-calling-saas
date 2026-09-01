import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { createOpaqueToken, sha256, verifyPassword } from '@/lib/security';

export const SESSION_COOKIE = 'vaani_session';

export type AppRole =
  | 'platform_admin'
  | 'customer_owner'
  | 'customer_agent';

export type AppSession = {
  sessionId: string;
  userId: string;
  organizationId: string | null;
  organizationName: string | null;
  name: string;
  email: string;
  role: AppRole;
};

type UserRow = {
  id: string;
  organization_id: string | null;
  name: string;
  email: string;
  password_hash: string;
  role: AppRole;
  status: string;
};

export async function loginWithPassword(email: string, password: string) {
  await ensureSchema();
  const db = getRawDb();
  const user = await db
    .prepare(
      `SELECT id, organization_id, name, email, password_hash, role, status
       FROM app_users WHERE lower(email) = lower(?) LIMIT 1`,
    )
    .bind(email.trim())
    .first<UserRow>();

  if (
    !user ||
    user.status !== 'active' ||
    !(await verifyPassword(password, user.password_hash))
  ) {
    return null;
  }

  const token = createOpaqueToken('vs_');
  const tokenHash = await sha256(token);
  const sessionId = `session_${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await db.batch([
    db
      .prepare(
        `DELETE FROM auth_sessions
         WHERE user_id = ? AND (expires_at <= ? OR id IN (
           SELECT id FROM auth_sessions WHERE user_id = ?
           ORDER BY created_at DESC LIMIT -1 OFFSET 5
         ))`,
      )
      .bind(user.id, new Date().toISOString(), user.id),
    db
      .prepare(
        `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(sessionId, user.id, tokenHash, expiresAt),
    db
      .prepare('UPDATE app_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(user.id),
  ]);

  return { token, user };
}

export async function getSessionFromHeaders(
  requestHeaders: Headers,
): Promise<AppSession | null> {
  await ensureSchema();
  const token = readCookie(requestHeaders.get('cookie'), SESSION_COOKIE);
  if (!token) return null;

  const db = getRawDb();
  const tokenHash = await sha256(token);
  const session = await db
    .prepare(
      `SELECT
         s.id AS session_id,
         u.id AS user_id,
         u.organization_id,
         o.name AS organization_name,
         u.name,
         u.email,
         u.role
       FROM auth_sessions s
       INNER JOIN app_users u ON u.id = s.user_id
       LEFT JOIN organizations o ON o.id = u.organization_id
       WHERE s.token_hash = ?
         AND s.expires_at > ?
         AND u.status = 'active'
       LIMIT 1`,
    )
    .bind(tokenHash, new Date().toISOString())
    .first<{
      session_id: string;
      user_id: string;
      organization_id: string | null;
      organization_name: string | null;
      name: string;
      email: string;
      role: AppRole;
    }>();

  if (!session) return null;
  return {
    sessionId: session.session_id,
    userId: session.user_id,
    organizationId: session.organization_id,
    organizationName: session.organization_name,
    name: session.name,
    email: session.email,
    role: session.role,
  };
}

export async function destroySession(requestHeaders: Headers) {
  await ensureSchema();
  const token = readCookie(requestHeaders.get('cookie'), SESSION_COOKIE);
  if (!token) return;
  const tokenHash = await sha256(token);
  await getRawDb()
    .prepare('DELETE FROM auth_sessions WHERE token_hash = ?')
    .bind(tokenHash)
    .run();
}

export async function destroySessionToken(token: string) {
  await ensureSchema();
  const tokenHash = await sha256(token);
  await getRawDb()
    .prepare('DELETE FROM auth_sessions WHERE token_hash = ?')
    .bind(tokenHash)
    .run();
}

export function sessionCookie(token: string, secure: boolean) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure ? '; Secure' : ''}`;
}

export function clearedSessionCookie(secure: boolean) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function isAdminRole(role: AppRole) {
  return role === 'platform_admin';
}

export function isCustomerRole(role: AppRole) {
  return role === 'customer_owner' || role === 'customer_agent';
}

function readCookie(headerValue: string | null, name: string) {
  if (!headerValue) return null;
  for (const part of headerValue.split(';')) {
    const [cookieName, ...valueParts] = part.trim().split('=');
    if (cookieName === name) return valueParts.join('=') || null;
  }
  return null;
}
