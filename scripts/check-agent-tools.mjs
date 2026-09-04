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

/*
 * The catalogue the picker renders from, checked separately.
 *
 * This audit only ever looked at the two default lists, which is why the agent
 * studio got away with offering `send_email` and `create_ticket` — tools with
 * no definition and no handler — and with writing `transfer_human` for a tool
 * called `transfer_to_human`. Nothing read `tools_json`, so nothing failed.
 * Now that it filters, a name in the catalogue that is not a tool silently
 * removes a capability, so the catalogue is checked too.
 */
const catalogSrc = readFileSync('lib/agent-tool-catalog.ts', 'utf8');
const catalogNames = [
  ...catalogSrc.matchAll(/^\s{4}name: '([a-z_]+)',$/gm),
].map((m) => m[1]);
const mandatoryBlock = catalogSrc.match(
  /MANDATORY_TOOL_NAMES = \[([\s\S]*?)\]/,
);
const mandatoryNames = mandatoryBlock
  ? [...mandatoryBlock[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  : [];

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
    for (const entry of entries)
      if (!declared.has(entry)) declared.set(entry, file);
  }
}

let failures = 0;
const report = (message) => {
  failures += 1;
  console.error(`  ❌ ${message}`);
};

if (!implemented.size)
  report('no tool definitions were found — the parser is wrong');
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

if (!catalogNames.length)
  report('SELECTABLE_TOOLS could not be parsed — the parser is wrong');
if (!mandatoryNames.length)
  report('MANDATORY_TOOL_NAMES could not be parsed — the parser is wrong');

for (const tool of catalogNames)
  if (!implemented.has(tool))
    report(`SELECTABLE_TOOLS offers "${tool}", which no tool definition declares`);
for (const tool of mandatoryNames)
  if (!implemented.has(tool))
    report(`MANDATORY_TOOL_NAMES requires "${tool}", which does not exist`);

// A tool that is neither selectable nor mandatory can never reach a model,
// because `toolsForAgent` filters to the union of those two sets. It would be
// a handler nothing can call.
const reachable = new Set([...catalogNames, ...mandatoryNames]);
for (const tool of implemented)
  if (!reachable.has(tool))
    report(
      `"${tool}" is implemented but neither selectable nor mandatory, so no agent can ever call it`,
    );

// Overlap would put a tool in the picker that cannot be switched off.
for (const tool of mandatoryNames)
  if (catalogNames.includes(tool))
    report(`"${tool}" is both mandatory and selectable — the toggle would lie`);

console.log(
  `${implemented.size} tools declared, ${handled.size} handled, ` +
    `${catalogNames.length} selectable, ${mandatoryNames.length} mandatory, ` +
    `${declared.size} offered to new agents`,
);
if (failures) {
  console.error(`\n${failures} mismatch(es).`);
  process.exit(1);
}
console.log('every offered tool exists and is handled.');
