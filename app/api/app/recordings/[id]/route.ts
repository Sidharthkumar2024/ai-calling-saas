import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import { recordAudit } from '@/lib/demo-seed';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getRecording } from '@/lib/recording-storage';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  // Call recordings are monitoring data: gate on calls.monitor, rate-limit the
  // endpoint and leave an audit trail of who listened to what.
  const auth = await requireCustomerPermission(request, 'calls.monitor');
  if (auth.response) return auth.response;
  const limit = await enforceRateLimit({
    namespace: 'recording-playback',
    identifier: auth.session.userId,
    limit: 60,
    windowSeconds: 60,
  });
  if (!limit.allowed)
    return NextResponse.json(
      { error: 'Recording playback rate limit reached.' },
      { status: 429 },
    );
  const { id } = await context.params;
  const call = await getRawDb()
    .prepare(`SELECT id, recording_status, recording_storage_key, recording_url FROM call_records
    WHERE id = ? AND organization_id = ? LIMIT 1`)
    .bind(id, auth.session.organizationId)
    .first<{
      id: string;
      recording_status: string;
      recording_storage_key: string | null;
      recording_url: string | null;
    }>();
  if (!call || call.recording_status === 'not_available')
    return NextResponse.json(
      { error: 'Recording not available.' },
      { status: 404 },
    );
  await recordAudit(auth.session, 'recording.played', 'call_record', call.id, {
    recordingStatus: call.recording_status,
  });
  if (call.recording_storage_key) {
    const object = await getRecording(call.recording_storage_key);
    if (object?.body) {
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag);
      headers.set('cache-control', 'private, max-age=300');
      headers.set('content-disposition', `inline; filename="${id}.wav"`);
      return new NextResponse(object.body, { headers });
    }
  }
  if (call.recording_url?.startsWith('https://')) {
    const remote = await fetch(call.recording_url, {
      signal: AbortSignal.timeout(20_000),
    });
    if (remote.ok)
      return new NextResponse(remote.body, {
        headers: {
          'content-type': remote.headers.get('content-type') || 'audio/wav',
          'cache-control': 'private, max-age=120',
        },
      });
  }
  // No fabricated audio: a 220 Hz demo tone used to be returned for every call
  // whose media was never stored, which sounded like a real (silent) recording.
  return NextResponse.json(
    {
      error: 'Recording is not available for this call.',
      reason: call.recording_storage_key
        ? 'stored_object_missing'
        : 'never_captured',
      recordingStatus: call.recording_status,
    },
    { status: 404 },
  );
}
