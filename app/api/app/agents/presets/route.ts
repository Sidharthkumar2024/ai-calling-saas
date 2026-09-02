import { NextResponse } from 'next/server';

import { requireCustomer } from '@/lib/api-session';
import { AGENT_PRESETS } from '@/lib/agent-presets';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  return NextResponse.json({ presets: AGENT_PRESETS });
}
