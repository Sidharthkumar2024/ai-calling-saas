import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { resolveInboundCall } from '@/lib/inbound-routing';
import { vobizWorkspaceCredentials } from '@/lib/provider-adapters';
import { readVobizCallback, verifyVobizSignature, vobizStreamXml } from '@/lib/vobiz';

export const dynamic = 'force-dynamic';

/**
 * Vobiz's account-level incoming-call application.
 *
 * An outbound call already has an internal call id before Vobiz fetches its
 * answer URL. An inbound call does not. This endpoint first identifies the
 * dialled, active Vobiz number, uses only that customer's token to verify the
 * signature, then creates exactly one local call record for the Vobiz UUID.
 * No number is ever routed merely because somebody POSTed its digits here.
 */
export async function POST(request: Request) {
  await ensureSchema();
  const contentType = request.headers.get('content-type') || '';
  const raw = contentType.includes('application/json')
    ? ((await request.json().catch(() => ({}))) as Record<string, unknown>)
    : (Object.fromEntries((await request.formData()).entries()) as Record<string, unknown>);
  const callback = readVobizCallback(raw);
  const to = callback?.to;
  const from = callback?.from;
  if (!callback || !to || !from)
    return NextResponse.json({ error: 'Vobiz inbound callback needs CallUUID, To and From.' }, { status: 400 });

  const db = getRawDb();
  const digits = to.replace(/\D/g, '');
  const candidates = await db.prepare(`SELECT id, organization_id FROM phone_numbers
    WHERE provider_code = 'vobiz' AND status = 'active'
      AND replace(replace(replace(phone_number, '+', ''), ' ', ''), '-', '') IN (?, ?)`)
    .bind(digits, digits.slice(-10)).all<{ id: string; organization_id: string }>();
  const numbers = candidates.results ?? [];
  if (numbers.length !== 1)
    return NextResponse.json({ error: 'The called Vobiz number is not uniquely active.' }, { status: 404 });
  const number = numbers[0];
  const credentials = await vobizWorkspaceCredentials(number.organization_id);
  const signature = await verifyVobizSignature({ url: request.url, headers: request.headers, authToken: credentials.authToken });
  if (!signature.ok) return NextResponse.json({ error: 'Webhook authentication failed.' }, { status: 401 });

  const decision = await resolveInboundCall({ toNumber: to, fromNumber: from });
  if (decision.action !== 'connect_agent' || decision.target?.kind !== 'voice_agent')
    return NextResponse.json({ error: decision.reason }, { status: 409 });
  const streamBase = process.env.VOICE_STREAM_URL || '';
  if (!streamBase.startsWith('wss://'))
    return NextResponse.json({ error: 'Secure media gateway is not configured.' }, { status: 503 });

  const existing = await db.prepare(`SELECT id FROM call_records
    WHERE organization_id = ? AND provider_reference = ? LIMIT 1`)
    .bind(number.organization_id, callback.callUuid).first<{ id: string }>();
  const callId = existing?.id ?? `call_${crypto.randomUUID()}`;
  if (!existing) await db.prepare(`INSERT INTO call_records
    (id, organization_id, agent_id, direction, channel, from_number, to_number, status, outcome,
     recording_status, provider_reference, started_at, analysis_json)
    VALUES (?, ?, ?, 'inbound', 'phone', ?, ?, 'in_progress', 'unknown', 'pending', ?, ?, ?)`)
    .bind(callId, number.organization_id, decision.target.id, from, to, callback.callUuid,
      callback.startedAt ?? new Date().toISOString(), JSON.stringify({ routeId: decision.routeId, provider: 'vobiz' }))
    .run();

  const stream = new URL(streamBase);
  stream.searchParams.set('callId', callId);
  stream.searchParams.set('carrier', 'vobiz');
  const publicBase = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return new Response(vobizStreamXml({ streamUrl: stream.toString(), statusCallbackUrl: publicBase ? `${publicBase}/api/webhooks/telephony/vobiz/status/${encodeURIComponent(callId)}` : null }), {
    headers: { 'content-type': 'text/xml; charset=utf-8', 'cache-control': 'no-store' },
  });
}
