import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { assertCanPlaceRealCall } from '@/lib/onboarding-service';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import { startOutboundCall, startVobizCall } from '@/lib/provider-adapters';
import { chooseCarrier } from '@/lib/carrier-router';
import { enforceRateLimit } from '@/lib/rate-limit';
import { sha256 } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  // Placing an outbound call spends credits and rings a person.
  const auth = await requireCustomerPermission(request, 'campaigns.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const body = (await request.json()) as {
    agentId?: string;
    leadId?: string;
    campaignId?: string;
    to?: string;
    consentRecordId?: string;
  };
  const organizationId = auth.session.organizationId!;
  const callLimit = await enforceRateLimit({
    namespace: 'call-start',
    identifier: organizationId,
    limit: 30,
    windowSeconds: 60,
  });
  if (!callLimit.allowed)
    return NextResponse.json(
      { error: 'Call start rate limit reached. Try again shortly.' },
      { status: 429 },
    );
  const phone = body.to?.trim().replaceAll(' ', '') || '';
  if (!/^\+[1-9]\d{7,14}$/.test(phone) || !body.agentId) {
    return NextResponse.json(
      { error: 'Agent and E.164 destination are required.' },
      { status: 400 },
    );
  }
  const db = getRawDb();
  const [agent, wallet, consent, suppressed, settings] = await Promise.all([
    db
      .prepare(
        `SELECT id, name FROM voice_agents WHERE id = ? AND organization_id = ? AND status = 'active'`,
      )
      .bind(body.agentId, organizationId)
      .first<{ id: string; name: string }>(),
    db
      .prepare(
        'SELECT balance FROM organization_wallets WHERE organization_id = ?',
      )
      .bind(organizationId)
      .first<{ balance: number }>(),
    db
      .prepare(`SELECT id FROM consent_records WHERE id = ? AND organization_id = ? AND phone = ?
      AND status = 'granted' AND (expires_at IS NULL OR expires_at > ?)`)
      .bind(
        body.consentRecordId || '',
        organizationId,
        phone,
        new Date().toISOString(),
      )
      .first(),
    db
      .prepare(`SELECT id FROM suppression_entries WHERE phone_hash = ? AND (organization_id = ? OR scope = 'global')
      AND (expires_at IS NULL OR expires_at > ?)`)
      .bind(await sha256(phone), organizationId, new Date().toISOString())
      .first(),
    db
      .prepare(`SELECT recording_policy, recording_retention_days FROM organization_settings
      WHERE organization_id = ? LIMIT 1`)
      .bind(organizationId)
      .first<{ recording_policy: string; recording_retention_days: number }>(),
  ]);
  if (!agent)
    return NextResponse.json(
      { error: 'Active agent was not found.' },
      { status: 404 },
    );
  // §3: no free production plan. The playground is open to a new workspace;
  // dialling a real person is not, until setup is finished and paid for.
  const gate = await assertCanPlaceRealCall(organizationId);
  if (!gate.allowed)
    return NextResponse.json(
      { error: gate.reason, blockers: gate.blockers, onboarding: 'incomplete' },
      { status: 402 },
    );
  if (!wallet || wallet.balance < 10)
    return NextResponse.json(
      { error: 'At least 10 credits are required to start a call.' },
      { status: 402 },
    );
  if (!consent)
    return NextResponse.json(
      { error: 'A valid outbound calling consent record is required.' },
      { status: 409 },
    );
  if (suppressed)
    return NextResponse.json(
      { error: 'This contact is on the suppression list.' },
      { status: 409 },
    );
  const recordCall = settings?.recording_policy !== 'disabled';
  const streamUrl = process.env.VOICE_STREAM_URL || '';
  if (!streamUrl.startsWith('wss://'))
    return NextResponse.json(
      {
        error:
          'Voice media gateway is not configured by the platform operator.',
      },
      { status: 503 },
    );
  // Exotel is handed the stream URL when the call is dialled; Vobiz asks for it
  // when the call is answered, and is told here which number to call from
  // because it will only send one the sub-account owns.
  const carrier = await chooseCarrier(db, organizationId);
  const callId = `call_${crypto.randomUUID()}`;
  await db
    .prepare(`INSERT INTO call_records
    (id, organization_id, agent_id, lead_id, campaign_id, direction, from_number, to_number,
     status, outcome, recording_status, started_at, analysis_json)
    VALUES (?, ?, ?, ?, ?, 'outbound', ?, ?, 'queued', 'unknown', ?, ?, ?)`)
    .bind(
      callId,
      organizationId,
      agent.id,
      body.leadId || null,
      body.campaignId || null,
      // Known in advance on Vobiz, because the number is one Vaani assigned. On
      // Exotel the caller id lives in the customer's own integration and is
      // only learned from the callback.
      carrier.fromNumber ?? 'pending_assignment',
      phone,
      recordCall ? 'pending' : 'not_available',
      new Date().toISOString(),
      JSON.stringify({
        consentRecordId: body.consentRecordId,
        recordingPolicy: settings?.recording_policy || 'record_with_consent',
        recordingRetentionDays: settings?.recording_retention_days || 90,
      }),
    )
    .run();
  try {
    const result =
      carrier.carrier === 'vobiz'
        ? await startVobizCall({
            organizationId,
            callId,
            fromNumber: carrier.fromNumber,
            destination: phone,
          })
        : await startOutboundCall({
            organizationId,
            callId,
            destination: phone,
            streamUrl,
            recordCall,
          });
    await db
      // The column as well as the blob. `provider_reference` is what the
      // inbound webhook looks a call up by; only inbound rows have ever
      // carried it, so a carrier callback that names its own call id and
      // nothing of ours could not find an outbound call at all.
      .prepare(`UPDATE call_records SET status = ?, provider_reference = ?,
        analysis_json = json_set(analysis_json, '$.providerReference', ?)
      WHERE id = ?`)
      .bind(
        result.status,
        result.providerReference,
        result.providerReference,
        callId,
      )
      .run();
    return NextResponse.json(
      {
        id: callId,
        status: result.status,
        providerReference: result.providerReference,
      },
      { status: 201 },
    );
  } catch (error) {
    await db
      .prepare(
        `UPDATE call_records SET status = 'failed', disconnect_reason = ?, ended_at = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .bind(
        error instanceof Error
          ? error.message.slice(0, 300)
          : 'Provider start failed',
        callId,
      )
      .run();
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Call could not be started.',
        callId,
      },
      { status: 409 },
    );
  }
}
