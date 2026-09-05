/**
 * Finds tables that are written and never read, and statuses that can never
 * change.
 *
 * This exists because the same defect kept turning up by hand, in five
 * different subsystems, over as many days:
 *
 * - `appointments` had no `UPDATE` anywhere, so `status` was permanently
 *   'booked' and nothing could be cancelled or marked a no-show. No screen read
 *   the table either — an appointment agreed on a call was invisible to the
 *   business.
 * - `outbound_messages` rows were queued by four different tools and delivered
 *   by nothing, while every one of those tools told the model the message was
 *   sent.
 * - `callback_requests` were created, listed, and could never be worked.
 * - `send_policy_json`, `association_type` and `association_id` were read on
 *   screens and never written by anything.
 *
 * Each one looked finished: a row was written, so the work was treated as
 * done. That is a shape a script can see, so it should not have to be noticed
 * by a person a sixth time.
 *
 * Three findings, in order of how often they were real:
 *
 *   WRITE-ONLY   inserted, never selected. Nobody can ever see it.
 *   READ-ONLY    selected, never inserted. The screen can only ever be empty.
 *   FROZEN       has a `status` column, is inserted, and is never updated.
 *                The status is decoration.
 *
 * Legitimate exceptions are declared below with a reason, so this file is a
 * record of intent rather than a list of things someone silenced.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const BOOTSTRAP = 'db/bootstrap.ts';

/**
 * Tables that genuinely only ever grow, and why.
 *
 * An append-only log is not a defect: nothing updates an audit trail, and
 * plenty of them are read by nothing in this repo because they are read by a
 * person with a SQL client after an incident. Each entry has to say which it
 * is.
 */
const EXPECTED = {
  audit_events: 'append-only trail; edited by nothing, by design',
  provider_usage_events: 'append-only metering; rolled up by query',
  provider_webhook_events: 'append-only provider receipts, kept for replay',
};

const source = readFileSync(BOOTSTRAP, 'utf8');
const declared = new Set(
  [...source.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_0-9]+)/gi)].map(
    (match) => match[1],
  ),
);

/** Which tables carry a status column, read from the DDL rather than guessed. */
const hasStatus = new Set();
for (const match of source.matchAll(
  /CREATE TABLE IF NOT EXISTS\s+([a-z_0-9]+)\s*\(([\s\S]*?)\n\s*\)/gi,
)) {
  if (/^\s*status\s+TEXT/im.test(match[2])) hasStatus.add(match[1]);
}
// Columns added later by ensureColumn count too.
for (const match of source.matchAll(
  /ensureColumn\(\s*db,\s*'([a-z_0-9]+)',\s*'status'/gi,
))
  hasStatus.add(match[1]);

const files = execSync(
  "grep -rl 'prepare(' app lib services --include='*.ts' --include='*.mjs' 2>/dev/null",
  { encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .filter(Boolean)
  .filter((file) => file !== BOOTSTRAP);

const reads = new Map();
const writes = new Map();
const updates = new Map();

const note = (map, table, file) => {
  if (!declared.has(table)) return;
  if (!map.has(table)) map.set(table, new Set());
  map.get(table).add(file);
};

// `db/bootstrap.ts` is excluded from the file scan because its DDL names every
// table, which would make everything look read. Its *seeds* are a different
// thing: a row created by a seed is still a row that exists, so a table filled
// only there is not read-only, and seeds are counted for creation.
//
// Its UPDATEs are deliberately not counted at all. Bootstrap holds one-off
// backfills — `UPDATE provider_usage_events SET unpriced = 1` runs once over
// old rows — and a migration is not a lifecycle. Counting it would let a table
// whose status still never changes at runtime look like it does.
for (const match of source.matchAll(
  /\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+([a-z_0-9]+)/gi,
))
  note(writes, match[1].toLowerCase(), BOOTSTRAP);

for (const file of files) {
  const sql = readFileSync(file, 'utf8');
  for (const match of sql.matchAll(/\bFROM\s+([a-z_0-9]+)/gi))
    note(reads, match[1].toLowerCase(), file);
  for (const match of sql.matchAll(/\bJOIN\s+([a-z_0-9]+)/gi))
    note(reads, match[1].toLowerCase(), file);
  for (const match of sql.matchAll(
    /\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+([a-z_0-9]+)/gi,
  ))
    note(writes, match[1].toLowerCase(), file);
  for (const match of sql.matchAll(/\bUPDATE\s+([a-z_0-9]+)\s+SET/gi)) {
    note(updates, match[1].toLowerCase(), file);
    // An UPDATE is also proof somebody cares about the row's contents.
    note(reads, match[1].toLowerCase(), file);
  }
  for (const match of sql.matchAll(/\bDELETE\s+FROM\s+([a-z_0-9]+)/gi))
    note(reads, match[1].toLowerCase(), file);
}

const findings = [];
for (const table of [...declared].sort((left, right) =>
  left.localeCompare(right),
)) {
  const reason = EXPECTED[table];
  const isRead = reads.has(table);
  const isWritten = writes.has(table);
  const isUpdated = updates.has(table);

  if (isWritten && !isRead && !reason)
    findings.push({
      kind: 'WRITE-ONLY',
      table,
      detail: `written by ${[...writes.get(table)].join(', ')} and read by nothing. Whatever this records, nobody can see it.`,
    });

  if (isRead && !isWritten && !reason)
    findings.push({
      kind: 'READ-ONLY',
      table,
      detail: `read by ${[...reads.get(table)].slice(0, 3).join(', ')} and written by nothing. That screen can only ever be empty.`,
    });

  if (isWritten && isRead && !isUpdated && hasStatus.has(table) && !reason)
    findings.push({
      kind: 'FROZEN',
      table,
      detail:
        'has a status column, is inserted and is never updated. The status can only ever hold the value it was created with.',
    });
}

// An exception that no longer applies is its own kind of stale.
const unused = Object.keys(EXPECTED).filter(
  (table) => !declared.has(table) || updates.has(table),
);

for (const finding of findings)
  console.error(`${finding.kind}  ${finding.table} — ${finding.detail}`);
for (const table of unused)
  console.error(
    `STALE-EXCEPTION  ${table} — listed as append-only but is ${declared.has(table) ? 'updated' : 'no longer a table'}. Remove the entry.`,
  );

const total = findings.length + unused.length;
console.log(
  `${declared.size} tables checked, ${Object.keys(EXPECTED).length} declared append-only, ${total} flagged`,
);
if (total > 0) process.exitCode = 1;
