import { getRawDb } from '@/db/index';
import { enqueueJob } from '@/lib/job-enqueue';

/**
 * Call telemetry writer (§11-12).
 *
 * Conversation content previously existed only as three seeded
 * `call_records.transcript_json` blobs, so every real conversation showed up in
 * call history as "Unknown / — / —ms". Both the telephony path and the
 * playground now write the same tables, and the `channel` column keeps a
 * playground conversation from being presented as a phone call.
 */

export type TurnRole = 'agent' | 'customer' | 'system';

/** Opens (or reuses) the call record a playground session reports into. */
export async function ensurePlaygroundCallRecord(input: {
  organizationId: string;
  agentId: string;
  sessionId: string;
  agentName: string;
  language: string;
}) {
  const db = getRawDb();
  const callId = `call_${input.sessionId}`;
  const existing = await db
    .prepare(`SELECT id FROM call_records WHERE id = ? LIMIT 1`)
    .bind(callId)
    .first<{ id: string }>();
  if (existing) return callId;

  await db
    .prepare(`INSERT INTO call_records
      (id, organization_id, agent_id, direction, channel, from_number, to_number,
       customer_name, status, outcome, recording_status, started_at, analysis_json)
      VALUES (?, ?, ?, 'inbound', 'playground', 'playground', 'playground',
       NULL, 'in_progress', 'in_progress', 'not_available', ?, '{}')`)
    .bind(
      callId,
      input.organizationId,
      input.agentId,
      new Date().toISOString(),
    )
    .run();
  await db
    .prepare(`INSERT INTO call_participants
      (id, organization_id, call_id, participant_type, reference_id, display_name)
      VALUES (?, ?, ?, 'ai_agent', ?, ?)`)
    .bind(
      `participant_${crypto.randomUUID()}`,
      input.organizationId,
      callId,
      input.agentId,
      input.agentName,
    )
    .run();
  await db
    .prepare(`INSERT INTO recordings
      (id, organization_id, call_id, status, format)
      VALUES (?, ?, ?, 'not_available', NULL)`)
    .bind(`recording_${crypto.randomUUID()}`, input.organizationId, callId)
    .run();
  return callId;
}

/** Appends one turn and refreshes the call's transcript. */
export async function recordCallTurn(input: {
  organizationId: string;
  callId: string;
  role: TurnRole;
  content: string;
  language?: string | null;
  latencyMs?: number | null;
  model?: string | null;
  toolCalls?: unknown[];
}) {
  const db = getRawDb();
  const next = await db
    .prepare(
      `SELECT coalesce(max(turn_index), -1) + 1 AS turn_index FROM call_turns WHERE call_id = ?`,
    )
    .bind(input.callId)
    .first<{ turn_index: number }>();
  const turnIndex = Number(next?.turn_index ?? 0);
  await db
    .prepare(`INSERT OR IGNORE INTO call_turns
      (id, organization_id, call_id, turn_index, role, content, language, latency_ms, model, tool_calls_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      `turn_${crypto.randomUUID()}`,
      input.organizationId,
      input.callId,
      turnIndex,
      input.role,
      input.content,
      input.language ?? null,
      input.latencyMs ?? null,
      input.model ?? null,
      JSON.stringify(input.toolCalls ?? []),
    )
    .run();
  await refreshTranscript(input.organizationId, input.callId, input.language);
  return turnIndex;
}

/** Rebuilds the readable transcript from the stored turns. */
export async function refreshTranscript(
  organizationId: string,
  callId: string,
  language?: string | null,
) {
  const db = getRawDb();
  const turns = await db
    .prepare(
      `SELECT role, content FROM call_turns WHERE call_id = ? ORDER BY turn_index`,
    )
    .bind(callId)
    .all<{ role: string; content: string }>();
  const rows = turns.results ?? [];
  const fullText = rows
    .map((turn) => `${turn.role === 'customer' ? 'Customer' : 'Agent'}: ${turn.content}`)
    .join('\n');
  await db
    .prepare(`INSERT INTO transcripts
      (id, organization_id, call_id, language, source, turn_count, full_text)
      VALUES (?, ?, ?, ?, 'playground', ?, ?)
      ON CONFLICT(call_id) DO UPDATE SET turn_count = excluded.turn_count,
        full_text = excluded.full_text,
        language = coalesce(excluded.language, transcripts.language),
        updated_at = CURRENT_TIMESTAMP`)
    .bind(
      `transcript_${crypto.randomUUID()}`,
      organizationId,
      callId,
      language ?? null,
      rows.length,
      fullText,
    )
    .run();
  return rows.length;
}

/**
 * Closes a conversation and queues intelligence. Idempotent: a call already
 * marked completed is not re-queued, so a double "end" costs nothing.
 */
export async function completeCall(input: {
  organizationId: string;
  callId: string;
  outcome?: string;
  disconnectReason?: string;
}) {
  const db = getRawDb();
  const call = await db
    .prepare(
      `SELECT id, status, started_at, intelligence_status FROM call_records
       WHERE id = ? AND organization_id = ? LIMIT 1`,
    )
    .bind(input.callId, input.organizationId)
    .first<{
      id: string;
      status: string;
      started_at: string;
      intelligence_status: string | null;
    }>();
  if (!call) return { completed: false, queued: false };
  if (call.status === 'completed' && call.intelligence_status) {
    return { completed: true, queued: false };
  }

  const latency = await db
    .prepare(
      `SELECT coalesce(avg(latency_ms), 0) AS average FROM call_turns
       WHERE call_id = ? AND role = 'agent' AND latency_ms IS NOT NULL`,
    )
    .bind(input.callId)
    .first<{ average: number }>();
  const startedMs = Date.parse(call.started_at);
  const durationSeconds = Number.isNaN(startedMs)
    ? 0
    : Math.max(0, Math.round((Date.now() - startedMs) / 1000));

  await db
    .prepare(`UPDATE call_records SET status = 'completed', outcome = ?,
      duration_seconds = ?, latency_ms = ?, disconnect_reason = ?,
      intelligence_status = 'queued', ended_at = CURRENT_TIMESTAMP
      WHERE id = ?`)
    .bind(
      input.outcome || 'completed',
      durationSeconds,
      Math.round(Number(latency?.average ?? 0)) || null,
      input.disconnectReason || null,
      input.callId,
    )
    .run();
  await db
    .prepare(
      `UPDATE call_participants SET left_at = CURRENT_TIMESTAMP WHERE call_id = ? AND left_at IS NULL`,
    )
    .bind(input.callId)
    .run();
  await enqueueJob({
    organizationId: input.organizationId,
    type: 'call.intelligence',
    idempotencyKey: `call_intelligence:${input.callId}`,
    payload: { callId: input.callId },
    priority: 50,
  });
  return { completed: true, queued: true, durationSeconds };
}

/**
 * Ends playground conversations the user simply walked away from, so their
 * telemetry is not stuck "in progress" forever.
 */
export async function closeIdlePlaygroundCalls(
  organizationId: string,
  idleMinutes = 15,
) {
  const db = getRawDb();
  const stale = await db
    .prepare(`SELECT c.id FROM call_records c
      WHERE c.organization_id = ? AND c.channel = 'playground'
        AND c.status = 'in_progress'
        AND (
          SELECT coalesce(max(t.created_at), c.started_at) FROM call_turns t WHERE t.call_id = c.id
        ) <= datetime('now', ?)
      LIMIT 50`)
    .bind(organizationId, `-${idleMinutes} minutes`)
    .all<{ id: string }>();
  let closed = 0;
  for (const row of stale.results ?? []) {
    const result = await completeCall({
      organizationId,
      callId: row.id,
      outcome: 'abandoned',
      disconnectReason: 'idle_timeout',
    });
    if (result.completed) closed += 1;
  }
  return closed;
}
