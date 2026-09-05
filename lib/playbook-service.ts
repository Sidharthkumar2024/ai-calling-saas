/**
 * Mining the workspace's own call history into a playbook (§13.1).
 *
 * §13.1's flow is: connect historical calls → consent and privacy check →
 * transcribe → separate good from bad → extract terminology, objections and
 * successful patterns → build a playbook → **human reviews** → use as
 * retrieval, examples and an evaluation set.
 *
 * Two of those steps are load-bearing and easy to skip.
 *
 * The consent check comes first and can stop the whole thing. A call recorded
 * without consent is not raw material because it happens to be in the
 * database; this reads the workspace's own recording policy and excludes what
 * that policy does not cover, and says how many it excluded.
 *
 * The human review is a gate, not a notification. Entries land as proposals.
 * Nothing reaches a live call until somebody has approved that specific row —
 * which is the whole difference between "the model noticed a pattern" and
 * "the company says this is how we sell".
 */

import { getRawDb } from '@/db/index';
import {
  buildPlaybook,
  type MinedCall,
  type PlaybookEntry,
  playbookHeaderStatus,
} from '@/lib/playbook-mining';

/** How many calls one mining run will read. */
export const MINING_LIMIT = 300;

export type MiningResult = {
  ok: boolean;
  playbookId?: string;
  callsRead: number;
  wonCount: number;
  lostCount: number;
  blocked: string | null;
  excluded: Array<{ outcome: string; count: number; reason: string }>;
  /** Calls left out by the consent check, before any of the above. */
  consentExcluded: number;
  /** Playground tests left out — not customer conversations. */
  playgroundExcluded: number;
  consentNote: string | null;
  entries: number;
  caveat: string;
  reason?: string;
};

/**
 * Reads the workspace's calls and proposes a playbook.
 *
 * The consent filter is applied in SQL rather than after the fact, so a
 * transcript the policy does not cover is never loaded into memory to be
 * counted "just for the totals".
 */
export async function minePlaybook(input: {
  organizationId: string;
  userId: string;
}): Promise<MiningResult> {
  const db = getRawDb();

  const settings = await db
    .prepare(
      `SELECT recording_policy FROM organization_settings WHERE organization_id = ? LIMIT 1`,
    )
    .bind(input.organizationId)
    .first<{ recording_policy: string }>();
  const policy = settings?.recording_policy ?? 'record_with_consent';

  // 'never_record' is a decision, not an obstacle to work around.
  if (policy === 'never_record')
    return {
      ok: false,
      callsRead: 0,
      wonCount: 0,
      lostCount: 0,
      blocked: null,
      excluded: [],
      consentExcluded: 0,
      playgroundExcluded: 0,
      consentNote: null,
      entries: 0,
      caveat: '',
      reason:
        'This workspace’s recording policy is “never record”, so there is nothing here that may be mined. Change the policy first if that is not what you intend.',
    };

  const requiresConsent = policy === 'record_with_consent';
  const consentClause = requiresConsent
    ? `AND EXISTS (
         SELECT 1 FROM consent_records c
         WHERE c.organization_id = t.organization_id
           AND c.status = 'granted'
           AND (c.expires_at IS NULL OR c.expires_at > CURRENT_TIMESTAMP)
           AND replace(replace(replace(c.phone, ' ', ''), '-', ''), '+', '')
               LIKE '%' || substr(replace(replace(replace(
                 -- Which end of the call is the customer depends on who dialled.
                 CASE WHEN r.direction = 'inbound' THEN coalesce(r.from_number, '')
                      ELSE coalesce(r.to_number, '') END,
                 ' ', ''), '-', ''), '+', ''), -10)
       )`
    : '';

  // Playground calls are excluded before anything else. §13.1 is about
  // learning from *company* calls; a playground run is the workspace talking
  // to its own agent to test it. Mining those would build a playbook out of
  // the company's own testing and present it as how its customers behave.
  const realCalls = `AND t.source != 'playground' AND r.channel != 'playground'`;

  const [counts, rows] = await Promise.all([
    db
      .prepare(`SELECT
          count(*) AS total,
          sum(CASE WHEN t.source = 'playground' OR r.channel = 'playground' THEN 1 ELSE 0 END) AS playground
        FROM transcripts t JOIN call_records r ON r.id = t.call_id
        WHERE t.organization_id = ? AND trim(t.full_text) != ''`)
      .bind(input.organizationId)
      .first<{ total: number; playground: number }>(),
    db
      .prepare(`SELECT t.call_id AS id, r.outcome AS outcome, t.full_text AS transcript
        FROM transcripts t JOIN call_records r ON r.id = t.call_id
        WHERE t.organization_id = ? AND trim(t.full_text) != '' ${realCalls} ${consentClause}
        ORDER BY r.started_at DESC LIMIT ?`)
      .bind(input.organizationId, MINING_LIMIT)
      .all<{ id: string; outcome: string | null; transcript: string }>(),
  ]);

  const calls: MinedCall[] = rows.results ?? [];
  const playgroundExcluded = counts?.playground ?? 0;
  const realTotal = Math.max(0, (counts?.total ?? 0) - playgroundExcluded);
  const consentExcluded = Math.max(0, realTotal - calls.length);

  if (calls.length === 0)
    return {
      ok: false,
      callsRead: 0,
      wonCount: 0,
      lostCount: 0,
      blocked: null,
      excluded: [],
      consentExcluded,
      playgroundExcluded,
      consentNote:
        requiresConsent && realTotal > 0
          ? `Your recording policy is “record with consent”, and none of the ${realTotal} real calls here is against a phone number with consent on record.`
          : null,
      entries: 0,
      caveat: '',
      reason:
        realTotal === 0
          ? `There are no company calls to mine yet. ${playgroundExcluded} playground test${playgroundExcluded === 1 ? '' : 's'} were left out — a playground run is you talking to your own agent, not a customer, so a playbook built from those would describe your testing rather than your buyers.`
          : 'There are no transcripts this policy allows to be mined.',
    };

  const objections = await db
    .prepare(
      `SELECT label, occurrences FROM objection_library WHERE organization_id = ?
       ORDER BY occurrences DESC LIMIT 10`,
    )
    .bind(input.organizationId)
    .all<{ label: string; occurrences: number }>();

  const playbook = buildPlaybook({
    calls,
    objections: objections.results ?? [],
  });

  const playbookId = `playbook_${crypto.randomUUID()}`;
  await db
    .prepare(`INSERT INTO playbooks
      (id, organization_id, status, calls_read, won_count, lost_count, blocked, excluded_json, created_by)
      VALUES (?, ?, 'proposed', ?, ?, ?, ?, ?, ?)`)
    .bind(
      playbookId,
      input.organizationId,
      calls.length,
      playbook.wonCount,
      playbook.lostCount,
      playbook.blocked,
      JSON.stringify(playbook.excluded),
      input.userId,
    )
    .run();

  if (playbook.entries.length > 0)
    await db.batch(
      playbook.entries.map((entry) =>
        db
          .prepare(`INSERT INTO playbook_entries
            (id, playbook_id, organization_id, section, content, evidence, won_calls, lost_calls, confidence, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed')`)
          .bind(
            `pbentry_${crypto.randomUUID()}`,
            playbookId,
            input.organizationId,
            entry.section,
            entry.content.slice(0, 500),
            entry.evidence.slice(0, 500),
            entry.wonCalls,
            entry.lostCalls,
            entry.confidence,
          ),
      ),
    );

  return {
    ok: true,
    playbookId,
    callsRead: calls.length,
    wonCount: playbook.wonCount,
    lostCount: playbook.lostCount,
    blocked: playbook.blocked,
    excluded: playbook.excluded,
    consentExcluded,
    playgroundExcluded,
    consentNote:
      requiresConsent && consentExcluded > 0
        ? `${consentExcluded} transcript${consentExcluded === 1 ? '' : 's'} were left out because there is no consent on record for that number, and your policy is “record with consent”.`
        : null,
    entries: playbook.entries.length,
    caveat: playbook.caveat,
  };
}

export type StoredPlaybook = {
  id: string;
  status: string;
  callsRead: number;
  wonCount: number;
  lostCount: number;
  blocked: string | null;
  excluded: Array<{ outcome: string; count: number; reason: string }>;
  createdAt: string;
  entries: Array<PlaybookEntry & { id: string; status: string }>;
  approved: number;
  proposed: number;
};

export async function latestPlaybook(
  organizationId: string,
): Promise<StoredPlaybook | null> {
  const db = getRawDb();
  const row = await db
    .prepare(`SELECT id, status, calls_read, won_count, lost_count, blocked, excluded_json, created_at
      FROM playbooks WHERE organization_id = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(organizationId)
    .first<{
      id: string;
      status: string;
      calls_read: number;
      won_count: number;
      lost_count: number;
      blocked: string | null;
      excluded_json: string;
      created_at: string;
    }>();
  if (!row) return null;

  const entries = await db
    .prepare(`SELECT id, section, content, evidence, won_calls, lost_calls, confidence, status
      FROM playbook_entries WHERE playbook_id = ? ORDER BY
        CASE section WHEN 'winning_phrase' THEN 0 WHEN 'losing_phrase' THEN 1
          WHEN 'objection' THEN 2 ELSE 3 END,
        won_calls DESC, content`)
    .bind(row.id)
    .all<{
      id: string;
      section: string;
      content: string;
      evidence: string;
      won_calls: number;
      lost_calls: number;
      confidence: string;
      status: string;
    }>();

  const mapped = (entries.results ?? []).map((entry) => ({
    id: entry.id,
    section: entry.section as PlaybookEntry['section'],
    content: entry.content,
    evidence: entry.evidence,
    wonCalls: entry.won_calls,
    lostCalls: entry.lost_calls,
    confidence: entry.confidence as PlaybookEntry['confidence'],
    status: entry.status,
  }));

  return {
    id: row.id,
    status: row.status,
    callsRead: row.calls_read,
    wonCount: row.won_count,
    lostCount: row.lost_count,
    blocked: row.blocked,
    excluded: safeExcluded(row.excluded_json),
    createdAt: row.created_at,
    entries: mapped,
    approved: mapped.filter((entry) => entry.status === 'approved').length,
    proposed: mapped.filter((entry) => entry.status === 'proposed').length,
  };
}

export async function reviewEntry(input: {
  organizationId: string;
  entryId: string;
  status: 'approved' | 'rejected' | 'proposed';
  userId: string;
}) {
  const db = getRawDb();
  const entry = await db
    .prepare(
      `SELECT playbook_id FROM playbook_entries WHERE id = ? AND organization_id = ? LIMIT 1`,
    )
    .bind(input.entryId, input.organizationId)
    .first<{ playbook_id: string }>();
  const result = await db
    .prepare(`UPDATE playbook_entries SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?`)
    .bind(input.status, input.userId, input.entryId, input.organizationId)
    .run();
  if ((result.meta?.changes ?? 0) === 0) return { ok: false };

  // The header used to say 'proposed' forever while every line beneath it was
  // being decided. Rolled forward from the entries themselves, so there is one
  // fact rather than two that can disagree.
  if (entry?.playbook_id) {
    const counts = await db
      .prepare(`SELECT
          sum(CASE WHEN status = 'proposed' THEN 1 ELSE 0 END) AS proposed,
          sum(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
          sum(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected
        FROM playbook_entries WHERE playbook_id = ? AND organization_id = ?`)
      .bind(entry.playbook_id, input.organizationId)
      .first<{ proposed: number; approved: number; rejected: number }>();
    await db
      .prepare(
        `UPDATE playbooks SET status = ? WHERE id = ? AND organization_id = ?`,
      )
      .bind(
        playbookHeaderStatus({
          proposed: Number(counts?.proposed ?? 0),
          approved: Number(counts?.approved ?? 0),
          rejected: Number(counts?.rejected ?? 0),
        }),
        entry.playbook_id,
        input.organizationId,
      )
      .run();
  }
  return { ok: true };
}

/**
 * The approved playbook, as a block the agent's prompt can carry.
 *
 * Only approved rows, and each one keeps its counts. An agent told "say
 * 'shall we book a site visit'" will say it on every call; an agent told the
 * phrase appeared in 6 of 8 calls that closed can weigh it against what the
 * caller in front of it is actually saying.
 */
export async function approvedPlaybookBlock(
  organizationId: string,
): Promise<string | null> {
  const rows = await getRawDb()
    .prepare(`SELECT section, content, evidence FROM playbook_entries
      WHERE organization_id = ? AND status = 'approved'
      ORDER BY CASE section WHEN 'winning_phrase' THEN 0 WHEN 'vocabulary' THEN 1
        WHEN 'objection' THEN 2 ELSE 3 END LIMIT 40`)
    .bind(organizationId)
    .all<{ section: string; content: string; evidence: string }>();
  const entries = rows.results ?? [];
  if (entries.length === 0) return null;

  const group = (section: string) =>
    entries.filter((entry) => entry.section === section);
  const lines: string[] = [];
  const winning = group('winning_phrase');
  if (winning.length > 0) {
    lines.push('Things that came up in calls that closed:');
    for (const entry of winning)
      lines.push(`- "${entry.content}" (${entry.evidence})`);
  }
  const losing = group('losing_phrase');
  if (losing.length > 0) {
    lines.push('Things that came up in calls that did not close:');
    for (const entry of losing)
      lines.push(`- "${entry.content}" (${entry.evidence})`);
  }
  const vocabulary = group('vocabulary');
  if (vocabulary.length > 0)
    lines.push(
      `Words this company's own customers use: ${vocabulary.map((entry) => entry.content).join(', ')}.`,
    );

  return `<company_playbook>
These were mined from this company's past calls and approved by a person here.
They are patterns, not instructions: a phrase that appeared in calls that closed
did not close them. Use them where they fit what the caller is actually saying,
and ignore them where they do not.
${lines.join('\n')}
</company_playbook>`;
}

function safeExcluded(raw: string) {
  try {
    const parsed = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(parsed)
      ? (parsed as Array<{ outcome: string; count: number; reason: string }>)
      : [];
  } catch {
    return [];
  }
}
