import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { completeConnection } from '@/lib/growth-connector-service';
import { isConnectorId } from '@/lib/growth-connectors';

export const dynamic = 'force-dynamic';

/**
 * Where Google and HubSpot send the customer back (§6).
 *
 * This runs with no session: the browser arrives from the provider, not from
 * the app. What authorises it is the one-time `state` — hashed, single-use,
 * ten-minute lifetime, and carrying the workspace it was started for. A
 * mismatched or reused state is refused outright, because it is the only thing
 * standing between this URL and anybody who can guess one.
 */
export async function GET(request: Request) {
  await ensureSchema();
  const params = new URL(request.url).searchParams;
  const connector = params.get('connector') ?? '';
  const error = params.get('error');
  if (error)
    return redirectBack(request, `Authorisation was refused: ${error}`);
  if (!isConnectorId(connector))
    return redirectBack(request, 'That connector is not one we know.');

  const code = params.get('code') ?? '';
  const state = params.get('state') ?? '';
  if (!code || !state)
    return redirectBack(request, 'The provider sent an incomplete response.');

  const result = await completeConnection({ id: connector, code, state });
  return redirectBack(
    request,
    result.ok ? null : result.reason,
    result.ok ? connector : null,
  );
}

function redirectBack(
  request: Request,
  problem: string | null,
  connected: string | null = null,
) {
  const target = new URL('/app', new URL(request.url).origin);
  target.searchParams.set('screen', 'growth');
  if (problem) target.searchParams.set('connectError', problem.slice(0, 200));
  if (connected) target.searchParams.set('connected', connected);
  return NextResponse.redirect(target);
}
