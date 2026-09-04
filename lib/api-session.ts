import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';

import {
  getSessionFromHeaders,
  isAdminRole,
  isCustomerRole,
  type AppSession,
} from '@/lib/app-auth';
import {
  allowedWhileRestricted,
  graceDeadline,
  mfaRequirement,
  restrictionMessage,
} from '@/lib/mfa-policy';

type SessionResult =
  | { session: AppSession; response?: never }
  | { session?: never; response: NextResponse };

/**
 * Blocks a privileged account with no second factor (§14).
 *
 * Applied inside the two guards every route already goes through, rather than
 * added to each route: enforcement that has to be remembered per endpoint is
 * enforcement that will be missing from the endpoint added next week.
 *
 * Returns null when the request may proceed. A restricted session keeps
 * exactly enough access to enrol — refusing it outright would be a door with
 * no key, because enrolling requires being signed in.
 */
async function mfaGate(
  request: Request,
  session: { userId: string; role: string },
): Promise<NextResponse | null> {
  // The workspace role is read alongside, because `owner` and `admin` there
  // carry every permission in the product regardless of the account's app
  // role — an app-role check alone would miss a workspace admin.
  const db = getRawDb();
  const row = await db
    .prepare(
      `SELECT s.mfa_enabled AS mfaEnabled, s.mfa_grace_until AS graceUntil,
              m.role AS workspaceRole
       FROM app_users u
       LEFT JOIN user_security_settings s ON s.user_id = u.id
       LEFT JOIN organization_members m ON m.user_id = u.id
       WHERE u.id = ? LIMIT 1`,
    )
    .bind(session.userId)
    .first<{
      mfaEnabled: number | null;
      graceUntil: string | null;
      workspaceRole: string | null;
    }>();
  const requirement = mfaRequirement({
    role: session.role,
    workspaceRole: row?.workspaceRole ?? null,
    mfaEnabled: Number(row?.mfaEnabled ?? 0) === 1,
    graceUntil: row?.graceUntil ?? null,
  });
  if (requirement === 'grace') {
    // Start the clock the first time this account is seen needing it. Written
    // once — the WHERE keeps a later request from pushing the deadline out and
    // making the window last for ever.
    if (!row?.graceUntil)
      await db
        .prepare(
          `INSERT INTO user_security_settings (user_id, mfa_enabled, mfa_grace_until, updated_at)
           VALUES (?, 0, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(user_id) DO UPDATE SET
             mfa_grace_until = excluded.mfa_grace_until,
             updated_at = CURRENT_TIMESTAMP
           WHERE user_security_settings.mfa_grace_until IS NULL`,
        )
        .bind(session.userId, graceDeadline())
        .run();
    return null;
  }
  if (requirement !== 'must_enrol') return null;
  const pathname = new URL(request.url).pathname;
  if (allowedWhileRestricted(pathname)) return null;
  return NextResponse.json(
    {
      error: restrictionMessage(session.role),
      // A distinct code so the portal can send the person to the right screen
      // instead of rendering a generic forbidden state on every panel at once.
      code: 'mfa_required',
    },
    { status: 403 },
  );
}

export async function requireCustomer(
  request: Request,
): Promise<SessionResult> {
  const session = await getSessionFromHeaders(request.headers);
  if (!session) {
    return {
      response: NextResponse.json(
        { error: 'Authentication required.' },
        { status: 401 },
      ),
    };
  }
  if (!isCustomerRole(session.role) || !session.organizationId) {
    return {
      response: NextResponse.json(
        { error: 'Customer workspace access required.' },
        { status: 403 },
      ),
    };
  }
  // A suspended workspace must actually stop working. Nothing checked this, so
  // suspending an organization changed a row and nothing else.
  const organization = await getRawDb()
    .prepare(
      `SELECT status, suspension_reason FROM organizations WHERE id = ? LIMIT 1`,
    )
    .bind(session.organizationId)
    .first<{ status: string; suspension_reason: string | null }>();
  if (organization && organization.status !== 'active') {
    return {
      response: NextResponse.json(
        {
          error:
            organization.status === 'suspended'
              ? 'This workspace is suspended. Contact platform support.'
              : `This workspace is ${organization.status}.`,
          ...(organization.suspension_reason
            ? { reason: organization.suspension_reason }
            : {}),
        },
        { status: 403 },
      ),
    };
  }
  const gated = await mfaGate(request, session);
  if (gated) return { response: gated };
  return { session };
}

export async function requireAdmin(request: Request): Promise<SessionResult> {
  const session = await getSessionFromHeaders(request.headers);
  if (!session) {
    return {
      response: NextResponse.json(
        { error: 'Authentication required.' },
        { status: 401 },
      ),
    };
  }
  if (!isAdminRole(session.role)) {
    return {
      response: NextResponse.json(
        { error: 'Platform admin access required.' },
        { status: 403 },
      ),
    };
  }
  const gated = await mfaGate(request, session);
  if (gated) return { response: gated };
  return { session };
}
