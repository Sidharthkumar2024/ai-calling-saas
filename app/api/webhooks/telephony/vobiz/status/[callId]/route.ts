import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { exotelCredits, settleExotel } from '@/lib/exotel-settlement';
import { settleCampaignContactForCall } from '@/lib/campaign-settlement';
import {
  isTerminalCallStatus,
  normaliseCallStatus,
  TERMINAL_SQL_LIST,
} from '@/lib/telephony-status';
import { vobizWorkspaceCredentials } from '@/lib/provider-adapters';
import {
  readVobizCallback,
  verifyVobizSignature,
  vobizPublicCallbackUrl,
} from '@/lib/vobiz';

export const dynamic = 'force-dynamic';

/**
 * Ring and hangup callbacks from Vobiz.
 *
 * Both of their call callbacks land here, told apart by what they carry rather
 * than by which URL they arrived on, because both are configured per call and
 * their platform retries each one three times on any non-200. So this handler
 * has to be idempotent by construction: it coalesces, it never walks a
 * finished call backwards, and it settles credits once.
 *
 * **What the signature proves, and what it does not.** It is an HMAC over the
 * callback URL and a nonce — never the body. So a verified request means "the
 * holder of this workspace's token addressed this call's URL", and every field
 * in the body is still a claim. The call is therefore looked up by the id in
 * the *path*, and the body is only allowed to fill in facts about that call.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ callId: string }> },
) {
  await ensureSchema();
  const { callId } = await context.params;
  const db = getRawDb();
  const call = await db
    .prepare(
      'SELECT id, organization_id, cost_credits FROM call_records WHERE id = ? LIMIT 1',
    )
    .bind(callId)
    .first<{ id: string; organization_id: string; cost_credits: number }>();
  if (!call)
    return NextResponse.json({ error: 'Call is unknown.' }, { status: 404 });

  const { authToken } = await vobizWorkspaceCredentials(call.organization_id);
  const publicCallbackUrl = vobizPublicCallbackUrl(
    request.url,
    process.env.PUBLIC_BASE_URL,
  );
  const signature = await verifyVobizSignature({
    url: request.url,
    alternateUrls: publicCallbackUrl ? [publicCallbackUrl] : [],
    headers: request.headers,
    authToken,
  });
  if (!signature.ok)
    return NextResponse.json(
      { error: 'Webhook authentication failed.' },
      { status: 401 },
    );

  const contentType = request.headers.get('content-type') || '';
  const raw = contentType.includes('application/json')
    ? ((await request.json().catch(() => ({}))) as Record<string, unknown>)
    : (Object.fromEntries((await request.formData()).entries()) as Record<
        string,
        unknown
      >);
  const callback = readVobizCallback(raw);
  if (!callback)
    return NextResponse.json(
      { error: 'No call reference in the callback.' },
      { status: 400 },
    );
  const status = normaliseCallStatus(callback.status);
  const duration = callback.talkSeconds ?? 0;
  const terminal = callback.endedAt !== null;

  // Credits are settled once, on the first callback that carries talk time.
  // `cost_credits` being zero is what says it has not happened yet, which is
  // the same test the Exotel leg makes — deliberately, so a workspace on either
  // carrier is billed by one rule.
  const credits =
    terminal && duration > 0 && Number(call.cost_credits || 0) === 0
      ? exotelCredits(duration)
      : 0;
  const settled =
    credits > 0
      ? await settleExotel(db, call.organization_id, call.id, credits)
      : false;

  await db
    .prepare(`UPDATE call_records SET
      status = CASE WHEN status IN (${TERMINAL_SQL_LIST}) AND ? NOT IN (${TERMINAL_SQL_LIST})
        THEN status ELSE ? END,
      duration_seconds = CASE WHEN ? > 0 THEN ? ELSE duration_seconds END,
      analysis_json = json_set(analysis_json, '$.providerReference', ?),
      provider_reference = coalesce(?, provider_reference),
      ended_at = CASE WHEN ? THEN coalesce(ended_at, ?) ELSE ended_at END
      WHERE id = ?`)
    .bind(
      status,
      status,
      duration,
      duration,
      callback.callUuid,
      callback.callUuid,
      terminal ? 1 : 0,
      // Their clock for when the call ended, not ours for when we heard about
      // it: their retries can be minutes late, and a duration that disagrees
      // with its own timestamps is the kind of thing a customer disputes.
      callback.endedAt ?? new Date().toISOString(),
      call.id,
    )
    .run();

  if (isTerminalCallStatus(status))
    await settleCampaignContactForCall(db, {
      callId: call.id,
      status,
      now: new Date(),
    });

  await db
    .prepare(`INSERT INTO provider_usage_events
      (id, organization_id, provider_id, category, operation, units, provider_cost_micros,
       billed_credits, status, reference_id)
      VALUES (?, ?, 'provider_telephony', 'telephony', 'call_status', ?, 0, ?, 'success', ?)`)
    .bind(
      `usage_${crypto.randomUUID()}`,
      call.organization_id,
      Math.max(1, duration),
      settled ? credits : 0,
      callback.callUuid,
    )
    .run();

  return NextResponse.json({ received: true, callId: call.id, status });
}
