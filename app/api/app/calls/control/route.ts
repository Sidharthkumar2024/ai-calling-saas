import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import {
  isCallControlAction,
  sendCallControl,
  type CallControlAction,
} from '@/lib/call-control';
import { recordAudit } from '@/lib/demo-seed';

export const dynamic = 'force-dynamic';

/**
 * Controls a call that is happening right now (§4).
 *
 * Mute, hold, supervisor monitoring and hanging up existed in the media
 * gateway and could not be reached: there was no path from the portal to a
 * live session. This is that path.
 *
 * Two things it deliberately does before forwarding anything. It confirms the
 * call belongs to the caller's workspace — the gateway authenticates Vaani, not
 * the person, so a call id from another tenant would otherwise be controllable
 * by anyone holding one. And it audits, because muting or ending somebody
 * else's live call is exactly the action a workspace will later need to
 * attribute to a person.
 */
export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'calls.monitor');
  if (auth.response) return auth.response;
  await ensureSchema();

  const body = (await request.json()) as {
    callId?: string;
    action?: string;
    legId?: string;
    mode?: string;
    whisperTo?: string;
  };
  const callId = String(body.callId ?? '').trim();
  if (!callId)
    return NextResponse.json({ error: 'callId is required.' }, { status: 400 });
  if (!isCallControlAction(body.action))
    return NextResponse.json(
      { error: 'Unsupported control action.' },
      { status: 400 },
    );
  const action: CallControlAction = body.action;

  const organizationId = auth.session.organizationId!;
  const call = await getRawDb()
    .prepare(
      `SELECT id, status FROM call_records
       WHERE id = ? AND organization_id = ? LIMIT 1`,
    )
    .bind(callId, organizationId)
    .first<{ id: string; status: string }>();
  // 404 rather than 403: a workspace should not be able to discover that a
  // call id exists in another tenant by the shape of the refusal.
  if (!call)
    return NextResponse.json({ error: 'Call not found.' }, { status: 404 });

  const result = await sendCallControl({
    callId,
    action,
    legId: body.legId ?? null,
    mode: body.mode ?? null,
    whisperTo: body.whisperTo ?? null,
  });

  await recordAudit(auth.session, `call.${action}`, 'call', callId, {
    legId: body.legId ?? null,
    mode: body.mode ?? null,
    ok: result.ok,
    // Recorded on failure too: "somebody tried to end this call and the
    // gateway was unreachable" is the more useful half of the trail.
    ...(result.ok ? {} : { error: result.error }),
  });

  if (!result.ok)
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  return NextResponse.json({ ok: true, callId, action, legs: result.results });
}
