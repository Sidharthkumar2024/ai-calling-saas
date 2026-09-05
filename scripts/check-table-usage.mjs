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
 *
 * It reported 22 on its first run. All 22 are closed, so it is part of
 * `npm test` now — a new one fails the suite rather than joining a backlog.
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
  // Not frozen — never open. An invoice here is a receipt, written only once
  // the money has already arrived, with `status = 'paid'` and `paid_at` set in
  // the same statement. There is no open-then-paid lifecycle to be missing.
  invoices: 'a receipt issued after payment; correct as written, never edited',
  // Both of these record a verdict that was already reached before the row
  // existed. A growth run is written when the crawl has finished, with the
  // status it finished in; an import row is written with the parser's own
  // accepted-or-rejected decision about that line. Neither has a later state
  // to move to.
  growth_runs: 'written when the run has already finished, in its final state',
  import_rows: "written with the parser's verdict on that line; final",
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

// Any file carrying SQL, not only ones that call `.prepare(`. Statement text
// lives in pure modules too — `lib/org-config.ts` holds twenty-one of them so
// that a test can check their bindings — and a scan that missed those reported
// seven tables as frozen while the code that thaws them sat one import away.
const files = execSync(
  "grep -rlE '(SELECT |INSERT +INTO|UPDATE +[a-z_]+ +SET|DELETE +FROM)' app lib services --include='*.ts' --include='*.mjs' 2>/dev/null",
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
  for (const match of sql.matchAll(/\bUPDATE\s+([a-z_0-9]+)\s+SET/gi)) {
    note(updates, match[1].toLowerCase(), file);
    // An UPDATE is also proof somebody cares about the row's contents.
    note(reads, match[1].toLowerCase(), file);
  }
  for (const match of sql.matchAll(/\bDELETE\s+FROM\s+([a-z_0-9]+)/gi))
    note(reads, match[1].toLowerCase(), file);

  // An INSERT is scanned along with the rest of its own statement, because an
  // upsert is three operations wearing one keyword. `invoice_sequences` is the
  // case that taught this: it is written, updated and read back by a single
  // `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, and counting only the
  // INSERT reported a table nobody could ever see.
  for (const match of sql.matchAll(
    /\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+([a-z_0-9]+)/gi,
  )) {
    const table = match[1].toLowerCase();
    note(writes, table, file);
    // The rest of that statement, up to the end of its template literal. An
    // unterminated match must not cost us the write above, which is why this
    // is a second look rather than one greedier pattern.
    const rest = sql.slice(match.index, sql.indexOf('`', match.index) + 1);
    if (rest.length > 0 && rest.length < 2000) {
      if (/\bON\s+CONFLICT\b[\s\S]*?\bDO\s+UPDATE\b/i.test(rest))
        note(updates, table, file);
      if (/\bRETURNING\b/i.test(rest)) note(reads, table, file);
    }
  }
}

/**
 * Tables reached through a helper that builds its own SQL.
 *
 * `scoped(db, 'alert_rules', …)` and `owned('branches', …)` compose
 * `SELECT * FROM ${table}`, so the table name is a JavaScript string and no
 * amount of SQL matching will find it. In a file that demonstrably builds
 * dynamic SQL, a bare string literal equal to a table name is one of those
 * arguments — near enough always, and the alternative is reporting every such
 * table as dead.
 *
 * Counted, but counted separately and reported in the summary, so this is a
 * stated limit rather than a silent one. `check-sql-bindings` reports its own
 * dynamic skips the same way.
 */
const dynamic = new Set();
for (const file of files) {
  const sql = readFileSync(file, 'utf8');
  if (!/\b(?:FROM|JOIN|INTO|UPDATE)\s+\$\{/.test(sql)) continue;
  for (const match of sql.matchAll(/'([a-z_0-9]{3,})'/g)) {
    const table = match[1];
    if (!declared.has(table)) continue;
    dynamic.add(table);
    note(reads, table, `${file} (dynamic)`);
    if (/\bUPDATE\s+\$\{/.test(sql)) note(updates, table, `${file} (dynamic)`);
  }
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
  `${declared.size} tables checked, ${Object.keys(EXPECTED).length} declared append-only, ${dynamic.size} reached through dynamic SQL, ${total} flagged`,
);
if (total > 0) process.exitCode = 1;
