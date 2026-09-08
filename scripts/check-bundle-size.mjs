/**
 * Keeps the portal from collapsing back into one download.
 *
 * Every screen used to be imported at the top of `customer-portal.tsx`, so
 * opening the product fetched all of them — 517 KB to look at the overview.
 * They are lazy now, and one accidental static import of a screen would put
 * the whole thing back without anything failing.
 *
 * So this reads the built client chunks and holds two lines: no single chunk
 * over the limit, and the portal's own chunk stays small. It runs only when a
 * build exists, because it is a check on output rather than on source.
 */
import { readdirSync, statSync, existsSync } from 'node:fs';

const DIR = 'dist/client/_next/static/chunks';
// Rolldown warns above 500 KB. The charting library is the one thing over it,
// and it is behind its own lazy boundary — named here rather than raising the
// limit for everything.
const LIMIT_KB = 500;
const PORTAL_LIMIT_KB = 120;

if (!existsSync(DIR)) {
  console.log('bundle size: no build to check (run `npm run build` first).');
  process.exit(0);
}

const chunks = readdirSync(DIR)
  .filter((file) => file.endsWith('.js'))
  .map((file) => ({ file, kb: statSync(`${DIR}/${file}`).size / 1024 }))
  .sort((a, b) => b.kb - a.kb);

const problems = [];
for (const chunk of chunks)
  if (chunk.kb > LIMIT_KB)
    problems.push(
      `${chunk.file} is ${Math.round(chunk.kb)} KB, over the ${LIMIT_KB} KB limit.`,
    );

const portal = chunks.find((chunk) => chunk.file.startsWith('customer-portal-'));
if (!portal) problems.push('No customer-portal chunk was built.');
else if (portal.kb > PORTAL_LIMIT_KB)
  problems.push(
    `customer-portal is ${Math.round(portal.kb)} KB. It holds the shell and the ` +
      `overview; over ${PORTAL_LIMIT_KB} KB means a screen is being imported ` +
      `statically again and everyone downloads it to look at something else.`,
  );

if (problems.length) {
  console.error('bundle size:');
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}

console.log(
  `bundle size: ${chunks.length} client chunks, largest ${Math.round(chunks[0].kb)} KB, ` +
    `portal shell ${Math.round(portal.kb)} KB.`,
);
