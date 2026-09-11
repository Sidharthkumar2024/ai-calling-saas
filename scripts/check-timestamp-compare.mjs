/**
 * Two shapes of timestamp, compared as text.
 *
 * This codebase writes timestamps two ways. SQLite's own `CURRENT_TIMESTAMP`
 * and `datetime()` produce `2026-09-11 07:56:13`. JavaScript's `toISOString()`
 * produces `2026-09-11T07:56:13.000Z`, and one column holds an offset form,
 * `2026-09-01T20:00:00+05:30`. SQLite has no date type, so a comparison
 * between them is a comparison of strings — and `'T'` (0x54) sorts above
 * `' '` (0x20), so an ISO timestamp never looks older than a same-day
 * `datetime('now')`, whatever the clock says.
 *
 * What that did: the ninety-minute sweep that closes a call nobody hung up
 * never fired on the day the call started, so an abandoned call kept counting
 * toward concurrency and billing until the date rolled over in UTC. A support
 * session that expired an hour ago was still shown to the customer as live
 * access into their workspace. A message scheduled for this afternoon waited
 * for midnight.
 *
 * The fix at each site is to wrap the stored column in `datetime(...)`, which
 * parses all three shapes and normalises to UTC. This check keeps it that way.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Columns written as an ISO string somewhere in the codebase, so a text
 * comparison against SQLite's own format is wrong.
 *
 * Adding a column here is a decision made by looking at its writers. Removing
 * one should mean every writer now uses SQLite's format, not that the check
 * became inconvenient.
 */
const ISO_COLUMNS = [
  'started_at', // call_records, via new Date().toISOString()
  'ended_at', // call_records, from one writer; the Exotel webhook writes the other shape
  'expires_at', // auth_sessions, support_sessions, and consent/suppression rows straight from a request body
  'scheduled_for', // outbound_messages, sometimes carrying a +05:30 offset
];

const files = execSync(
  "grep -rlE \"datetime\\('now'|CURRENT_TIMESTAMP\" lib app --include='*.ts' 2>/dev/null || true",
  { encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .filter(Boolean);

let checked = 0;
const problems = [];
for (const file of files) {
  const source = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
  const lines = source.split('\n');
  lines.forEach((line, index) => {
    if (!/datetime\('now'|CURRENT_TIMESTAMP/.test(line)) return;
    for (const column of ISO_COLUMNS) {
      const CLOCK = `(?:datetime\\('now'[^)]*\\)|CURRENT_TIMESTAMP)`;
      const COL = `(?:[a-z]\\.)?${column}`;
      const OP = `\\s*(?:<=|>=|<|>)\\s*`;
      // The column on one side of a comparison and SQLite's clock on the
      // other — in either order, wrapped or not. Being mentioned on the same
      // line is not enough: `ended_at IS NULL AND datetime(expires_at) > …`
      // mentions a second column that is not in the comparison at all, and
      // `SET consumed_at = CURRENT_TIMESTAMP … AND expires_at > ?` compares
      // against a bound value, which is the caller's business.
      const bare = new RegExp(
        `(?:(^|[^_a-z(.])${COL}${OP}${CLOCK})|(?:${CLOCK}${OP}${COL}\\b)`,
      );
      const wrapped = new RegExp(
        `(?:datetime\\(\\s*${COL}\\s*\\)${OP}${CLOCK})|(?:${CLOCK}${OP}datetime\\(\\s*${COL}\\s*\\))`,
      );
      const isWrapped = wrapped.test(line);
      if (!isWrapped && !bare.test(line)) continue;
      checked += 1;
      if (isWrapped) continue;
      problems.push({
        file,
        line: index + 1,
        column,
        text: line.trim().slice(0, 110),
      });
    }
  });
}

if (problems.length) {
  console.error(
    `${problems.length} comparison${problems.length === 1 ? '' : 's'} between an ISO timestamp and SQLite's own clock:`,
  );
  for (const problem of problems)
    console.error(`  ✗ ${problem.file}:${problem.line} — ${problem.column} — ${problem.text}`);
  console.error(
    "  Wrap the stored column: datetime(column) <= datetime('now', ?).",
  );
  process.exit(1);
}
console.log(
  `${checked} comparisons against SQLite's clock use an ISO column, all normalised with datetime().`,
);
