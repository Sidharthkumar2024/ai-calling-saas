#!/usr/bin/env node
/**
 * Every tool an agent is told it has must exist.
 *
 * `schedule_follow_up` was written into every new agent's `tools_json` from the
 * beginning and never implemented, so a model that decided to schedule a
 * follow-up called a tool with no handler — the failure surfaced as a broken
 * turn, not as a missing feature, which is why it survived so long.
 *
 * Source-level rather than import-level: `lib/agent-tools.ts` pulls in the D1
 * binding and cannot be loaded outside the worker.
 */
import { readFileSync } from 'node:fs';

const toolsSrc = readFileSync('lib/agent-tools.ts', 'utf8');

const implemented = new Set(
  [...toolsSrc.matchAll(/^\s{4}name: '([a-z_]+)',$/gm)].map((m) => m[1]),
);
const handled = new Set(
  [...toolsSrc.matchAll(/name === '([a-z_]+)'/g)].map((m) => m[1]),
);

const DEFAULT_LISTS = [
  'app/api/auth/signup/route.ts',
  'app/api/app/agents/route.ts',
];

// A tool list is any JSON.stringify([...]) of bare identifiers that overlaps
// the implemented tool names. That distinguishes it from the extractions array
// sitting right beside it, which shares the same shape but none of the names.
const declared = new Map();
for (const file of DEFAULT_LISTS) {
  const src = readFileSync(file, 'utf8');
  for (const block of src.matchAll(/JSON\.stringify\(\[([\s\S]*?)\]\)/g)) {
    const entries = [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    if (!entries.length) continue;
    if (!entries.some((entry) => implemented.has(entry))) continue;
    for (const entry of entries) if (!declared.has(entry)) declared.set(entry, file);
  }
}

let failures = 0;
const report = (message) => {
  failures += 1;
  console.error(`  ❌ ${message}`);
};

if (!implemented.size) report('no tool definitions were found — the parser is wrong');
if (!declared.size)
  report('no default tool list was found — the parser is wrong, not the code');

for (const [tool, file] of declared) {
  if (!implemented.has(tool))
    report(`${file} offers "${tool}", which no tool definition declares`);
  else if (!handled.has(tool))
    report(`"${tool}" is declared but runTool has no branch for it`);
}
for (const tool of implemented) {
  if (!handled.has(tool)) report(`"${tool}" is declared but never handled`);
}

console.log(
  `${implemented.size} tools declared, ${handled.size} handled, ${declared.size} offered by default`,
);
if (failures) {
  console.error(`\n${failures} mismatch(es).`);
  process.exit(1);
}
console.log('every offered tool exists and is handled.');
