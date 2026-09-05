import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import { recordAudit } from '@/lib/demo-seed';
import { listCallbacks, moveCallback } from '@/lib/callback-service';
import { isCallbackStatus } from '@/lib/callbacks';

export const dynamic = 'force-dynamic';

/**
 * The callback queue (§8 handoff, and every "we will call you back" the agent
 * has ever said).
 *
 * `crm.manage`, because working this queue is ringing customers back.
 */
export async function GET(request: Request) {
  const auth = await requireCustomerPermission(request, 'crm.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  return NextResponse.json(await listCallbacks(auth.session.organizationId!));
}

export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'crm.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const body = (await request.json()) as {
    callbackId?: string;
    status?: string;
    note?: string;
  };
  if (!isCallbackStatus(body.status))
    return NextResponse.json({ error: 'Unknown status.' }, { status: 400 });
  const result = await moveCallback({
    organizationId: auth.session.organizationId!,
    callbackId: String(body.callbackId ?? ''),
    status: body.status,
    note: body.note,
    userId: auth.session.userId,
  });
  if (result.ok)
    await recordAudit(
      auth.session,
      `callback.${body.status}`,
      'callback_request',
      String(body.callbackId),
      { note: body.note ?? null },
    );
  // A refused move is a 200 with the reason: "you cannot mark it reached
  // without calling it" is an answer, not a server error.
  return NextResponse.json(result);
}
