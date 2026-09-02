import { NextResponse } from 'next/server';

import { getSessionFromHeaders } from '@/lib/app-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await getSessionFromHeaders(request.headers);
  if (!session) {
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    );
  }
  return NextResponse.json({ session });
}
