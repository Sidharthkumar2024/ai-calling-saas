import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { storeRecording } from '@/lib/recording-storage';
import { exotelCredits, settleExotel } from '@/lib/exotel-settlement';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get('token');
  if (
    !process.env.TELEPHONY_WEBHOOK_SECRET ||
    token !== process.env.TELEPHONY_WEBHOOK_SECRET
  ) {
    return NextResponse.json(
      { error: 'Webhook authentication failed.' },
      { status: 401 },
    );
  }
  await ensureSchema();
  const contentType = request.headers.get('content-type') || '';
  const raw = contentType.includes('application/json')
    ? ((await request.json()) as Record<string, unknown>)
    : Object.fromEntries((await request.formData()).entries());
  const callId =
    value(raw.CustomField) || value(raw.customfield) || value(raw.call_id);
  const providerReference = value(raw.CallSid) || value(raw.sid);
  if (!callId)
    return NextResponse.json(
      { error: 'Call reference is missing.' },
      { status: 400 },
    );
  const status = normalizeStatus(value(raw.Status) || value(raw.status));
  const duration = numberValue(raw.ConversationDuration ?? raw.duration);
  const recordingUrl = value(raw.RecordingUrl) || value(raw.recording_url);
  const db = getRawDb();
  const call = await db
    .prepare(
      'SELECT id, organization_id, cost_credits FROM call_records WHERE id = ?',
    )
    .bind(callId)
    .first<{ id: string; organization_id: string; cost_credits: number }>();
  if (!call)
    return NextResponse.json({ error: 'Call is unknown.' }, { status: 404 });
  let recordingKey: string | null = null;
  let recordingStatus = recordingUrl
    ? 'remote_available'
    : status === 'completed'
      ? 'not_available'
      : 'pending';
  if (recordingUrl?.startsWith('https://')) {
    try {
      const recording = await fetch(recordingUrl, {
        signal: AbortSignal.timeout(20_000),
      });
      if (recording.ok) {
        // The key is derived inside the module from the tenant and the call;
        // this route no longer gets to choose where the audio lands.
        const stored = await storeRecording(
          { organizationId: call.organization_id, callId: call.id },
          recording,
        );
        if (stored.stored) {
          recordingKey = stored.key;
          recordingStatus = 'stored';
        }
      }
    } catch {
      recordingStatus = 'remote_available';
    }
  }
  const credits =
    status === 'completed' && Number(call.cost_credits || 0) === 0
      ? exotelCredits(duration)
      : 0;
  const settled = credits > 0 ? await settleExotel(db, call.organization_id, call.id, credits) : false;
  await db
    .prepare(`UPDATE call_records SET status = ?, duration_seconds = CASE WHEN ? > 0 THEN ? ELSE duration_seconds END,
      recording_status = ?, recording_storage_key = coalesce(?, recording_storage_key),
      recording_url = coalesce(?, recording_url),
      analysis_json = json_set(analysis_json, '$.providerReference', ?),
      ended_at = CASE WHEN ? IN ('completed','failed','busy','no_answer') THEN CURRENT_TIMESTAMP ELSE ended_at END
      WHERE id = ?`)
    .bind(
      status,
      duration,
      duration,
      recordingStatus,
      recordingKey,
      recordingUrl,
      providerReference,
      status,
      call.id,
    )
    .run();
  const statements = [
    db
      .prepare(`INSERT INTO provider_usage_events
      (id, organization_id, provider_id, category, operation, units, provider_cost_micros,
       billed_credits, status, reference_id)
      VALUES (?, ?, 'provider_telephony', 'telephony', 'call_status', ?, 0, ?, 'success', ?)`)
      .bind(
        `usage_${crypto.randomUUID()}`,
        call.organization_id,
        Math.max(1, duration),
        settled ? credits : 0,
        providerReference || call.id,
      ),
  ];
  await db.batch(statements);
  return NextResponse.json({ received: true, callId, status });
}

function value(input: unknown) {
  return typeof input === 'string' && input.trim() ? input.trim() : null;
}
function numberValue(input: unknown) {
  const number = Number(input);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}
function normalizeStatus(input: string | null) {
  const value = (input || '').toLowerCase().replaceAll(' ', '_');
  if (
    [
      'completed',
      'failed',
      'busy',
      'no_answer',
      'in_progress',
      'queued',
      'ringing',
    ].includes(value)
  )
    return value;
  return 'processing';
}
