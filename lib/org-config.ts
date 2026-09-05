/**
 * Turning off a piece of org configuration, instead of deleting it or being
 * unable to touch it at all.
 *
 * The table-usage audit found seven of these at once: `branches`,
 * `departments`, `teams`, `shifts`, `number_routes`, `routing_rules` and
 * `lead_sources` all carry a `status` column that nothing ever updates. Four
 * of them could be hard-deleted and three could not be removed at all, so a
 * team created by mistake was permanent and a branch that closed took its
 * history with it.
 *
 * Archiving is the right shape for both. A team is pointed at by
 * `support_agents.team_id`, a shift by the roster, a number route by a live
 * number — deleting the row leaves those pointing at nothing, and a call
 * recorded against "Andheri branch" should still say so a year after the
 * branch closed. So `status` becomes the thing it always looked like it was:
 * active or archived, reversible, and never a reason to lose a reference.
 */

export const ORG_CONFIG_KINDS = [
  'branch',
  'department',
  'team',
  'shift',
  'number_route',
  'routing_rule',
  'lead_source',
] as const;

export type OrgConfigKind = (typeof ORG_CONFIG_KINDS)[number];

export function isOrgConfigKind(value: unknown): value is OrgConfigKind {
  return (ORG_CONFIG_KINDS as readonly string[]).includes(String(value));
}

/**
 * Kind to table.
 *
 * A lookup, never a table name taken from a request — the same rule
 * `ASSOCIATION_TABLE` follows, and for the same reason: these names are
 * interpolated into SQL.
 */
export const ORG_CONFIG_TABLE: Record<OrgConfigKind, string> = {
  branch: 'branches',
  department: 'departments',
  team: 'teams',
  shift: 'shifts',
  number_route: 'number_routes',
  routing_rule: 'routing_rules',
  lead_source: 'lead_sources',
};

export const ORG_CONFIG_LABEL: Record<OrgConfigKind, string> = {
  branch: 'branch',
  department: 'department',
  team: 'team',
  shift: 'shift',
  number_route: 'number route',
  routing_rule: 'routing rule',
  lead_source: 'lead source',
};

export const CONFIG_STATUSES = ['active', 'archived'] as const;
export type ConfigStatus = (typeof CONFIG_STATUSES)[number];

export function isConfigStatus(value: unknown): value is ConfigStatus {
  return (CONFIG_STATUSES as readonly string[]).includes(String(value));
}

/** An unrecognised value counts as active, so nothing silently disappears. */
export function normaliseConfigStatus(value: unknown): ConfigStatus {
  return String(value) === 'archived' ? 'archived' : 'active';
}

export function canArchive(current: unknown) {
  return normaliseConfigStatus(current) === 'active';
}

export function canRestore(current: unknown) {
  return normaliseConfigStatus(current) === 'archived';
}

/**
 * What still points at this row.
 *
 * Archiving is allowed with references outstanding — that is the whole
 * advantage over deleting — but the person doing it should be told, because
 * archiving the only team an agent belongs to is a different act from
 * archiving an empty one.
 */
export function describeReferences(
  kind: OrgConfigKind,
  counts: Record<string, number>,
): string {
  const parts = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([what, count]) => `${count} ${count === 1 ? what : `${what}s`}`);
  if (parts.length === 0)
    return `Nothing points at this ${ORG_CONFIG_LABEL[kind]}.`;
  return `${parts.join(' and ')} still ${parts.length === 1 && parts[0].startsWith('1 ') ? 'points' : 'point'} at this ${ORG_CONFIG_LABEL[kind]}. Archiving keeps that intact — the name stays readable on old records.`;
}

/** One line for the row on screen. */
export function describeConfigRow(input: {
  kind: OrgConfigKind;
  name: string;
  status: unknown;
}): string {
  const name = String(input.name ?? '').trim() || 'Unnamed';
  return normaliseConfigStatus(input.status) === 'archived'
    ? `${name} — archived, kept for the records that mention it.`
    : name;
}

/* ------------------------------------------------------------------ *
 * The statements
 *
 * Kept here, as text, for two reasons: nothing interpolates a table name into
 * SQL, and a pure module can be tested — `scripts/test-org-config.mjs` asserts
 * every statement takes exactly the two bindings the service passes it.
 * ------------------------------------------------------------------ */

export const READ: Record<OrgConfigKind, string> = {
  branch: `SELECT id, status FROM branches WHERE id = ? AND organization_id = ? LIMIT 1`,
  department: `SELECT id, status FROM departments WHERE id = ? AND organization_id = ? LIMIT 1`,
  team: `SELECT id, status FROM teams WHERE id = ? AND organization_id = ? LIMIT 1`,
  shift: `SELECT id, status FROM shifts WHERE id = ? AND organization_id = ? LIMIT 1`,
  number_route: `SELECT id, status FROM number_routes WHERE id = ? AND organization_id = ? LIMIT 1`,
  routing_rule: `SELECT id, status FROM routing_rules WHERE id = ? AND organization_id = ? LIMIT 1`,
  lead_source: `SELECT id, status FROM lead_sources WHERE id = ? AND organization_id = ? LIMIT 1`,
};

export const ARCHIVE: Record<OrgConfigKind, string> = {
  branch: `UPDATE branches SET status = 'archived' WHERE id = ? AND organization_id = ?`,
  department: `UPDATE departments SET status = 'archived' WHERE id = ? AND organization_id = ?`,
  team: `UPDATE teams SET status = 'archived' WHERE id = ? AND organization_id = ?`,
  shift: `UPDATE shifts SET status = 'archived' WHERE id = ? AND organization_id = ?`,
  number_route: `UPDATE number_routes SET status = 'archived' WHERE id = ? AND organization_id = ?`,
  routing_rule: `UPDATE routing_rules SET status = 'archived' WHERE id = ? AND organization_id = ?`,
  lead_source: `UPDATE lead_sources SET status = 'archived' WHERE id = ? AND organization_id = ?`,
};

export const RESTORE: Record<OrgConfigKind, string> = {
  branch: `UPDATE branches SET status = 'active' WHERE id = ? AND organization_id = ?`,
  department: `UPDATE departments SET status = 'active' WHERE id = ? AND organization_id = ?`,
  team: `UPDATE teams SET status = 'active' WHERE id = ? AND organization_id = ?`,
  shift: `UPDATE shifts SET status = 'active' WHERE id = ? AND organization_id = ?`,
  number_route: `UPDATE number_routes SET status = 'active' WHERE id = ? AND organization_id = ?`,
  routing_rule: `UPDATE routing_rules SET status = 'active' WHERE id = ? AND organization_id = ?`,
  lead_source: `UPDATE lead_sources SET status = 'active' WHERE id = ? AND organization_id = ?`,
};
