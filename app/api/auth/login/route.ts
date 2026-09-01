import { NextResponse } from 'next/server';

import {
  destroySessionToken,
  isAdminRole,
  isCustomerRole,
  loginWithPassword,
  sessionCookie,
} from '@/lib/app-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      email?: string;
      password?: string;
      portal?: 'admin' | 'customer';
    };
    if (!body.email || !body.password || !body.portal) {
      return NextResponse.json(
        { error: 'Email, password and portal are required.' },
        { status: 400 },
      );
    }

    const result = await loginWithPassword(body.email, body.password);
    if (!result) {
      return NextResponse.json(
        { error: 'Email or password is incorrect.' },
        { status: 401 },
      );
    }

    const portalMatches =
      (body.portal === 'admin' && isAdminRole(result.user.role)) ||
      (body.portal === 'customer' && isCustomerRole(result.user.role));
    if (!portalMatches) {
      await destroySessionToken(result.token);
      return NextResponse.json(
        {
          error:
            body.portal === 'admin'
              ? 'This account belongs to the customer workspace.'
              : 'This account belongs to the platform admin portal.',
        },
        { status: 403 },
      );
    }

    const response = NextResponse.json({
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        role: result.user.role,
      },
      redirectTo: body.portal === 'admin' ? '/admin' : '/app',
    });
    response.headers.set(
      'Set-Cookie',
      sessionCookie(result.token, new URL(request.url).protocol === 'https:'),
    );
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unable to sign in.',
      },
      { status: 500 },
    );
  }
}
