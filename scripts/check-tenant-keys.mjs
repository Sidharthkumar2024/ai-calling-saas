/**
 * A row keyed by somebody else's id.
 *
 * `kyc_documents.phone_number_id` was written straight from a form body and
 * read back by that id alone — including by the platform admin's approval
 * gate, which counts the documents a number needs before it may go live. A
 * workspace could therefore attach its own paperwork to another workspace's
 * number and satisfy, or block, a compliance check belonging to a different
 * company. Measured on the running server before the fix: 201, and the row
 * landed.
 *
 * The shape generalises. A table that carries both `organization_id` and a
 * foreign key to another tenant-owned row has two ways to be read, and only
 * one of them is safe. This fails when a query filters on such a foreign key
 * without also constraining the organization.
 *
 * It reads SQL as text, so it is deliberately narrow: only the tables and
 * columns listed below, and only queries that mention the column. Being sure
 * about a few is worth more than guessing about all of them.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Tables whose foreign key is written from a request body without the owner
 * being checked first. A read on one of these has no earlier guard to lean
 * on, so an unscoped one is wrong on its own and this fails.
 */
const MUST_SCOPE = {
  kyc_documents: ['phone_number_id'],
};

/**
 * The same shape where the id is normally ownership-checked earlier in the
 * same handler — the campaign is fetched with its organization, the run is,
 * the queue is. Those reads are safe *because of that*, which no amount of
 * reading the SQL can see, so these are printed and never failed on. Moving a
 * table up to MUST_SCOPE is a decision somebody makes after checking its
 * callers, not something this script should guess.
 */
const WORTH_A_LOOK = {
  number_routes: ['number_id', 'agent_id', 'queue_id', 'campaign_id'],
  queue_members: ['queue_id', 'support_agent_id'],
  campaign_contacts: ['campaign_id', 'lead_id'],
  workflow_run_steps: ['run_id'],
};
const TENANT_KEYS = { ...MUST_SCOPE, ...WORTH_A_LOOK };

const files = execSync(
  "grep -rl 'kyc_documents\\|number_routes\\|queue_members\\|campaign_contacts\\|workflow_run_steps' app lib --include='*.ts' 2>/dev/null || true",
  { encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .filter(Boolean);

/**
 * Every SQL string in a file, as one blob per statement.
 *
 * Template literals and quoted strings both carry SQL here. A statement is
 * split on the keywords that start one so a file's many queries are judged
 * separately rather than as one soup that happens to contain the word
 * `organization_id` somewhere.
 */
function statementsIn(source) {
  // Comments first. `lib/kyc-documents.ts` describes the very bug this checks
  // for, in prose, and an apostrophe in "a number's documents" opened a quoted
  // string that swallowed the SQL beside it — the same false positive
  // check-sql-bindings had to learn about.
  source = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
  const literals = [
    ...source.matchAll(/`([^`]*)`/g),
    ...source.matchAll(/'((?:[^'\\\n]|\\.)*)'/g),
  ].map((match) => match[1]);
  return literals
    .filter((text) => /\b(SELECT|UPDATE|DELETE|INSERT)\b/i.test(text))
    .flatMap((text) => text.split(/(?=\bSELECT\b|\bUPDATE\b|\bDELETE\b)/i));
}

let checked = 0;
const problems = [];
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const statement of statementsIn(source)) {
    for (const [table, keys] of Object.entries(TENANT_KEYS)) {
      if (!new RegExp(`\\b${table}\\b`).test(statement)) continue;
      for (const key of keys) {
        // Only a statement that filters on the key, not one that selects it.
        if (!new RegExp(`\\b${key}\\s*=\\s*[?\\w.]`).test(statement)) continue;
        checked += 1;
        if (/organization_id/.test(statement)) continue;
        problems.push({
          file,
          table,
          key,
          statement: statement.replace(/\s+/g, ' ').trim().slice(0, 120),
        });
      }
    }
  }
}

const failures = problems.filter((problem) => problem.table in MUST_SCOPE);
const notes = problems.filter((problem) => !(problem.table in MUST_SCOPE));

if (failures.length) {
  console.error(
    `${failures.length} quer${failures.length === 1 ? 'y' : 'ies'} read a table keyed by an unvalidated id without an organization:`,
  );
  for (const problem of failures)
    console.error(
      `  ✗ ${problem.file}: ${problem.table}.${problem.key} — ${problem.statement}`,
    );
  process.exit(1);
}
console.log(
  `${checked} queries filter on a tenant-owned foreign key; ${Object.keys(MUST_SCOPE).join(', ')} all scoped.`,
);
if (notes.length)
  console.log(
    `note: ${notes.length} more read a tenant-owned id without an organization — safe only if the caller checked the owner first: ${[
      ...new Set(notes.map((problem) => `${problem.table}.${problem.key}`)),
    ].join(', ')}.`,
  );
