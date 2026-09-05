/**
 * Releasing media the agent was refused.
 *
 * `buildSendSet` holds files back and the agent tells the caller "a colleague
 * will send the rest". The `whatsapp_sends` row recording that promise was
 * written by one tool and read by nothing — no screen, no release, no way for
 * the colleague to exist. The table-usage audit found it; this is the half
 * that was missing.
 *
 * The one design decision worth stating: a release re-resolves the asset from
 * its record rather than trusting a URL copied into the send log. So a
 * brochure replaced since the call goes out as the current one, a record
 * unpublished since the call cannot be released at all, and there is no second
 * copy of a sensitive file's URL sitting in a log.
 */

import { getRawDb } from '@/db/index';
import {
  assetsOfRecord,
  describeSendRow,
  parseEntries,
  recordIdOfAsset,
  statusAfterRelease,
  type Asset,
  type SentEntry,
  type WithheldEntry,
} from '@/lib/whatsapp-media';

type SendRow = {
  id: string;
  session_id: string | null;
  agent_id: string | null;
  destination: string;
  sent_json: string;
  withheld_json: string;
  status: string;
  created_at: string;
};

export async function listPendingSends(organizationId: string) {
  const rows = await getRawDb()
    .prepare(`SELECT id, session_id, agent_id, destination, sent_json,
        withheld_json, status, created_at
      FROM whatsapp_sends WHERE organization_id = ?
      ORDER BY created_at DESC LIMIT 100`)
    .bind(organizationId)
    .all<SendRow>();

  const list = (rows.results ?? []).map((row) => {
    const sent = parseEntries<SentEntry>(row.sent_json);
    const withheld = parseEntries<WithheldEntry>(row.withheld_json);
    return {
      id: row.id,
      destination: row.destination,
      status: row.status,
      createdAt: row.created_at,
      sent,
      withheld,
      summary: describeSendRow({
        destination: row.destination,
        sent,
        withheld,
        status: row.status,
      }),
    };
  });

  // Anything still owed to a customer comes first. A finished send is history;
  // a waiting one is a promise somebody made out loud.
  const waiting = list.filter(
    (row) => row.withheld.length > 0 && row.status !== 'cancelled',
  );
  return {
    sends: [...waiting, ...list.filter((row) => !waiting.includes(row))],
    waiting: waiting.length,
    pendingFiles: waiting.reduce(
      (total, row) => total + row.withheld.length,
      0,
    ),
  };
}

export type ReleaseResult = {
  ok: boolean;
  released?: string[];
  /** Asked for and no longer resolvable, each with the reason. */
  unavailable?: Array<{ id: string; reason: string }>;
  reason?: string;
};

/**
 * Sends the held-back files, on a person's say-so.
 *
 * Ids not currently withheld on this row are refused rather than sent: the
 * screen and the row can disagree if two people work the queue at once, and
 * the row is the one that decides.
 */
export async function releaseWithheld(input: {
  organizationId: string;
  sendId: string;
  assetIds: string[];
  userId: string;
  note?: string;
}): Promise<ReleaseResult> {
  const db = getRawDb();
  const row = await db
    .prepare(
      `SELECT id, destination, sent_json, withheld_json, status
       FROM whatsapp_sends WHERE id = ? AND organization_id = ? LIMIT 1`,
    )
    .bind(input.sendId, input.organizationId)
    .first<SendRow>();
  if (!row) return { ok: false, reason: 'That send is not in this workspace.' };
  if (row.status === 'cancelled')
    return { ok: false, reason: 'This send was withdrawn.' };

  const withheld = parseEntries<WithheldEntry>(row.withheld_json);
  const asked = new Set(input.assetIds.map(String));
  const targets = withheld.filter((entry) => asked.has(entry.id));
  if (targets.length === 0)
    return {
      ok: false,
      reason: 'None of those files are waiting on this send any more.',
    };

  // Group by record so one query covers a release of several files from the
  // same listing, which is the usual shape.
  const byRecord = new Map<string, WithheldEntry[]>();
  const unavailable: Array<{ id: string; reason: string }> = [];
  for (const entry of targets) {
    const recordId = recordIdOfAsset(entry.id);
    if (!recordId) {
      unavailable.push({
        id: entry.id,
        reason: 'This file was recorded in a shape this release cannot read.',
      });
      continue;
    }
    if (!byRecord.has(recordId)) byRecord.set(recordId, []);
    byRecord.get(recordId)!.push(entry);
  }

  const resolved: Asset[] = [];
  for (const [recordId, entries] of byRecord) {
    const record = await db
      .prepare(
        `SELECT id, title, values_json FROM records
         WHERE id = ? AND organization_id = ? AND status = 'published' LIMIT 1`,
      )
      .bind(recordId, input.organizationId)
      .first<{ id: string; title: string; values_json: string }>();
    if (!record) {
      // Unpublished since the call is a real answer, and the right one: a
      // person releasing a file from a withdrawn listing is the thing the
      // published check exists to stop.
      for (const entry of entries)
        unavailable.push({
          id: entry.id,
          reason:
            'The listing this file came from is no longer published, so it was not sent.',
        });
      continue;
    }
    const assets = assetsOfRecord(record.id, record.title, record.values_json);
    for (const entry of entries) {
      const asset = assets.find((candidate) => candidate.id === entry.id);
      if (asset) resolved.push(asset);
      else
        unavailable.push({
          id: entry.id,
          reason:
            'This file is no longer on the listing, so there was nothing to send.',
        });
    }
  }

  if (resolved.length === 0)
    return {
      ok: false,
      reason: unavailable[0]?.reason ?? 'Nothing could be resolved to send.',
      unavailable,
    };

  const releasedIds = new Set(resolved.map((asset) => asset.id));
  const sent = parseEntries<SentEntry>(row.sent_json);
  const nextSent: SentEntry[] = [
    ...sent,
    ...resolved.map((asset) => ({
      id: asset.id,
      label: asset.label,
      releasedBy: input.userId,
    })),
  ];
  // Only what actually went leaves the waiting list. A file that could not be
  // resolved stays held, so the promise stays visible instead of being quietly
  // closed by a failed attempt.
  const nextWithheld = withheld.filter((entry) => !releasedIds.has(entry.id));

  await db
    .prepare(`INSERT INTO outbound_messages
      (id, organization_id, channel, destination, message_body, status)
      VALUES (?, ?, 'whatsapp', ?, ?, 'queued')`)
    .bind(
      `msg_${crypto.randomUUID()}`,
      input.organizationId,
      row.destination,
      `${input.note ? `${input.note}\n` : ''}${resolved
        .map((asset) => `${asset.label}: ${asset.url}`)
        .join('\n')}`.slice(0, 900),
    )
    .run();

  await db
    .prepare(
      `UPDATE whatsapp_sends SET sent_json = ?, withheld_json = ?, status = ?
       WHERE id = ? AND organization_id = ?`,
    )
    .bind(
      JSON.stringify(nextSent),
      JSON.stringify(nextWithheld),
      statusAfterRelease({
        remainingWithheld: nextWithheld.length,
        totalSent: nextSent.length,
      }),
      input.sendId,
      input.organizationId,
    )
    .run();

  return {
    ok: true,
    released: resolved.map((asset) => asset.label),
    unavailable: unavailable.length > 0 ? unavailable : undefined,
  };
}

/** Decides not to send the rest, so nobody keeps waiting on it. */
export async function cancelSend(input: {
  organizationId: string;
  sendId: string;
}) {
  const result = await getRawDb()
    .prepare(
      `UPDATE whatsapp_sends SET status = 'cancelled'
       WHERE id = ? AND organization_id = ? AND status != 'cancelled'`,
    )
    .bind(input.sendId, input.organizationId)
    .run();
  return { ok: Boolean(result.meta?.changes) };
}
