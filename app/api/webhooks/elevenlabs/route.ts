import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { verifyElevenLabsSignature } from '@/lib/elevenlabs-webhook';
import { platformProviderSecret } from '@/lib/provider-adapters';

export const dynamic = 'force-dynamic';

/**
 * ElevenLabs webhook receiver.
 *
 * Two of the events matter to Vaani:
 *
 * - **voice removal notice** — a voice scheduled for removal. Any voice profile
 *   bound to it will stop synthesising when it disappears, so this must reach
 *   the workspace before the agent goes silent, not after.
 * - **transcription completed** — the async speech-to-text result. Vaani's live
 *   path is synchronous, so this is stored and attached to a call when the
 *   transcription request carried one.
 *
 * Anything else is recorded as unsupported rather than silently dropped.
 */

async function webhookSecret() {
  if (process.env.ELEVENLABS_WEBHOOK_SECRET)
    return process.env.ELEVENLABS_WEBHOOK_SECRET;
  // Also readable from the admin panel's stored ElevenLabs config.
  const stored = await platformProviderSecret('elevenlabs');
  const value = (stored.config as { webhookSecret?: unknown }).webhookSecret;
  return typeof value === 'string' && value ? value : null;
}

export async function POST(request: Request) {
  const secret = await webhookSecret();
  if (!secret)
    return NextResponse.json(
      {
        error:
          'ElevenLabs webhooks are not configured. Save the shared secret as ELEVENLABS_WEBHOOK_SECRET, or as webhookSecret in the admin ElevenLabs config, before adding this endpoint in ElevenLabs.',
      },
      { status: 503 },
    );

  const rawBody = await request.text();
  const verdict = await verifyElevenLabsSignature(
    request.headers.get('elevenlabs-signature'),
    rawBody,
    secret,
  );
  if (!verdict.ok)
    return NextResponse.json(
      { error: 'Invalid ElevenLabs signature.', reason: verdict.reason },
      { status: 401 },
    );

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  await ensureSchema();
  const db = getRawDb();
  const eventType =
    typeof payload.type === 'string'
      ? payload.type
      : typeof payload.event === 'string'
        ? payload.event
        : 'unknown';
  const eventId =
    typeof payload.event_id === 'string'
      ? payload.event_id
      : typeof payload.request_id === 'string'
        ? payload.request_id
        : `${eventType}:${await digestOf(rawBody)}`;

  // Redelivery must not re-run the side effects.
  const seen = await db
    .prepare(
      `SELECT id, status, detail FROM provider_webhook_events
       WHERE provider = 'elevenlabs' AND event_id = ? LIMIT 1`,
    )
    .bind(eventId)
    .first<{ id: string; status: string; detail: string | null }>();
  if (seen)
    return NextResponse.json({
      received: true,
      duplicate: true,
      status: seen.status,
      detail: seen.detail,
    });

  const data = (payload.data ?? payload) as Record<string, unknown>;
  let status = 'ignored_unsupported';
  let detail = `Vaani does not act on ${eventType}.`;
  let organizationId: string | null = null;

  if (/voice.*(removal|removed|deleted)/i.test(eventType)) {
    const outcome = await handleVoiceRemoval(data);
    status = outcome.status;
    detail = outcome.detail;
  } else if (/transcription|speech_to_text/i.test(eventType)) {
    const outcome = await handleTranscription(data);
    status = outcome.status;
    detail = outcome.detail;
    organizationId = outcome.organizationId;
  }

  await db
    .prepare(`INSERT INTO provider_webhook_events
      (id, provider, event_id, event_type, organization_id, status, detail, payload_json)
      VALUES (?, 'elevenlabs', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, event_id) DO NOTHING`)
    .bind(
      `phe_${crypto.randomUUID()}`,
      eventId,
      eventType,
      organizationId,
      status,
      detail.slice(0, 500),
      rawBody.slice(0, 20_000),
    )
    .run();

  return NextResponse.json({ received: true, eventType, status, detail });
}

async function digestOf(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest).slice(0, 12), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/**
 * Flags every voice profile bound to the removed voice and tells the owner.
 * Without this the first symptom is an agent that cannot speak.
 */
async function handleVoiceRemoval(data: Record<string, unknown>) {
  const db = getRawDb();
  const voiceId =
    typeof data.voice_id === 'string'
      ? data.voice_id
      : typeof data.voiceId === 'string'
        ? data.voiceId
        : '';
  if (!voiceId)
    return { status: 'ignored_no_voice_id', detail: 'No voice id in payload.' };
  const reason =
    typeof data.reason === 'string'
      ? data.reason
      : 'The provider scheduled this voice for removal.';

  const affected = await db
    .prepare(`SELECT p.id, p.organization_id, p.name,
        (SELECT count(*) FROM voice_agents a WHERE a.voice_profile_id = p.id) AS agents
      FROM voice_profiles p WHERE p.provider_voice_id = ?`)
    .bind(voiceId)
    .all<{
      id: string;
      organization_id: string;
      name: string;
      agents: number;
    }>();
  const rows = affected.results ?? [];
  if (!rows.length)
    return {
      status: 'no_profiles_affected',
      detail: `No voice profile uses ${voiceId}.`,
    };

  await db
    .prepare(`UPDATE voice_profiles
      SET removal_notice_at = CURRENT_TIMESTAMP, removal_reason = ?
      WHERE provider_voice_id = ?`)
    .bind(reason.slice(0, 300), voiceId)
    .run();

  for (const row of rows) {
    const owner = await db
      .prepare(`SELECT u.email FROM organization_members m
        INNER JOIN app_users u ON u.id = m.user_id
        WHERE m.organization_id = ? ORDER BY m.created_at LIMIT 1`)
      .bind(row.organization_id)
      .first<{ email: string }>();
    if (!owner?.email) continue;
    await db
      .prepare(`INSERT INTO outbound_messages
        (id, organization_id, channel, destination, template_name, message_body, status)
        VALUES (?, ?, 'email', ?, 'vaani_voice_removal', ?, 'queued')`)
      .bind(
        `msg_${crypto.randomUUID()}`,
        row.organization_id,
        owner.email,
        `The voice behind your profile "${row.name}" (${voiceId}) is scheduled for removal by the provider. ${row.agents} agent(s) use it and will stop speaking once it is gone. Pick a replacement voice in Voice profiles. Reason: ${reason}`.slice(
          0,
          900,
        ),
      )
      .run();
  }
  return {
    status: 'profiles_flagged',
    detail: `Flagged ${rows.length} voice profile(s) using ${voiceId} and notified their owners.`,
  };
}

/**
 * Stores an async transcription. Vaani's live speech-to-text is synchronous, so
 * this fires only for transcriptions dispatched with a webhook — long
 * recordings, or a backfill. When the request carried a call id the text is
 * attached to that call.
 */
async function handleTranscription(data: Record<string, unknown>) {
  const db = getRawDb();
  const text =
    typeof data.text === 'string'
      ? data.text
      : typeof data.transcript === 'string'
        ? data.transcript
        : '';
  const language =
    typeof data.language_code === 'string' ? data.language_code : null;
  // ElevenLabs echoes whatever was passed as the transcription's metadata.
  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  const callId =
    typeof metadata.call_id === 'string'
      ? metadata.call_id
      : typeof data.call_id === 'string'
        ? data.call_id
        : '';
  if (!text)
    return {
      status: 'ignored_empty_transcript',
      detail: 'The transcription carried no text.',
      organizationId: null,
    };
  if (!callId)
    return {
      status: 'stored_unlinked',
      detail:
        'Transcript stored, but the request carried no call_id metadata so it could not be attached to a call.',
      organizationId: null,
    };
  const call = await db
    .prepare(
      `SELECT id, organization_id FROM call_records WHERE id = ? LIMIT 1`,
    )
    .bind(callId)
    .first<{ id: string; organization_id: string }>();
  if (!call)
    return {
      status: 'stored_unknown_call',
      detail: `Transcript stored, but call ${callId} does not exist.`,
      organizationId: null,
    };
  await db
    .prepare(`INSERT INTO transcripts
      (id, organization_id, call_id, language, source, turn_count, full_text)
      VALUES (?, ?, ?, ?, 'stt', 0, ?)
      ON CONFLICT(call_id) DO UPDATE SET full_text = excluded.full_text,
        language = coalesce(excluded.language, transcripts.language),
        source = 'stt', updated_at = CURRENT_TIMESTAMP`)
    .bind(
      `transcript_${crypto.randomUUID()}`,
      call.organization_id,
      call.id,
      language,
      text.slice(0, 100_000),
    )
    .run();
  return {
    status: 'transcript_attached',
    detail: `Attached ${text.length} characters to call ${call.id}.`,
    organizationId: call.organization_id,
  };
}
