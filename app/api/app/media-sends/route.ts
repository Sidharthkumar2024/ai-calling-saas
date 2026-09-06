import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import { recordAudit } from '@/lib/demo-seed';
import {
  cancelSend,
  listPendingSends,
  releaseWithheld,
} from '@/lib/media-release-service';

export const dynamic = 'force-dynamic';

/**
 * Media an agent was refused, waiting for a person.
 *
 * `crm.manage`, matching the callback queue next to it: releasing a file to a
 * customer is the same kind of act as ringing them back, and the same people
 * do it.
 */
export async function GET(request: Request) {
  const auth = await requireCustomerPermission(request, 'crm.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  return NextResponse.json(
    await listPendingSends(auth.session.organizationId!),
  );
}

export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'crm.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const body = (await request.json()) as {
    action?: string;
    sendId?: string;
    assetIds?: unknown;
    note?: string;
  };
  const sendId = String(body.sendId ?? '');

  if (body.action === 'cancel') {
    const result = await cancelSend({
      organizationId: auth.session.organizationId!,
      sendId,
    });
    if (result.ok)
      await recordAudit(
        auth.session,
        'media_send.cancelled',
        'whatsapp_send',
        sendId,
      );
    return NextResponse.json(result);
  }

  // Named explicitly rather than left as the fallback. A route whose default
  // branch performs a real action sends files to a customer on an unrecognised
  // request, which is how the CRM's bulk endpoint came to archive leads by
  // accident.
  if (body.action !== 'release')
    return NextResponse.json(
      { ok: false, reason: 'Unknown action.' },
      { status: 400 },
    );

  const assetIds = Array.isArray(body.assetIds)
    ? body.assetIds.map(String).filter(Boolean)
    : [];
  if (assetIds.length === 0)
    return NextResponse.json(
      { ok: false, reason: 'Choose at least one file to release.' },
      { status: 400 },
    );

  const result = await releaseWithheld({
    organizationId: auth.session.organizationId!,
    sendId,
    assetIds,
    userId: auth.session.userId,
    note: body.note,
  });
  if (result.ok)
    await recordAudit(
      auth.session,
      'media_send.released',
      'whatsapp_send',
      sendId,
      { released: result.released ?? [] },
    );
  // A refusal is a 200 with the reason: "that listing is no longer published"
  // is an answer, not a server error.
  return NextResponse.json(result);
}
