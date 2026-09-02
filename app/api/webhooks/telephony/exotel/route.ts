import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { storeRecording } from '@/lib/recording-storage';

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
        const stored = await storeRecording(
          `${call.organization_id}/${call.id}.wav`,
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
      ? Math.max(10, Math.ceil(Math.max(1, duration) / 60) * 10)
      : 0;
  const callUpdate = await db
    .prepare(`UPDATE call_records SET status = ?, duration_seconds = CASE WHEN ? > 0 THEN ? ELSE duration_seconds END,
      recording_status = ?, recording_storage_key = coalesce(?, recording_storage_key),
      recording_url = coalesce(?, recording_url), cost_credits = CASE WHEN ? > 0 THEN ? ELSE cost_credits END,
      analysis_json = json_set(analysis_json, '$.providerReference', ?),
      ended_at = CASE WHEN ? IN ('completed','failed','busy','no_answer') THEN CURRENT_TIMESTAMP ELSE ended_at END
      WHERE id = ? AND (? = 0 OR cost_credits = 0)`)
    .bind(
      status,
      duration,
      duration,
      recordingStatus,
      recordingKey,
      recordingUrl,
      credits,
      credits,
      providerReference,
      status,
      call.id,
      credits,
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
        callUpdate.meta.changes ? credits : 0,
        providerReference || call.id,
      ),
  ];
  if (credits > 0 && callUpdate.meta.changes) {
    const wallet = await db
      .prepare(
        'SELECT balance FROM organization_wallets WHERE organization_id = ?',
      )
      .bind(call.organization_id)
      .first<{ balance: number }>();
    const after = Math.max(0, Number(wallet?.balance || 0) - credits);
    statements.push(
      db
        .prepare(
          'UPDATE organization_wallets SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE organization_id = ?',
        )
        .bind(after, call.organization_id),
      db
        .prepare(`INSERT INTO credit_ledger (id, organization_id, type, amount, balance_after, reference_type, reference_id, description)
        VALUES (?, ?, 'usage', ?, ?, 'call', ?, 'Live calling usage')`)
        .bind(
          `credit_${crypto.randomUUID()}`,
          call.organization_id,
          -credits,
          after,
          call.id,
        ),
    );
  }
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
