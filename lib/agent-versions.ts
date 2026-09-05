/**
 * Snapshotting and restoring agent configurations (Part 2.1).
 *
 * A version is taken on every edit rather than only on publish. The reason is
 * the case people actually hit: somebody edits a live agent, realises the new
 * prompt is worse mid-afternoon, and wants yesterday's back. If versions only
 * existed at publish, that edit — the one that caused the problem — would be
 * the one with no record of what it replaced.
 */

import { getRawDb } from '@/db/index';
import {
  cloneName,
  diffVersions,
  VERSIONED_FIELDS,
  type Snapshot,
} from '@/lib/agent-lifecycle';

/** Keeps the last N versions per agent, so an edited-daily agent cannot grow forever. */
export const KEEP_VERSIONS = 20;

async function agentRow(organizationId: string, agentId: string) {
  return getRawDb()
    .prepare(
      `SELECT * FROM voice_agents WHERE id = ? AND organization_id = ? LIMIT 1`,
    )
    .bind(agentId, organizationId)
    .first<Record<string, unknown>>();
}

function snapshotOf(row: Record<string, unknown>): Snapshot {
  const snapshot: Snapshot = {};
  for (const field of VERSIONED_FIELDS) snapshot[field] = row[field] ?? null;
  return snapshot;
}

/**
 * Records what the agent looks like right now.
 *
 * Called before an update, so the stored version is the configuration being
 * replaced — the thing somebody rolling back actually wants.
 */
export async function snapshotAgent(input: {
  organizationId: string;
  agentId: string;
  note: string;
  userId: string;
}): Promise<{ version: number } | null> {
  const row = await agentRow(input.organizationId, input.agentId);
  if (!row) return null;
  const db = getRawDb();
  const latest = await db
    .prepare(
      `SELECT coalesce(max(version), 0) AS n FROM agent_versions WHERE agent_id = ?`,
    )
    .bind(input.agentId)
    .first<{ n: number }>();
  const version = Number(latest?.n ?? 0) + 1;

  await db
    .prepare(`INSERT INTO agent_versions
      (id, organization_id, agent_id, version, snapshot_json, note, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      `agentver_${crypto.randomUUID()}`,
      input.organizationId,
      input.agentId,
      version,
      JSON.stringify(snapshotOf(row)),
      input.note.slice(0, 200),
      input.userId,
    )
    .run();

  await db
    .prepare(`DELETE FROM agent_versions WHERE agent_id = ? AND id NOT IN (
        SELECT id FROM agent_versions WHERE agent_id = ? ORDER BY version DESC LIMIT ?
      )`)
    .bind(input.agentId, input.agentId, KEEP_VERSIONS)
    .run();

  return { version };
}

export async function listVersions(organizationId: string, agentId: string) {
  const current = await agentRow(organizationId, agentId);
  const rows = await getRawDb()
    .prepare(`SELECT version, snapshot_json, note, created_at FROM agent_versions
      WHERE agent_id = ? AND organization_id = ? ORDER BY version DESC LIMIT ?`)
    .bind(agentId, organizationId, KEEP_VERSIONS)
    .all<{
      version: number;
      snapshot_json: string;
      note: string | null;
      created_at: string;
    }>();

  const now = current ? snapshotOf(current) : {};
  return (rows.results ?? []).map((row) => {
    let snapshot: Snapshot = {};
    try {
      snapshot = JSON.parse(row.snapshot_json) as Snapshot;
    } catch {
      snapshot = {};
    }
    return {
      version: row.version,
      note: row.note,
      createdAt: row.created_at,
      // What restoring this one would change, computed against the live
      // configuration rather than against the version before it.
      changesFromCurrent: diffVersions(now, snapshot),
    };
  });
}

export type RestoreResult =
  | { ok: true; changed: string[]; snapshotVersion: number }
  | { ok: false; reason: string };

/**
 * Restores a version.
 *
 * Taking a snapshot of the current state first, because a rollback is itself
 * an edit somebody may want to undo — restoring the wrong version and having
 * no way back would be the same trap this exists to remove.
 */
export async function restoreVersion(input: {
  organizationId: string;
  agentId: string;
  version: number;
  userId: string;
}): Promise<RestoreResult> {
  const db = getRawDb();
  const row = await db
    .prepare(`SELECT snapshot_json FROM agent_versions
      WHERE agent_id = ? AND organization_id = ? AND version = ? LIMIT 1`)
    .bind(input.agentId, input.organizationId, input.version)
    .first<{ snapshot_json: string }>();
  if (!row) return { ok: false, reason: 'That version is no longer kept.' };

  let snapshot: Snapshot;
  try {
    snapshot = JSON.parse(row.snapshot_json) as Snapshot;
  } catch {
    return { ok: false, reason: 'That version could not be read.' };
  }

  const current = await agentRow(input.organizationId, input.agentId);
  if (!current) return { ok: false, reason: 'Agent not found.' };
  const changed = diffVersions(snapshotOf(current), snapshot);

  const taken = await snapshotAgent({
    organizationId: input.organizationId,
    agentId: input.agentId,
    note: `Before restoring version ${input.version}`,
    userId: input.userId,
  });

  const assignments = VERSIONED_FIELDS.map((field) => `${field} = ?`).join(
    ', ',
  );
  await db
    .prepare(`UPDATE voice_agents SET ${assignments}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?`)
    .bind(
      ...VERSIONED_FIELDS.map((field) => snapshot[field] ?? null),
      input.agentId,
      input.organizationId,
    )
    .run();

  return { ok: true, changed, snapshotVersion: taken?.version ?? 0 };
}

/**
 * Duplicates an agent so a change can be tried without touching the one
 * answering calls. The copy always starts as a draft, whatever the original
 * was — cloning a live agent must not produce a second live agent.
 */
export async function cloneAgent(input: {
  organizationId: string;
  agentId: string;
}): Promise<
  { ok: true; agentId: string; name: string } | { ok: false; reason: string }
> {
  const db = getRawDb();
  const row = await agentRow(input.organizationId, input.agentId);
  if (!row) return { ok: false, reason: 'Agent not found.' };

  const names = await db
    .prepare(`SELECT name FROM voice_agents WHERE organization_id = ?`)
    .bind(input.organizationId)
    .all<{ name: string }>();
  const name = cloneName(
    typeof row.name === 'string' ? row.name : 'Agent',
    (names.results ?? []).map((entry) => entry.name),
  );

  const id = `agent_${crypto.randomUUID()}`;
  const fields = VERSIONED_FIELDS.filter((field) => field !== 'name');
  const columns = ['id', 'organization_id', 'name', 'status', ...fields];
  await db
    .prepare(`INSERT INTO voice_agents (${columns.join(', ')})
      VALUES (${columns.map(() => '?').join(', ')})`)
    .bind(
      id,
      input.organizationId,
      name,
      'draft',
      ...fields.map((field) => row[field] ?? null),
    )
    .run();
  return { ok: true, agentId: id, name };
}
