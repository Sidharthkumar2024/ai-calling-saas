/**
 * What a manual run has to be given, and what it cannot do.
 *
 * The failure this guards against is quiet in both directions: a name that is
 * read and never set is not asked for, so the run goes ahead with a hole in
 * it; and a name the workflow sets itself is asked for, so somebody types an
 * answer the next step immediately overwrites.
 */
import assert from 'node:assert/strict';

import * as inputs from '../lib/workflow-inputs.ts';

let checks = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks += 1;
};
const ok = (value, message) => {
  assert.ok(value, message);
  checks += 1;
};

const node = (id, kind, config, next = {}) => ({ id, kind, config, next });

// --- nothing to ask for -------------------------------------------------------

const plain = {
  nodes: [
    node('t', 'trigger', { event: 'inbound_call' }, { next: 'e' }),
    node('e', 'end', { disposition: 'done' }),
  ],
};
equal(inputs.inputsNeeded(plain), []);
equal(inputs.referencesIn(plain), []);
equal(inputs.producedBy(plain), []);

// --- read and never set -------------------------------------------------------

const reads = {
  nodes: [
    node('t', 'trigger', { event: 'webhook' }, { next: 'm' }),
    node(
      'm',
      'message',
      { channel: 'whatsapp', destination: '{{caller_phone}}', body: 'Your fee of {{fee}} is due.' },
      { next: 'e' },
    ),
    node('e', 'end', { disposition: 'sent' }),
  ],
};
equal(inputs.inputsNeeded(reads), ['caller_phone', 'fee']);

// --- what the workflow collects for itself is not asked for -------------------

const collects = {
  nodes: [
    node('t', 'trigger', { event: 'inbound_call' }, { next: 'q' }),
    node('q', 'ask', { question: 'Which area?', variable: 'area' }, { next: 's' }),
    node('s', 'say', { text: 'Looking at {{area}} for {{caller_name}}.' }, { next: 'e' }),
    node('e', 'end', { disposition: 'done' }),
  ],
};
equal(inputs.producedBy(collects), ['area']);
equal(inputs.inputsNeeded(collects), ['caller_name']);

// A name set by a *later* step is still the workflow's own. Asking for it would
// be asking somebody to do the workflow's job, and their answer would be
// overwritten before anything read it.
const setsLater = {
  nodes: [
    node('t', 'trigger', { event: 'inbound_call' }, { next: 's' }),
    node('s', 'say', { text: 'Noted {{area}}.' }, { next: 'q' }),
    node('q', 'ask', { question: 'Which area?', variable: 'area' }, { next: 'e' }),
    node('e', 'end', { disposition: 'done' }),
  ],
};
equal(inputs.inputsNeeded(setsLater), []);

// --- a lookup supplies every field under its name -----------------------------

const lookup = {
  nodes: [
    node('t', 'trigger', { event: 'inbound_call' }, { next: 'l' }),
    node('l', 'crm_lookup', { entity: 'lead', match: 'phone', value: '{{caller_phone}}', variable: 'lead' }, { next: 'c' }),
    node('c', 'condition', { expression: 'lead.score >= 60' }, { true: 'e', false: 'e' }),
    node('e', 'end', { disposition: 'done' }),
  ],
};
// `lead.score` is supplied by whatever set `lead`, so only the phone is missing.
equal(inputs.inputsNeeded(lookup), ['caller_phone']);

// --- conditions are read even written bare ------------------------------------

equal(inputs.conditionReference('lead.score >= 60'), 'lead');
equal(inputs.conditionReference('{{budget}} > 100'), 'budget');
equal(inputs.conditionReference('answer contains yes'), 'answer');
// Literals on the left name nothing.
equal(inputs.conditionReference('60 >= 40'), null);
equal(inputs.conditionReference('"yes" = yes'), null);
equal(inputs.conditionReference('no comparison here'), null);
equal(inputs.conditionReference(''), null);

// The bare form is the one that would have been missed, so it is worth its own
// assertion: without it the value the branch turns on is never asked for.
const bare = {
  nodes: [
    node('t', 'trigger', { event: 'webhook' }, { next: 'c' }),
    node('c', 'condition', { expression: 'group_size > 4' }, { true: 'e', false: 'e' }),
    node('e', 'end', { disposition: 'done' }),
  ],
};
equal(inputs.inputsNeeded(bare), ['group_size']);

// --- names are found wherever they are written --------------------------------

const nested = {
  nodes: [
    node('t', 'trigger', { event: 'webhook' }, { next: 'o' }),
    node('o', 'object_search', { object: 'flats', filters: ['area={{area}}', 'budget={{budget}}'], variable: 'matches' }, { next: 'e' }),
    node('e', 'end', { disposition: 'done', followUp: 'Send {{brochure}}' }),
  ],
};
equal(inputs.inputsNeeded(nested), ['area', 'brochure', 'budget']);
equal(inputs.producedBy(nested), ['matches']);

// --- what a manual run cannot do ----------------------------------------------

const mixed = {
  nodes: [
    node('t', 'trigger', { event: 'inbound_call' }, { next: 's' }),
    node('s', 'say', { text: 'One moment.' }, { next: 'q' }),
    node('q', 'ask', { question: 'Your budget?', variable: 'budget' }, { next: 'p' }),
    node('p', 'payment', { amount: '{{budget}}', purpose: 'Token', channel: 'whatsapp', destination: '{{caller_phone}}' }, { next: 'e' }),
    node('e', 'end', { disposition: 'done' }),
  ],
};
equal(inputs.spokenSteps(mixed).map((step) => step.id), ['s', 'q']);
equal(inputs.sideEffectSteps(mixed).map((step) => step.id), ['p']);

const note = inputs.manualRunNote(mixed);
equal(note.length, 2);
ok(note[0].includes('nobody on the line'), 'says why the spoken steps are skipped');
ok(note[1].includes('for real'), 'does not soften what the rest will do');
// An author's own name for a step is what they will look for in the trace.
const named = {
  nodes: [
    { id: 's', kind: 'say', name: 'Greeting', config: { text: 'Hello' }, next: {} },
  ],
};
equal(inputs.spokenSteps(named)[0].label, 'Greeting');
equal(inputs.spokenSteps(mixed)[0].label, 'Say');

// A workflow with nothing spoken and nothing outward says nothing rather than
// inventing a reassurance.
equal(inputs.manualRunNote(plain), []);

console.log(`workflow inputs: ${checks} assertions passed.`);
