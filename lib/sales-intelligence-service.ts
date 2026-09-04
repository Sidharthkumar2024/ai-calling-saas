import { getRawDb } from '@/db/index';
import {
  buildObjectionLibrary,
  findMergeTarget,
  objectionBriefing,
  objectionKey,
  objectionTokens,
  rescoreLead,
  type CallSignals,
  type ObjectionRow,
  type Rescore,
} from '@/lib/sales-intelligence';

/**
 * Writes the post-call intelligence back where it is useful (§10).
 *
 * `analyseCall` has always produced outcome, sentiment and objections and then
 * written them only to rows nothing acts on. These two functions are the return
 * path: the lead's score changes because of what was said, and the objection
 * joins a library the next call is briefed from.
 */

/**
 * Rescores the lead this call belonged to.
 *
 * Returns null when the call has no lead — playground calls, inbound calls from
 * a number nobody has captured — rather than inventing one, because a lead
 * created here would be a lead with no source and no consent trail.
 */
export async function applyCallToLead(input: {
  organizationId: string;
  callId: string;
  signals: CallSignals;
}): Promise<(Rescore & { leadId: string }) | null> {
  const db = getRawDb();
  const row = await db
    .prepare(
      `SELECT l.id AS leadId, l.score AS score, c.duration_seconds AS durationSeconds
       FROM call_records c
       INNER JOIN leads l ON l.id = c.lead_id
       WHERE c.id = ? AND c.organization_id = ? LIMIT 1`,
    )
    .bind(input.callId, input.organizationId)
    .first<{ leadId: string; score: number; durationSeconds: number }>();
  if (!row?.leadId) return null;

  const turns = await db
    .prepare(`SELECT turn_count FROM transcripts WHERE call_id = ? LIMIT 1`)
    .bind(input.callId)
    .first<{ turn_count: number }>();

  const result = rescoreLead(Number(row.score ?? 0), {
    ...input.signals,
    durationSeconds: Number(row.durationSeconds ?? 0),
    // Roughly half the turns are the customer's; the scorer only needs the
    // order of magnitude, and counting speaker labels out of a joined
    // transcript would be guessing at a format that varies by provider.
    customerTurns: Math.floor(Number(turns?.turn_count ?? 0) / 2),
  });

  await db.batch([
    db
      .prepare(
        `UPDATE leads SET score = ?, status = ?, intent = coalesce(?, intent),
           ai_summary = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND organization_id = ?`,
      )
      .bind(
        result.score,
        result.status,
        input.signals.intent || null,
        result.nextAction,
        row.leadId,
        input.organizationId,
      ),
    // The reasons are stored, not just the number. A score that moved 22 points
    // and cannot say why is a score nobody will trust enough to act on.
    db
      .prepare(
        `INSERT INTO lead_events (id, organization_id, lead_id, event_type, payload_json)
         VALUES (?, ?, ?, 'score_recalculated', ?)`,
      )
      .bind(
        `leadevt_${crypto.randomUUID()}`,
        input.organizationId,
        row.leadId,
        JSON.stringify({
          callId: input.callId,
          previous: result.previous,
          score: result.score,
          delta: result.delta,
          status: result.status,
          reasons: result.reasons,
          nextAction: result.nextAction,
        }),
      ),
  ]);

  return { ...result, leadId: row.leadId };
}

/**
 * Files this call's objections into the workspace library.
 *
 * Counted by canonical key so one objection is one row however it was worded,
 * and the label keeps the most recent phrasing so the list reads like something
 * a customer said.
 */
export async function recordObjections(input: {
  organizationId: string;
  callId: string;
  objections: string[];
}): Promise<{ filed: number; merged: number }> {
  const entries = buildObjectionLibrary(input.objections ?? [], 10);
  if (!entries.length) return { filed: 0, merged: 0 };
  const db = getRawDb();

  // Existing rows are read first so a rephrasing joins the row it belongs to.
  // A model does not word the same objection identically twice, and a library
  // that files each wording separately never accumulates a count.
  const known = await db
    .prepare(
      `SELECT objection_key AS key, label FROM objection_library
       WHERE organization_id = ? AND status != 'dismissed'`,
    )
    .bind(input.organizationId)
    .all<{ key: string; label: string }>();
  const candidates = (known.results ?? []).map((row) => ({
    key: row.key,
    tokens: objectionTokens(row.label || row.key),
  }));

  let merged = 0;
  const statements = entries.map((entry) => {
    const target = findMergeTarget(
      objectionTokens(entry.objection),
      candidates,
    );
    if (target) merged += 1;
    else
      // Registered immediately so two rephrasings inside the same call merge
      // with each other rather than racing to create two rows.
      candidates.push({
        key: entry.key,
        tokens: objectionTokens(entry.objection),
      });
    return db
      .prepare(
        `INSERT INTO objection_library
           (id, organization_id, objection_key, label, occurrences, last_call_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(organization_id, objection_key) DO UPDATE SET
           occurrences = objection_library.occurrences + excluded.occurrences,
           last_call_id = excluded.last_call_id,
           last_heard_at = CURRENT_TIMESTAMP`,
      )
      .bind(
        `objection_${crypto.randomUUID()}`,
        input.organizationId,
        target ?? entry.key,
        entry.objection,
        entry.count,
        input.callId,
      );
  });
  await db.batch(statements);
  return { filed: entries.length, merged };
}

export type LibraryEntry = ObjectionRow & {
  id: string;
  key: string;
  status: string;
  firstHeardAt: string;
  lastHeardAt: string;
};

export async function workspaceObjections(
  organizationId: string,
  limit = 25,
): Promise<LibraryEntry[]> {
  const rows = await getRawDb()
    .prepare(
      `SELECT id, objection_key AS key, label, occurrences, rebuttal, status,
              first_heard_at AS firstHeardAt, last_heard_at AS lastHeardAt
       FROM objection_library
       WHERE organization_id = ? AND status != 'dismissed'
       ORDER BY occurrences DESC, last_heard_at DESC
       LIMIT ?`,
    )
    .bind(organizationId, Math.max(1, Math.min(200, limit)))
    .all<{
      id: string;
      key: string;
      label: string;
      occurrences: number;
      rebuttal: string | null;
      status: string;
      firstHeardAt: string;
      lastHeardAt: string;
    }>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    key: row.key,
    objection: row.label,
    count: Number(row.occurrences ?? 0),
    rebuttal: row.rebuttal,
    status: row.status,
    firstHeardAt: row.firstHeardAt,
    lastHeardAt: row.lastHeardAt,
  }));
}

/**
 * The playbook block for a live call's system prompt.
 *
 * Wrapped so a failure here never takes a call down — the same rule as
 * knowledge retrieval. An agent briefed on nothing is worse than one briefed on
 * the library; a dropped call is worse than both.
 */
export async function objectionPlaybook(
  organizationId: string,
): Promise<string> {
  try {
    const rows = await getRawDb()
      .prepare(
        `SELECT label, occurrences, rebuttal FROM objection_library
         WHERE organization_id = ? AND status = 'open'
           AND (rebuttal IS NOT NULL OR occurrences > 1)
         ORDER BY (rebuttal IS NOT NULL) DESC, occurrences DESC
         LIMIT 6`,
      )
      .bind(organizationId)
      .all<{ label: string; occurrences: number; rebuttal: string | null }>();
    return objectionBriefing(
      (rows.results ?? []).map((row) => ({
        objection: row.label,
        count: Number(row.occurrences ?? 0),
        rebuttal: row.rebuttal,
      })),
    );
  } catch {
    return '';
  }
}

export async function setRebuttal(input: {
  organizationId: string;
  objectionId: string;
  rebuttal: string;
  userId: string;
}) {
  const text = String(input.rebuttal ?? '')
    .trim()
    .slice(0, 1200);
  await getRawDb()
    .prepare(
      `UPDATE objection_library
       SET rebuttal = ?, rebuttal_updated_by = ?, rebuttal_updated_at = CURRENT_TIMESTAMP,
           status = 'open'
       WHERE id = ? AND organization_id = ?`,
    )
    .bind(text || null, input.userId, input.objectionId, input.organizationId)
    .run();
  return { rebuttal: text || null };
}

export async function dismissObjection(input: {
  organizationId: string;
  objectionId: string;
}) {
  await getRawDb()
    .prepare(
      `UPDATE objection_library SET status = 'dismissed'
       WHERE id = ? AND organization_id = ?`,
    )
    .bind(input.objectionId, input.organizationId)
    .run();
  return { dismissed: true };
}

export { objectionKey };
