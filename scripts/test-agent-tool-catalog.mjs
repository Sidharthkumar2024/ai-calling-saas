import assert from 'node:assert/strict';

import {
  MANDATORY_TOOL_NAMES,
  SELECTABLE_TOOLS,
  TOOL_ALIASES,
  filterToolDefinitions,
  resolveToolSelection,
} from '../lib/agent-tool-catalog.ts';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

const names = (raw) => resolveToolSelection(raw).selected.sort();
const selectable = SELECTABLE_TOOLS.map((tool) => tool.name);

console.log('catalogue');

check('every selectable tool has a label and a note', () => {
  for (const tool of SELECTABLE_TOOLS) {
    assert.ok(tool.name, 'name');
    assert.ok(tool.label, `label for ${tool.name}`);
    assert.ok(tool.note, `note for ${tool.name}`);
  }
});

check('the picker has no duplicates', () => {
  assert.equal(new Set(selectable).size, selectable.length);
});

check('mandatory and selectable never overlap', () => {
  // A toggle for a tool that cannot be switched off is a lie in the UI.
  for (const tool of MANDATORY_TOOL_NAMES)
    assert.ok(!selectable.includes(tool), `${tool} is both`);
});

check('the escalation path and the exit are mandatory', () => {
  // <action_safety> orders the model to call these on the turn the caller asks.
  // A workspace unticking them would make that instruction a command to use a
  // tool the model does not have.
  for (const tool of ['transfer_to_human', 'request_refund', 'end_call'])
    assert.ok(MANDATORY_TOOL_NAMES.includes(tool), `${tool} must be mandatory`);
});

console.log('resolveToolSelection');

check('an empty selection means every tool, not none', () => {
  // The column defaults to '[]', so "nobody opened the picker" and "somebody
  // deselected everything" are the same value. Reading empty as none would
  // have lobotomised every existing agent the moment this filter went live.
  const all = names('[]');
  assert.equal(all.length, selectable.length + MANDATORY_TOOL_NAMES.length);
  assert.equal(resolveToolSelection('[]').defaulted, true);
  assert.deepEqual(names(null), all);
  assert.deepEqual(names(undefined), all);
  assert.deepEqual(names([]), all);
});

check('unparseable JSON is treated as unconfigured, not as empty', () => {
  assert.equal(resolveToolSelection('{oh dear').defaulted, true);
  assert.equal(resolveToolSelection('"a string"').defaulted, true);
  assert.equal(resolveToolSelection(7).defaulted, true);
});

check('a real selection is honoured', () => {
  const chosen = resolveToolSelection('["send_whatsapp","book_appointment"]');
  assert.equal(chosen.defaulted, false);
  assert.ok(chosen.selected.includes('send_whatsapp'));
  assert.ok(chosen.selected.includes('book_appointment'));
  assert.ok(!chosen.selected.includes('place_order'));
});

check('a selection cannot exclude a mandatory tool', () => {
  const chosen = resolveToolSelection('["send_whatsapp"]');
  for (const tool of MANDATORY_TOOL_NAMES)
    assert.ok(chosen.selected.includes(tool), `${tool} was excluded`);
});

check('the studio typo is repaired, not dropped', () => {
  // Every agent in the product carries `transfer_human`. Dropping it would
  // read as "this workspace turned transfer off"; the truth is the picker had
  // a typo and nothing ever read the list.
  const chosen = resolveToolSelection(
    '["send_whatsapp","book_appointment","transfer_human"]',
  );
  assert.ok(chosen.selected.includes('transfer_to_human'));
  assert.ok(!chosen.selected.includes('transfer_human'));
  assert.deepEqual(chosen.repaired, [
    { from: 'transfer_human', to: 'transfer_to_human' },
  ]);
});

check('names that were never tools are dropped and reported', () => {
  const chosen = resolveToolSelection(
    '["send_whatsapp","send_email","create_ticket"]',
  );
  assert.deepEqual(chosen.dropped.sort(), ['create_ticket', 'send_email']);
  assert.ok(chosen.selected.includes('send_whatsapp'));
});

check('an unknown name is dropped rather than passed to the model', () => {
  const chosen = resolveToolSelection(
    '["send_whatsapp","wire_transfer_funds"]',
  );
  assert.deepEqual(chosen.dropped, ['wire_transfer_funds']);
  assert.ok(!chosen.selected.includes('wire_transfer_funds'));
});

check('every alias resolves to a real tool or to nothing on purpose', () => {
  for (const [from, to] of Object.entries(TOOL_ALIASES)) {
    assert.ok(
      !selectable.includes(from),
      `${from} is a real tool, not an alias`,
    );
    if (to !== null)
      assert.ok(
        selectable.includes(to) || MANDATORY_TOOL_NAMES.includes(to),
        `${from} points at ${to}, which is not a tool`,
      );
  }
});

check('rubbish entries do not become tools', () => {
  const chosen = resolveToolSelection([
    null,
    42,
    '',
    '   ',
    {},
    'send_whatsapp',
  ]);
  assert.ok(chosen.selected.includes('send_whatsapp'));
  for (const name of chosen.selected) assert.equal(typeof name, 'string');
  assert.ok(!chosen.selected.includes(''));
});

check('duplicates in the stored list collapse', () => {
  const chosen = resolveToolSelection(
    '["send_whatsapp","send_whatsapp","transfer_human","transfer_to_human"]',
  );
  assert.equal(new Set(chosen.selected).size, chosen.selected.length);
});

check('a selection of only nonsense still leaves the escalation path', () => {
  // Not defaulted — the workspace did choose — but an agent that cannot
  // escalate or hang up is not something to ship.
  const chosen = resolveToolSelection('["send_email"]');
  assert.equal(chosen.defaulted, false);
  assert.deepEqual(chosen.selected.sort(), [...MANDATORY_TOOL_NAMES].sort());
});

console.log('filterToolDefinitions');

// Stand-ins for the real definitions, which live in a module that imports the
// D1 binding and cannot be loaded here.
const DEFS = [
  { name: 'send_whatsapp' },
  { name: 'book_appointment' },
  { name: 'place_order' },
  { name: 'transfer_to_human' },
  { name: 'request_refund' },
  { name: 'end_call' },
];
const given = (raw) =>
  filterToolDefinitions(DEFS, raw)
    .map((d) => d.name)
    .sort();

check('the model is handed only what the workspace selected', () => {
  // This is the whole point: before, every turn got all fifteen tools, so an
  // action switched off in the studio was still available on the call.
  assert.deepEqual(given('["send_whatsapp"]'), [
    'end_call',
    'request_refund',
    'send_whatsapp',
    'transfer_to_human',
  ]);
  assert.ok(!given('["send_whatsapp"]').includes('place_order'));
});

check('an unconfigured agent is handed everything it was before', () => {
  assert.deepEqual(given('[]'), DEFS.map((d) => d.name).sort());
});

check('the repaired name selects the real tool', () => {
  assert.ok(given('["transfer_human"]').includes('transfer_to_human'));
});

check('a definition with no usable name is never handed over', () => {
  const odd = [{ name: {} }, { name: 42 }, {}, { name: 'send_whatsapp' }];
  assert.deepEqual(filterToolDefinitions(odd, '["send_whatsapp"]'), [
    { name: 'send_whatsapp' },
  ]);
});

check('no definitions is survivable', () => {
  assert.deepEqual(filterToolDefinitions([], '["send_whatsapp"]'), []);
  assert.deepEqual(filterToolDefinitions(null, '[]'), []);
});

console.log(`\n${passed} assertions passed.`);
