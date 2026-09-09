/**
 * The AI schema builder, run against a model that says whatever this test says.
 *
 * The point of the exercise is not that a good answer produces a good schema —
 * it is that a *bad* answer produces nothing dangerous. The model's reply is
 * untrusted input that arrives shaped like configuration: a made-up field type,
 * a key that is not a key, forty objects, a title field naming a column that
 * does not exist. Every one of those has to be dropped and named, because a
 * proposal that quietly loses half of itself is worse than one that fails.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import ts from 'typescript';

import * as objectEngine from '../lib/object-engine.ts';
import * as reasoningBudget from '../lib/reasoning-budget.ts';

let checks = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks += 1;
};
const ok = (value, message) => {
  assert.ok(value, message);
  checks += 1;
};

/** What the reasoning provider answers, or an error to throw instead. */
let answer = { text: '{}', model: 'test-model', stopReason: 'end_turn' };

const modules = {
  '@/lib/object-engine': objectEngine,
  '@/lib/reasoning-budget': reasoningBudget,
  '@/lib/provider-adapters': {
    reasonWithTools: async () => {
      if (answer instanceof Error) throw answer;
      return {
        content: [{ type: 'text', text: answer.text }],
        model: answer.model,
        stop_reason: answer.stopReason ?? 'end_turn',
      };
    },
  },
};

const builder = {};
compileFunction(
  ts.transpileModule(
    readFileSync(new URL('../lib/schema-builder.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  ['require', 'exports'],
)(
  (id) => {
    if (!modules[id]) throw Error(id);
    return modules[id];
  },
  builder,
);

const propose = (text, model = 'test-model', stopReason = 'end_turn') => {
  answer = { text, model, stopReason };
  return builder.proposeSchema({ organizationId: 'org_test', description: 'A business.' });
};

// --- an answer this engine can use --------------------------------------------

const good = await propose(JSON.stringify({
  objects: [
    {
      key: 'property',
      name: 'Property',
      plural_name: 'Properties',
      description: 'Flats and plots on the books.',
      title_field: 'title',
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'price', label: 'Price', type: 'currency', filterable: true, currency: 'INR' },
        { key: 'area', label: 'Locality', type: 'text', filterable: true },
      ],
    },
  ],
}));
ok(good.ok, 'a well-formed answer is a proposal');
equal(good.objects.length, 1);
equal(good.objects[0].key, 'property');
equal(good.objects[0].titleField, 'title');
equal(good.objects[0].fields.map((field) => field.key), ['title', 'price', 'area']);
equal(good.dropped, []);
// Which model said it. A proposal is somebody's opinion and the screen names it.
equal(good.model, 'test-model');

// --- a type this engine does not have -----------------------------------------

const badType = await propose(JSON.stringify({
  objects: [{
    name: 'Property',
    fields: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'rera', label: 'RERA number', type: 'government_id' },
    ],
  }],
}));
ok(badType.ok);
equal(badType.objects[0].fields.map((field) => field.key), ['title']);
ok(
  badType.dropped.some((line) => line.includes('government_id')),
  'names the type it could not use rather than dropping the field in silence',
);

// --- the model ignoring its own rules -----------------------------------------

// A summary field has no storage, so it cannot be filtered on however
// confidently the answer says it can.
const unfilterable = await propose(JSON.stringify({
  objects: [{
    name: 'Property',
    fields: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'long_text', filterable: true },
    ],
  }],
}));
const notes = unfilterable.objects[0].fields.find((field) => field.key === 'notes');
equal(notes.filterable, false);

// A title field naming a column that is not there falls back to a real text
// field rather than pointing at nothing.
const badTitle = await propose(JSON.stringify({
  objects: [{
    name: 'Property',
    title_field: 'headline',
    fields: [{ key: 'title', label: 'Title', type: 'text' }],
  }],
}));
equal(badTitle.objects[0].titleField, 'title');

// More than the ceiling is trimmed, not accepted.
const many = await propose(JSON.stringify({
  objects: Array.from({ length: 9 }, (unused, index) => ({
    name: `Object ${index}`,
    fields: [{ key: 'title', label: 'Title', type: 'text' }],
  })),
}));
equal(many.objects.length, 4);

const manyFields = await propose(JSON.stringify({
  objects: [{
    name: 'Property',
    fields: Array.from({ length: 40 }, (unused, index) => ({
      key: `f${index}`,
      label: `Field ${index}`,
      type: 'text',
    })),
  }],
}));
equal(manyFields.objects[0].fields.length, 20);

// Two fields that slugify to the same key are both kept, under different keys —
// one silently overwriting the other is how a schema loses a column.
const collide = await propose(JSON.stringify({
  objects: [{
    name: 'Property',
    fields: [
      { label: 'Price', type: 'text' },
      { label: 'price', type: 'text' },
    ],
  }],
}));
equal(collide.objects[0].fields.map((field) => field.key), ['price', 'price_2']);

// --- answers that are not proposals at all ------------------------------------

const prose = await propose('I would suggest a Property object with a few fields.');
equal(prose.ok, false);

const fenced = await propose('```json\n{"objects":[{"name":"Property","fields":[{"label":"Title","type":"text"}]}]}\n```');
ok(fenced.ok, 'a model that wraps its JSON in a fence anyway is still readable');

const empty = await propose(JSON.stringify({ objects: [] }));
equal(empty.ok, false);

// An object whose every field was unusable is not an object with no fields.
const noUsableFields = await propose(JSON.stringify({
  objects: [{ name: 'Property', fields: [{ label: 'RERA', type: 'government_id' }] }],
}));
equal(noUsableFields.ok, false);

// --- an answer this product cut off -------------------------------------------
//
// Truncated JSON fails to parse exactly like nonsense does, and the message
// used to blame the model for the size of the envelope it was posted in. The
// provider says which happened; this reads it.
const cutOff = await propose(
  '{"objects":[{"name":"Property","fields":[{"label":"Ti',
  'test-model',
  'max_tokens',
);
equal(cutOff.ok, false);
ok(
  cutOff.error.includes('cut off'),
  'says the answer ran out of room rather than calling it unreadable',
);
// And an answer that really is nonsense still says so.
const nonsense = await propose('not json at all', 'test-model', 'end_turn');
equal(nonsense.ok, false);
ok(cutOff.error !== nonsense.error, 'the two failures do not read the same');

// --- no provider --------------------------------------------------------------

answer = new Error('No reasoning provider is connected.');
const refused = await builder.proposeSchema({ organizationId: 'org_test', description: 'A business.' });
equal(refused.ok, false);
ok(
  refused.error.includes('No reasoning provider is connected.'),
  "carries the provider's own words instead of a generic failure",
);

console.log(`schema builder: ${checks} assertions passed; no provider contacted.`);
