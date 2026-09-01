import { NextResponse } from 'next/server';

import {
  getSessionFromHeaders,
  isAdminRole,
  isCustomerRole,
  type AppSession,
} from '@/lib/app-auth';

type SessionResult =
  | { session: AppSession; response?: never }
  | { session?: never; response: NextResponse };

export async function requireCustomer(request: Request): Promise<SessionResult> {
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
