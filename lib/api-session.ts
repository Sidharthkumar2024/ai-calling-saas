import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';

import {
  getSessionFromHeaders,
  isAdminRole,
  isCustomerRole,
  type AppSession,
} from '@/lib/app-auth';

type SessionResult =
  | { session: AppSession; response?: never }
  | { session?: never; response: NextResponse };

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
  return { session };
}
