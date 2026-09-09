/**
 * Finds answers the server computes and no screen reads.
 *
 * The dialer worked out exactly why a campaign called nobody — no consent, on
 * the do-not-contact list, no calling connection live — returned it as
 * `dialer`, and the screen called the endpoint, ignored the body and refreshed
 * the list. Somebody pressed Start, watched the campaign turn running, and
 * waited. The answer existed and stopped one function short of the person who
 * could act on it.
 *
 * That is not a bug any test would fail on: the route is correct, the
 * component is correct, and the seam between them is empty. So this reads it
 * from the other side — every field a POST or PATCH hands back, checked
 * against whether any client file mentions it.
 *
 * Deliberately blunt, in the same way `check-actions` is: a field named
 * anywhere in any client file counts as read. That misses a field mentioned
 * but unused, and it will not invent one. What it catches is the shape that
 * actually happened — a name that appears nowhere a person could see it.
 *
 * Reported, not failed. Plenty of these are legitimate: the public API answers
 * machines, internal routes answer the scheduler, and some fields exist for a
 * webhook or a test. The list is short enough to read, which is the point —
 * `dialer` sat in it alone among the customer-facing action routes.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const list = (command) =>
  execSync(command, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);

const routes = list("find app/api -name route.ts 2>/dev/null");
const clientFiles = list(
  "find components app -name '*.tsx' -o -name '*.ts' 2>/dev/null",
).filter((file) => !file.startsWith('app/api/'));

const clientText = clientFiles
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

/** Fields every route answers with, and where. */
const answered = new Map();

/**
 * The keys of the object literal a `NextResponse.json({...})` returns.
 *
 * Only the top level, and only in the mutating handlers: a GET's payload is
 * read through a typed page prop and would be all false positives, while the
 * answer to a button press is the thing that goes missing.
 */
function keysOf(source) {
  const found = new Set();
  const mutating = /export async function (POST|PATCH|PUT|DELETE)\b/.exec(source);
  if (!mutating) return found;
  const body = source.slice(mutating.index);
  for (const match of body.matchAll(/NextResponse\.json\(\s*\{/g)) {
    let index = match.index + match[0].length - 1;
    let depth = 0;
    const start = index;
    for (; index < body.length; index += 1) {
      const ch = body[index];
      if (ch === '{' || ch === '[' || ch === '(') depth += 1;
      else if (ch === '}' || ch === ']' || ch === ')') {
        depth -= 1;
        if (!depth) break;
      }
    }
    const literal = body.slice(start + 1, index);
    // Top-level keys only: anything nested belongs to a value, not to the
    // shape a caller destructures.
    let level = 0;
    let inString = null;
    let token = '';
    for (let i = 0; i < literal.length; i += 1) {
      const ch = literal[i];
      if (inString) {
        if (ch === inString && literal[i - 1] !== '\\') inString = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
      if ('{[('.includes(ch)) { level += 1; continue; }
      if ('}])'.includes(ch)) { level -= 1; continue; }
      if (level > 0) continue;
      if (ch === ',') { token = ''; continue; }
      if (ch === ':') {
        const name = token.trim();
        if (/^[a-zA-Z_$][\w$]*$/.test(name)) found.add(name);
        token = '';
        continue;
      }
      token += ch;
    }
  }
  return found;
}

/** Names that say nothing on their own, so their absence says nothing either. */
const UNINFORMATIVE = new Set([
  'ok', 'error', 'status', 'id', 'success', 'message', 'updated', 'created',
  'deleted', 'removed', 'note', 'result', 'data', 'items', 'count', 'total',
]);

/** Routes that answer machines rather than screens. */
const NOT_FOR_SCREENS = [
  'app/api/public/',
  'app/api/internal/',
  'app/api/webhooks/',
  'app/api/v1/',
  'app/api/forms/',
  'app/api/widget/',
];

let checked = 0;
const unread = [];
for (const route of routes) {
  if (NOT_FOR_SCREENS.some((prefix) => route.startsWith(prefix))) continue;
  const keys = keysOf(readFileSync(route, 'utf8'));
  for (const key of keys) {
    if (UNINFORMATIVE.has(key)) continue;
    checked += 1;
    answered.set(key, route);
    // A word this specific appearing anywhere in any screen is enough: what
    // this looks for is a name no screen has ever heard of.
    if (!new RegExp(`\\b${key}\\b`).test(clientText))
      unread.push({ key, route });
  }
}

if (unread.length) {
  console.log('answers no screen reads:');
  for (const entry of unread)
    console.log(`  · ${entry.key} — returned by ${entry.route}`);
}
console.log(
  `${checked} answer fields checked across ${routes.length} routes, ${unread.length} read by no screen.`,
);
