import { NextResponse } from 'next/server';

import {
  destroySessionToken,
  isAdminRole,
  isCustomerRole,
  loginWithPassword,
  sessionCookie,
} from '@/lib/app-auth';
import { enforceRateLimit, requestFingerprint } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      email?: string;
      password?: string;
      portal?: 'admin' | 'customer';
      otp?: string;
    };
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.email !== 'string' || !body.email.trim() || typeof body.password !== 'string' || !body.password || !['admin', 'customer'].includes(body.portal ?? '') || (body.otp !== undefined && typeof body.otp !== 'string')) {
      return NextResponse.json(
        { error: 'Email, password and portal are required.' },
        { status: 400 },
      );
    }
    body.email = body.email.trim().toLowerCase();

    const limit = await enforceRateLimit({
      namespace: 'login',
      identifier: requestFingerprint(request, body.email),
      limit: 8,
      windowSeconds: 15 * 60,
      blockSeconds: 15 * 60,
    });
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many sign-in attempts. Try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(limit.retryAfterSeconds) },
        },
      );
    }

    const result = await loginWithPassword(body.email, body.password, body.otp);
    if (!result) {
      return NextResponse.json(
        { error: 'Email or password is incorrect.' },
        { status: 401 },
      );
    }
    if ('mfaRequired' in result && result.mfaRequired) {
      return NextResponse.json(
        {
          error: 'Enter the six-digit authenticator code.',
          code: 'MFA_REQUIRED',
        },
        { status: 401 },
      );
    }
    if ('mfaInvalid' in result && result.mfaInvalid) {
      return NextResponse.json(
        { error: 'Authenticator code is invalid.', code: 'MFA_REQUIRED' },
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
        error: error instanceof SyntaxError ? 'Invalid request.' : 'Unable to sign in. Please try again.',
      },
      { status: error instanceof SyntaxError ? 400 : 500 },
    );
  }
}
