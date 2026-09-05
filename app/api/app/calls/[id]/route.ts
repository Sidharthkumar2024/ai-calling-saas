import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { requireCustomerPermission } from '@/lib/customer-rbac';

export const dynamic = 'force-dynamic';

/**
 * Call detail: the transcript, post-call intelligence, participants and tool
 * timeline for one conversation. These columns exist on `call_records` but the
 * list endpoint deliberately omits them, and until now nothing rendered them.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireCustomerPermission(request, 'calls.monitor');
  if (auth.response) return auth.response;
  const { id } = await context.params;
  const db = getRawDb();
  const organizationId = auth.session.organizationId;

  const call = await db
    .prepare(`SELECT c.id, c.agent_id, c.direction, c.channel, c.from_number, c.to_number,
      c.customer_name, c.status, c.outcome, c.duration_seconds, c.latency_ms,
      c.sentiment, c.summary, c.recording_status, c.recording_storage_key,
      c.cost_credits,
      c.disconnect_reason, c.intelligence_status, c.started_at, c.ended_at,
      a.name AS agent_name
    FROM call_records c LEFT JOIN voice_agents a ON a.id = c.agent_id
    WHERE c.id = ? AND c.organization_id = ? LIMIT 1`)
    .bind(id, organizationId)
    .first();
  if (!call)
    return NextResponse.json({ error: 'Call not found.' }, { status: 404 });

  const [turns, transcript, summary, participants, review, transport] =
    await Promise.all([
      db
        .prepare(`SELECT turn_index, role, content, language, latency_ms, model,
          tool_calls_json, created_at FROM call_turns
        WHERE call_id = ? ORDER BY turn_index`)
        .bind(id)
        .all(),
      db
        .prepare(
          `SELECT language, source, turn_count, full_text, updated_at FROM transcripts WHERE call_id = ? LIMIT 1`,
        )
        .bind(id)
        .first(),
      db
        .prepare(`SELECT summary, intent, sentiment, outcome, objections_json,
          next_action, model, created_at FROM summaries WHERE call_id = ? LIMIT 1`)
        .bind(id)
        .first(),
      db
        .prepare(`SELECT participant_type, display_name, joined_at, left_at
          FROM call_participants WHERE call_id = ? ORDER BY joined_at`)
        .bind(id)
        .all(),
      db
        .prepare(`SELECT overall_score, resolution_score, knowledge_score,
          naturalness_score, policy_score, hallucination_count, status, findings_json
          FROM call_quality_reviews WHERE call_id = ? ORDER BY created_at DESC LIMIT 1`)
        .bind(id)
        .first(),
      db
        .prepare(`SELECT leg_role, transport, band, score, frames_sent,
          frames_received, send_kbps, receive_kbps, pacing_jitter_ms,
          worst_gap_ms, underruns, longest_silence_ms, socket_rtt_ms, socket_jitter_ms,
          primary_issue, warnings_json
          FROM call_transport_stats WHERE call_id = ? ORDER BY created_at`)
        .bind(id)
        .all(),
    ]);

  return NextResponse.json({
    call,
    turns: turns.results ?? [],
    transcript: transcript ?? null,
    summary: summary ?? null,
    participants: participants.results ?? [],
    qualityReview: review ?? null,
    // Built from the call row rather than from the `recordings` table, which
    // was written once per call with 'not_available' and never touched again —
    // so this panel said "not available" for every call that had audio sitting
    // in storage. `call_records` is what the telephony webhook keeps current.
    recording: {
      status:
        (call as { recording_status?: string }).recording_status ??
        'not_available',
      stored: Boolean(
        (call as { recording_storage_key?: string | null })
          .recording_storage_key,
      ),
      duration_seconds:
        (call as { duration_seconds?: number }).duration_seconds ?? 0,
    },
    transport: transport.results ?? [],
  });
}
