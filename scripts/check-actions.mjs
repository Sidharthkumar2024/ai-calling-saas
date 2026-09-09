/**
 * Finds buttons that send an action the server has never heard of.
 *
 * Three of these turned up by hand in one week, and each one only showed as
 * "nothing happened when I clicked it":
 *
 * - The agent studio wrote `transfer_human` where the tool is
 *   `transfer_to_human`, so ticking the box selected a tool that did not exist.
 * - `create_department` was handled by the API and rendered by no screen, so
 *   the capability existed and could not be reached.
 * - The CRM's bulk endpoint dispatched `assign_owner` and `move_stage`
 *   explicitly and put **archive in the `else`** — so any action it did not
 *   recognise, including a typo or an older client, silently archived every
 *   selected lead. The most destructive branch was the one you reached by
 *   accident.
 *
 * The check is deliberately blunt: an action a component sends must appear
 * *somewhere* in the route it is posted to. That covers `body.action === 'x'`,
 * `body.action !== 'x'`, a `case 'x'`, and a `action?: 'x' | 'y'` union — all
 * four spellings are in this codebase — while still catching a name the route
 * has never heard of, which is the failure worth catching.
 *
 * The reverse direction is reported but does not fail: an action the API
 * handles and no screen sends is often deliberate (the public API, the
 * internal job routes), and sometimes a screen that was never built.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const list = (command) =>
  execSync(command, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);

const routes = list(
  "grep -rl 'action' app/api --include='route.ts' 2>/dev/null",
);
const clients = list(
  "grep -rlE \"action: '\" components app --include='*.tsx' --include='*.ts' 2>/dev/null",
);

/** Every literal a route file mentions, whatever the comparison. */
const namedIn = new Map();
/**
 * Names a route actually *dispatches on*, as opposed to every string in it.
 *
 * `namedIn` stays blunt — any quoted string counts — because for the failing
 * direction over-matching is safe: it can only stop this from crying wolf about
 * a button whose action the route does name. The note below is the opposite
 * case, and bluntness there put `create_` in front of a reader as a screen
 * nobody built. It came from `action.replace('create_', '')`.
 */
const dispatchedIn = new Set();
for (const file of routes) {
  const source = readFileSync(file, 'utf8');
  namedIn.set(
    file,
    new Set([...source.matchAll(/'([a-z_0-9]{2,})'/g)].map((m) => m[1])),
  );
  const patterns = [
    /\baction\s*(?:===|!==|==|!=)\s*'([a-z_0-9]{2,})'/g,
    /'([a-z_0-9]{2,})'\s*(?:===|!==|==|!=)\s*\w*\.?action\b/g,
    /\bcase\s+'([a-z_0-9]{2,})'/g,
    /\baction\??:\s*((?:'[a-z_0-9]{2,}'\s*\|\s*)*'[a-z_0-9]{2,}')/g,
    /\[([^\]]*)\]\s*\.includes\(\s*(?:String\()?\w*\.?action/g,
  ];
  for (const pattern of patterns)
    for (const match of source.matchAll(pattern))
      for (const literal of match[1].matchAll(/'?([a-z_0-9]{2,})'?/g))
        if (/^[a-z][a-z_0-9]*$/.test(literal[1])) dispatchedIn.add(literal[1]);
}
const namedAnywhere = dispatchedIn;

/**
 * Which endpoint a send belongs to.
 *
 * A component may talk to several routes, so the nearest preceding `fetch` is
 * the one that matters. Falling back to "any route" when none is found keeps
 * this from inventing failures out of a pattern it could not parse.
 */
function endpointsFor(source) {
  return [...source.matchAll(/['"`](\/api\/[a-z0-9\-_/[\]$.{}]+)['"`]/g)].map(
    (match) => match[1],
  );
}

function routeFilesFor(endpoint) {
  // `/api/app/crm` -> `app/api/app/crm/route.ts`. Dynamic segments in the URL
  // are template holes, so anything with `${` matches on its literal prefix.
  const clean = endpoint.split('?')[0].replace(/\$\{[^}]*\}/g, '*');
  const parts = clean.split('/').filter(Boolean);
  const matches = [];
  for (const file of routes) {
    const asPath = file.replace(/^app\//, '').replace(/\/route\.ts$/, '');
    const segments = asPath.split('/').filter(Boolean);
    if (segments.length < parts.length) continue;
    const fits = parts.every((part, index) => {
      const segment = segments[index];
      if (segment === undefined) return false;
      if (part === '*') return true;
      return segment === part || segment.startsWith('[');
    });
    if (fits) matches.push(file);
  }
  return matches;
}

const findings = [];
const sent = new Set();

/**
 * Every action name a client file sends.
 *
 * `action: 'x'` is the common shape, but not the only one. An archive button
 * picks its action with a ternary — `action: archived ? 'restore_config' :
 * 'archive_config'` — and a scan that only matched a literal after the colon
 * saw neither, then reported both as actions no screen sends. Two real,
 * working buttons listed as unbuilt screens; the note is only useful if what
 * is in it is actually missing.
 *
 * So: take the literal after `action:`, and also every string literal in the
 * expression that follows it up to the end of that property. Over-reading a
 * string that happens to sit in the same expression is the safe direction —
 * it can only remove a name from the "nobody sends this" note, never add a
 * false "unhandled" failure, because those are checked against the route.
 */
function actionsSentIn(source) {
  const found = new Set();
  for (const match of source.matchAll(/action:\s*/g)) {
    const start = match.index + match[0].length;
    // The property ends at the comma or brace that closes it. Quotes are
    // skipped over so a comma inside a string does not end it early.
    let depth = 0;
    let quote = null;
    let end = start;
    while (end < source.length) {
      const char = source[end];
      if (quote) {
        if (char === '\\') end += 1;
        else if (char === quote) quote = null;
      } else if (char === "'" || char === '"' || char === '`') quote = char;
      else if ('([{'.includes(char)) depth += 1;
      else if (')]}'.includes(char)) {
        if (depth === 0) break;
        depth -= 1;
      } else if (char === ',' && depth === 0) break;
      else if (char === '\n' && depth === 0 && source[end - 1] !== '?') {
        // A bare newline ends a one-line property; a dangling `?` means the
        // ternary continues onto the next line.
      }
      end += 1;
    }
    const expression = source.slice(start, end);
    for (const literal of expression.matchAll(/'([a-z_0-9]{2,})'/g))
      found.add(literal[1]);
  }
  return found;
}

for (const file of clients) {
  const source = readFileSync(file, 'utf8');
  const endpoints = endpointsFor(source);
  const candidates = new Set(
    endpoints.flatMap((endpoint) => routeFilesFor(endpoint)),
  );
  for (const action of actionsSentIn(source)) {
    sent.add(action);
    // No endpoint this scan could resolve: say nothing rather than guess.
    if (candidates.size === 0) continue;
    const known = [...candidates].some((route) =>
      namedIn.get(route)?.has(action),
    );
    if (!known)
      findings.push({
        action,
        file,
        routes: [...candidates].join(', ') || '(none resolved)',
      });
  }
}

for (const finding of findings)
  console.error(
    `UNHANDLED  '${finding.action}' sent from ${finding.file} — not named in ${finding.routes}. Clicking it does nothing, or falls into whatever that route's default branch does.`,
  );

/**
 * Informational: a capability with no way to reach it.
 *
 * This used to consider only names starting create/update/delete/set/archive/
 * restore/release/cancel/approve/reject, which was meant to cut noise and
 * instead hid the interesting half. `submit_consent` and `withdraw_consent`
 * — the record of somebody agreeing to have their voice cloned, and their
 * right to take that back — were handled by the API, reachable from no screen,
 * and named by nothing here for as long as this check has existed.
 *
 * Every dispatched name is considered now. The list is longer and worth
 * reading.
 */
const unreachable = [...namedAnywhere]
  .filter((action) => !sent.has(action))
  // `action?: string` in a request type is a type, not an action name.
  .filter((action) => action !== 'string');
if (unreachable.length > 0)
  console.log(
    `note: ${unreachable.length} actions the API handles and no screen sends (${unreachable.join(', ')}) — some are the public API, some are capabilities nobody can reach.`,
  );

console.log(
  `${routes.length} routes and ${clients.length} client files checked, ${sent.size} actions sent, ${findings.length} unhandled`,
);
if (findings.length > 0) process.exitCode = 1;
