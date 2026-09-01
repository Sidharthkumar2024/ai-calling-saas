import { NextResponse } from 'next/server';

import {
  clearedSessionCookie,
  destroySession,
} from '@/lib/app-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  await destroySession(request.headers);
  const response = NextResponse.json({ ok: true });
  response.headers.set(
    'Set-Cookie',
    clearedSessionCookie(new URL(request.url).protocol === 'https:'),
  );
  return response;
}
