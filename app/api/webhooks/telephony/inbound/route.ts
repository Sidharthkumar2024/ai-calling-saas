import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { resolveInboundCall } from '@/lib/inbound-routing';

export const dynamic = 'force-dynamic';

/**
 * Inbound call entry point (blueprint §6).
 *
 * There was no inbound path at all: the Exotel webhook only updated existing
 * outbound calls, so `number_routes` had no consumer. A carrier (or the media
 * gateway in front of it) posts the dialled and calling number here; this
 * resolves the route, opens the call record, and returns the decision.
 *
 * It does not bridge media — that needs a service with a WebSocket, which this
 * runtime does not provide — so the response describes what should happen
 * rather than claiming the call was connected.
 */
export async function POST(request: Request) {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  if (!secret)
    return NextResponse.json(
      {
        error:
          'Inbound calling is not configured: set INBOUND_WEBHOOK_SECRET before pointing a carrier at this endpoint.',
      },
      { status: 503 },
    );
  // Constant-length comparison is not required for a non-secret-derived value,
  // but the check must exist: this endpoint creates records.
  if (request.headers.get('x-vaani-inbound-secret') !== secret)
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const text = (key: string) =>
    typeof body[key] === 'string' ? (body[key] as string).trim() : '';
  const toNumber = text('to') || text('To') || text('called');
  const fromNumber = text('from') || text('From') || text('caller');
  if (!toNumber || !fromNumber)
    return NextResponse.json(
      { error: 'Both the dialled number (to) and the caller (from) are required.' },
      { status: 400 },
    );

  await ensureSchema();
  const decision = await resolveInboundCall({ toNumber, fromNumber });
  if (!decision.matched || !decision.organizationId)
    return NextResponse.json({ decision }, { status: 404 });

  const providerReference =
    text('providerCallId') || text('CallSid') || text('call_id') || null;
  const db = getRawDb();
  // Idempotency: a carrier retry must not open a second call record.
  if (providerReference) {
    const existing = await db
      .prepare(`SELECT id FROM call_records
        WHERE organization_id = ? AND provider_reference = ? LIMIT 1`)
      .bind(decision.organizationId, providerReference)
      .first<{ id: string }>();
    if (existing)
      return NextResponse.json({
        callId: existing.id,
        duplicate: true,
        decision,
      });
  }

  const callId = `call_${crypto.randomUUID()}`;
  const agentId =
    decision.target?.kind === 'voice_agent' ? decision.target.id : null;
  await db
    .prepare(`INSERT INTO call_records
      (id, organization_id, agent_id, direction, channel, from_number, to_number,
       status, outcome, recording_status, provider_reference, started_at, analysis_json)
      VALUES (?, ?, ?, 'inbound', 'phone', ?, ?, 'queued', ?, 'pending', ?, ?, ?)`)
    .bind(
      callId,
      decision.organizationId,
      agentId,
      fromNumber,
      toNumber,
      decision.action,
      providerReference,
      new Date().toISOString(),
      JSON.stringify({
        routeId: decision.routeId ?? null,
        routeType: decision.routeType ?? null,
        offHours: decision.offHours,
        decision: decision.action,
        reason: decision.reason,
      }),
    )
    .run();
  if (agentId)
    await db
      .prepare(`INSERT INTO call_participants
        (id, organization_id, call_id, participant_type, reference_id, display_name)
        VALUES (?, ?, ?, 'ai_agent', ?, ?)`)
      .bind(
        `participant_${crypto.randomUUID()}`,
        decision.organizationId,
        callId,
        agentId,
        decision.target?.kind === 'voice_agent'
          ? decision.target.name
          : 'AI agent',
      )
      .run();

  return NextResponse.json({
    callId,
    duplicate: false,
    decision,
    // Explicit so an integrator is never left assuming media is handled here.
    mediaBridged: false,
    note: 'Vaani resolved the route and opened the call record. The media gateway must bridge audio.',
  });
}
