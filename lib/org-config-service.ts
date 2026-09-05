/**
 * Archiving org configuration, against the database.
 *
 * One implementation for all seven kinds, because the alternative — an archive
 * action written separately in three route files — is how `branches` ended up
 * deletable and `teams` ended up permanent in the first place.
 *
 * The statements live next door in `lib/org-config.ts`, written out per kind
 * rather than composed from a table name. It is more lines and it is worth
 * them: no table name is interpolated into SQL, `check-table-usage` can see
 * which tables are touched, and because the text is in a pure module a test
 * can assert every one of them binds exactly what it asks for — which is the
 * guarantee `check-sql-bindings` gives statements written inline, and which a
 * `prepare(MAP[kind])` would otherwise lose.
 */

import { getRawDb } from '@/db/index';
import {
  ARCHIVE,
  canArchive,
  canRestore,
  describeReferences,
  normaliseConfigStatus,
  ORG_CONFIG_LABEL,
  READ,
  RESTORE,
  type OrgConfigKind,
} from '@/lib/org-config';

/**
 * What points at each kind, counted so archiving can say what it affects.
 *
 * Only the three kinds other rows actually reference. A shift or a route is
 * pointed at by nothing, so archiving one affects only itself.
 */
const REFERENCES: Partial<
  Record<OrgConfigKind, Array<{ label: string; sql: string }>>
> = {
  branch: [
    {
      label: 'agent',
      sql: `SELECT count(*) AS total FROM support_agents WHERE branch_id = ? AND organization_id = ?`,
    },
    {
      label: 'team',
      sql: `SELECT count(*) AS total FROM teams WHERE branch_id = ? AND organization_id = ?`,
    },
  ],
  department: [
    {
      label: 'agent',
      sql: `SELECT count(*) AS total FROM support_agents WHERE department_id = ? AND organization_id = ?`,
    },
    {
      label: 'team',
      sql: `SELECT count(*) AS total FROM teams WHERE department_id = ? AND organization_id = ?`,
    },
  ],
  team: [
    {
      label: 'agent',
      sql: `SELECT count(*) AS total FROM support_agents WHERE team_id = ? AND organization_id = ?`,
    },
  ],
};

export type ArchiveResult = {
  ok: boolean;
  status?: string;
  /** What still points at it, in words, when archiving succeeded. */
  note?: string;
  reason?: string;
};

async function readRow(
  kind: OrgConfigKind,
  id: string,
  organizationId: string,
) {
  return getRawDb()
    .prepare(READ[kind])
    .bind(id, organizationId)
    .first<{ id: string; status: string | null }>();
}

async function countReferences(
  kind: OrgConfigKind,
  id: string,
  organizationId: string,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const reference of REFERENCES[kind] ?? []) {
    const row = await getRawDb()
      .prepare(reference.sql)
      .bind(id, organizationId)
      .first<{ total: number }>();
    counts[reference.label] = Number(row?.total ?? 0);
  }
  return counts;
}

/**
 * Turns a piece of configuration off without losing it.
 *
 * References are counted and reported rather than treated as blockers: a call
 * recorded against a branch should still name that branch after it closes, and
 * that is precisely what deleting the row took away.
 */
export async function archiveOrgConfig(input: {
  organizationId: string;
  kind: OrgConfigKind;
  id: string;
}): Promise<ArchiveResult> {
  const row = await readRow(input.kind, input.id, input.organizationId);
  if (!row)
    return {
      ok: false,
      reason: `That ${ORG_CONFIG_LABEL[input.kind]} is not in this workspace.`,
    };
  if (!canArchive(row.status))
    return {
      ok: false,
      reason: `This ${ORG_CONFIG_LABEL[input.kind]} is already archived.`,
    };

  const counts = await countReferences(
    input.kind,
    input.id,
    input.organizationId,
  );
  await getRawDb()
    .prepare(ARCHIVE[input.kind])
    .bind(input.id, input.organizationId)
    .run();

  return {
    ok: true,
    status: 'archived',
    note: describeReferences(input.kind, counts),
  };
}

export async function restoreOrgConfig(input: {
  organizationId: string;
  kind: OrgConfigKind;
  id: string;
}): Promise<ArchiveResult> {
  const row = await readRow(input.kind, input.id, input.organizationId);
  if (!row)
    return {
      ok: false,
      reason: `That ${ORG_CONFIG_LABEL[input.kind]} is not in this workspace.`,
    };
  if (!canRestore(row.status))
    return {
      ok: false,
      reason: `This ${ORG_CONFIG_LABEL[input.kind]} is already active.`,
    };

  await getRawDb()
    .prepare(RESTORE[input.kind])
    .bind(input.id, input.organizationId)
    .run();
  return { ok: true, status: 'active' };
}

/** Whether a row may still be chosen for new work. */
export function isActive(status: unknown) {
  return normaliseConfigStatus(status) === 'active';
}
