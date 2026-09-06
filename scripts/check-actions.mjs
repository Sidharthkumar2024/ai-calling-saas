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
for (const file of routes) {
  const source = readFileSync(file, 'utf8');
  namedIn.set(
    file,
    new Set([...source.matchAll(/'([a-z_0-9]{2,})'/g)].map((m) => m[1])),
  );
}
const namedAnywhere = new Set([...namedIn.values()].flatMap((set) => [...set]));

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

for (const file of clients) {
  const source = readFileSync(file, 'utf8');
  const endpoints = endpointsFor(source);
  const candidates = new Set(
    endpoints.flatMap((endpoint) => routeFilesFor(endpoint)),
  );
  for (const match of source.matchAll(/action: '([a-z_0-9]{2,})'/g)) {
    const action = match[1];
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

// Informational: capability with no way to reach it.
const unreachable = [...namedAnywhere].filter(
  (action) =>
    !sent.has(action) &&
    /^(create|update|delete|set|archive|restore|release|cancel|approve|reject)_/.test(
      action,
    ),
);
if (unreachable.length > 0)
  console.log(
    `note: ${unreachable.length} action-shaped names no screen sends (${unreachable.slice(0, 6).join(', ')}${unreachable.length > 6 ? ', …' : ''}) — some are the public API, some are screens nobody built.`,
  );

console.log(
  `${routes.length} routes and ${clients.length} client files checked, ${sent.size} actions sent, ${findings.length} unhandled`,
);
if (findings.length > 0) process.exitCode = 1;
