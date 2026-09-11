import assert from 'node:assert/strict';

import {
  NODE_SPECS,
  NODE_KINDS,
  branchesOf,
  compileCallPlan,
  evaluateCondition,
  interpolate,
  readPath,
  layoutGraph,
  reachableFrom,
  triggerEventOf,
  cyclesIn,
  validateWorkflow,
} from '../lib/workflow-nodes.ts';
import { WORKFLOW_TEMPLATES, templateByKey } from '../lib/workflow-templates.ts';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

const node = (id, kind, config = {}, next = {}) => ({ id, kind, config, next });

/** The smallest graph that publishes: trigger → say → end. */
const workingGraph = () => ({
  nodes: [
    node('t', 'trigger', { event: 'inbound_call' }, { next: 's' }),
    node('s', 'say', { text: 'Hello.' }, { next: 'e' }),
    node('e', 'end', { disposition: 'done' }, {}),
  ],
});

console.log('the catalogue');

check('every kind in the list has a spec, and every spec is in the list', () => {
  for (const kind of NODE_KINDS) assert.ok(NODE_SPECS[kind], `${kind} has no spec`);
  assert.deepEqual(Object.keys(NODE_SPECS).sort(), [...NODE_KINDS].sort());
});

check('every spec names its purpose and its exits', () => {
  for (const spec of Object.values(NODE_SPECS)) {
    assert.ok(spec.purpose.length > 10, `${spec.kind} has no purpose`);
    assert.ok(spec.branches === 'dynamic' || Array.isArray(spec.branches));
  }
});

check('End is the only kind with no exit', () => {
  const noExit = Object.values(NODE_SPECS).filter(
    (spec) => spec.branches !== 'dynamic' && spec.branches.length === 0,
  );
  assert.deepEqual(noExit.map((spec) => spec.kind), ['end']);
});

check('an AI decision’s exits come from its own outcomes', () => {
  const decision = node('d', 'ai_decision', {
    instruction: 'Which?',
    outcomes: ['Ready to buy', 'Just looking'],
  });
  assert.deepEqual(branchesOf(decision), ['ready_to_buy', 'just_looking']);
});

check('outcomes may be typed as one block of text', () => {
  const decision = node('d', 'ai_decision', { instruction: 'x', outcomes: 'price\ntiming' });
  assert.deepEqual(branchesOf(decision), ['price', 'timing']);
});

check('duplicate outcomes collapse rather than making two identical exits', () => {
  const decision = node('d', 'ai_decision', { instruction: 'x', outcomes: ['Price', 'price'] });
  assert.deepEqual(branchesOf(decision), ['price']);
});

console.log('\nvalidation — a workflow that cannot run must not save');

check('the smallest working graph publishes', () => {
  const result = validateWorkflow(workingGraph(), { mode: 'publish' });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.warnings.length, 0);
});

check('an empty graph is refused', () => {
  const result = validateWorkflow({ nodes: [] });
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /no steps/);
});

check('no trigger is refused', () => {
  const graph = workingGraph();
  graph.nodes = graph.nodes.filter((entry) => entry.kind !== 'trigger');
  const result = validateWorkflow(graph);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((issue) => /starts with a Trigger/.test(issue.message)));
});

check('two triggers are refused', () => {
  const graph = workingGraph();
  graph.nodes.push(node('t2', 'trigger', { event: 'webhook' }, { next: 'e' }));
  const result = validateWorkflow(graph);
  assert.ok(result.errors.some((issue) => /one Trigger/.test(issue.message)));
});

check('a required field left empty names the field', () => {
  const graph = workingGraph();
  graph.nodes[1].config = { text: '   ' };
  const result = validateWorkflow(graph);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((issue) => issue.nodeId === 's' && /required/.test(issue.message)));
});

check('an exit pointing at a step that does not exist is refused', () => {
  const graph = workingGraph();
  graph.nodes[1].next = { next: 'ghost' };
  const result = validateWorkflow(graph);
  assert.ok(result.errors.some((issue) => /does not exist/.test(issue.message)));
});

check('an unwired exit blocks publishing but only warns on a draft', () => {
  const graph = workingGraph();
  graph.nodes[1].next = {};
  assert.equal(validateWorkflow(graph, { mode: 'publish' }).ok, false);
  const draft = validateWorkflow(graph, { mode: 'draft' });
  assert.equal(draft.ok, true);
  assert.ok(draft.warnings.some((issue) => /not wired/.test(issue.message)));
});

check('a step the trigger can never reach is reported', () => {
  const graph = workingGraph();
  graph.nodes.push(node('orphan', 'say', { text: 'nobody hears this' }, { next: 'e' }));
  const result = validateWorkflow(graph, { mode: 'publish' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((issue) => issue.nodeId === 'orphan' && /never be reached/.test(issue.message)));
});

check('an AI decision with one outcome is refused — there is nothing to choose', () => {
  const graph = {
    nodes: [
      node('t', 'trigger', { event: 'inbound_call' }, { next: 'd' }),
      node('d', 'ai_decision', { instruction: 'x', outcomes: ['only'] }, { only: 'e' }),
      node('e', 'end', { disposition: 'done' }, {}),
    ],
  };
  const result = validateWorkflow(graph);
  assert.ok(result.errors.some((issue) => /at least two outcomes/.test(issue.message)));
});

console.log('\nthe rule that catches the real mistake: nobody is on the line');

check('Ask is refused in a scheduled workflow, by name', () => {
  const graph = {
    nodes: [
      node('t', 'trigger', { event: 'scheduled' }, { next: 'a' }),
      node('a', 'ask', { question: 'Which day?', variable: 'day' }, { next: 'e' }),
      node('e', 'end', { disposition: 'done' }, {}),
    ],
  };
  const result = validateWorkflow(graph);
  assert.equal(result.ok, false);
  const issue = result.errors.find((entry) => entry.nodeId === 'a');
  assert.match(issue.message, /needs somebody on the line/);
  assert.match(issue.message, /scheduled/);
});

check('the same Ask is fine on an inbound call', () => {
  const graph = {
    nodes: [
      node('t', 'trigger', { event: 'inbound_call' }, { next: 'a' }),
      node('a', 'ask', { question: 'Which day?', variable: 'day' }, { next: 'e' }),
      node('e', 'end', { disposition: 'done' }, {}),
    ],
  };
  assert.equal(validateWorkflow(graph).ok, true);
});

check('a webhook workflow may still send a message — that needs no caller', () => {
  const graph = {
    nodes: [
      node('t', 'trigger', { event: 'webhook' }, { next: 'm' }),
      node('m', 'message', { channel: 'whatsapp', body: 'Your order shipped.' }, { next: 'e' }),
      node('e', 'end', { disposition: 'notified' }, {}),
    ],
  };
  assert.equal(validateWorkflow(graph).ok, true);
});

console.log('\nloops');

check('a loop of conditions alone can never exit, and is refused', () => {
  const graph = {
    nodes: [
      node('t', 'trigger', { event: 'inbound_call' }, { next: 'c1' }),
      node('c1', 'condition', { expression: 'a = 1' }, { true: 'c2', false: 'e' }),
      node('c2', 'condition', { expression: 'b = 1' }, { true: 'c1', false: 'e' }),
      node('e', 'end', { disposition: 'done' }, {}),
    ],
  };
  assert.equal(cyclesIn(graph).length, 1);
  const result = validateWorkflow(graph);
  assert.ok(result.errors.some((issue) => /loop back into each other/.test(issue.message)));
});

// These two used to assert the opposite: that a loop through an Ask or an
// Approval is fine because the step waits for something new. It is true the
// first time round and false the second — a revisited Ask already holds its
// answer and completes without asking, a revisited Approval already holds its
// decision — so the loop closes with nothing new in it and the run spins to
// the step budget, sending whatever is inside the loop each lap.
check('a loop back into an Ask is refused: it does not ask again', () => {
  const graph = {
    nodes: [
      node('t', 'trigger', { event: 'inbound_call' }, { next: 'q' }),
      node('q', 'ask', { question: 'Which day?', variable: 'day' }, { next: 'c' }),
      node('c', 'condition', { expression: 'day != ' }, { true: 'e', false: 'q' }),
      node('e', 'end', { disposition: 'done' }, {}),
    ],
  };
  assert.equal(cyclesIn(graph).length, 1);
  const result = validateWorkflow(graph);
  assert.equal(result.ok, false);
  // The error says what to do instead of only what is wrong.
  assert.ok(result.errors.some((issue) => /another Ask/.test(issue.message)));
});

check('a loop back into an Approval is refused for the same reason', () => {
  const graph = {
    nodes: [
      node('t', 'trigger', { event: 'webhook' }, { next: 'a' }),
      node('a', 'approval', { action: 'discount' }, { approved: 'e', rejected: 'c' }),
      node('c', 'condition', { expression: 'retry = yes' }, { true: 'a', false: 'e' }),
      node('e', 'end', { disposition: 'done' }, {}),
    ],
  };
  assert.equal(cyclesIn(graph).length, 1);
  assert.equal(validateWorkflow(graph).ok, false);
});

// Forward-only graphs are untouched: this is about edges pointing backwards,
// not about two branches meeting again further down.
check('two branches that meet again further on are not a loop', () => {
  const graph = {
    nodes: [
      node('t', 'trigger', { event: 'inbound_call' }, { next: 'c' }),
      node('c', 'condition', { expression: 'score > 50' }, { true: 's1', false: 's2' }),
      node('s1', 'say', { text: 'High' }, { next: 'e' }),
      node('s2', 'say', { text: 'Low' }, { next: 'e' }),
      node('e', 'end', { disposition: 'done' }, {}),
    ],
  };
  assert.deepEqual(cyclesIn(graph), []);
  assert.equal(validateWorkflow(graph).ok, true);
});

console.log('\nreachability and layout');

check('reachable follows wired branches only', () => {
  const graph = workingGraph();
  graph.nodes[0].next = {};
  assert.deepEqual([...reachableFrom(graph, 't')], ['t']);
});

check('the trigger event is read back, and an unknown one is not', () => {
  assert.equal(triggerEventOf(workingGraph()), 'inbound_call');
  const graph = workingGraph();
  graph.nodes[0].config.event = 'telepathy';
  assert.equal(triggerEventOf(graph), null);
});

check('layout puts each step one column past the one that leads to it', () => {
  const positions = layoutGraph(workingGraph());
  const column = Object.fromEntries(positions.map((entry) => [entry.id, entry.column]));
  assert.deepEqual(column, { t: 0, s: 1, e: 2 });
});

check('two branches of one step share a column and take separate rows', () => {
  const graph = {
    nodes: [
      node('t', 'trigger', { event: 'inbound_call' }, { next: 'c' }),
      node('c', 'condition', { expression: 'x = 1' }, { true: 'a', false: 'b' }),
      node('a', 'say', { text: 'yes' }, { next: 'e' }),
      node('b', 'say', { text: 'no' }, { next: 'e' }),
      node('e', 'end', { disposition: 'done' }, {}),
    ],
  };
  const positions = Object.fromEntries(layoutGraph(graph).map((entry) => [entry.id, entry]));
  assert.equal(positions.a.column, positions.b.column);
  assert.notEqual(positions.a.row, positions.b.row);
});

check('an unreachable step is still given a place on the canvas', () => {
  const graph = workingGraph();
  graph.nodes.push(node('orphan', 'say', { text: 'x' }, {}));
  const positions = layoutGraph(graph);
  assert.equal(positions.length, 4);
  assert.ok(positions.every((entry) => Number.isInteger(entry.column)));
});

console.log('\nthe §7.1 templates — every one of them has to publish');

check('there are six, each with a distinct key', () => {
  assert.equal(WORKFLOW_TEMPLATES.length, 6);
  assert.equal(new Set(WORKFLOW_TEMPLATES.map((entry) => entry.key)).size, 6);
});

for (const template of WORKFLOW_TEMPLATES) {
  check(`${template.key} publishes with no errors and no loose ends`, () => {
    const result = validateWorkflow(template.graph, { mode: 'publish' });
    assert.equal(
      result.ok,
      true,
      `${template.key}: ${result.errors.map((issue) => `${issue.nodeId}: ${issue.message}`).join(' | ')}`,
    );
    assert.equal(result.warnings.length, 0, JSON.stringify(result.warnings));
  });
}

check('every template path ends at an End step', () => {
  for (const template of WORKFLOW_TEMPLATES) {
    const ends = template.graph.nodes.filter((entry) => entry.kind === 'end');
    assert.ok(ends.length >= 1, template.key);
    const reachable = reachableFrom(template.graph, 'start');
    assert.ok(
      ends.some((entry) => reachable.has(entry.id)),
      `${template.key} cannot reach any End`,
    );
  }
});

check('templates are looked up by key, and an unknown key is null not a guess', () => {
  assert.equal(templateByKey('sales').name, 'Sales qualification');
  assert.equal(templateByKey('nonesuch'), null);
});

console.log('\ninterpolation');

check('a known variable is filled in', () => {
  assert.equal(interpolate('Hello {{name}}', { name: 'Asha' }), 'Hello Asha');
});

check('a dotted path reads into a record', () => {
  assert.equal(interpolate('Score {{lead.score}}', { lead: { score: 72 } }), 'Score 72');
});

check('a missing variable is left visible, not blanked out', () => {
  // "Confirmed for " reads as a finished sentence and hides the loss.
  assert.equal(
    interpolate('Confirmed for {{slot}}', {}),
    'Confirmed for {{slot}}',
  );
});

check('a list interpolates as its count', () => {
  assert.equal(interpolate('{{matches}} options', { matches: [1, 2, 3] }), '3 options');
});

check('readPath does not walk into a non-object', () => {
  assert.equal(readPath({ lead: 'text' }, 'lead.score'), undefined);
});

console.log('\nconditions');

check('a numeric comparison', () => {
  assert.equal(evaluateCondition('lead.score >= 60', { lead: { score: 72 } }).value, true);
  assert.equal(evaluateCondition('lead.score >= 60', { lead: { score: 12 } }).value, false);
});

check('numbers written as text still compare as numbers', () => {
  assert.equal(evaluateCondition('experience >= 2', { experience: '5' }).value, true);
});

check('a word comparison is case-insensitive', () => {
  assert.equal(evaluateCondition('consent = yes', { consent: 'Yes' }).value, true);
});

check('contains works on text', () => {
  assert.equal(
    evaluateCondition('need contains apartment', { need: 'a 2 BHK Apartment' }).value,
    true,
  );
});

check('a value never collected is false AND says it was missing', () => {
  // The distinction that matters: "we never asked" is not "the score is low".
  const verdict = evaluateCondition('lead.score >= 60', {});
  assert.equal(verdict.value, false);
  assert.equal(verdict.missing, true);
  assert.match(verdict.explain, /no value in this run/);
});

check('a low score is false but not missing', () => {
  const verdict = evaluateCondition('lead.score >= 60', { lead: { score: 10 } });
  assert.equal(verdict.value, false);
  assert.equal(verdict.missing, false);
});

check('an expression with no comparison in it is refused rather than guessed', () => {
  const verdict = evaluateCondition('lead is good', {});
  assert.equal(verdict.value, false);
  assert.equal(verdict.missing, true);
});

check('the explanation names both sides, so a run is auditable', () => {
  const verdict = evaluateCondition('consent = yes', { consent: 'no' });
  assert.match(verdict.explain, /consent/);
  assert.match(verdict.explain, /false/);
});

console.log('\nthe live-call plan');

check('a plan lists the steps in order and names what to collect', () => {
  const plan = compileCallPlan(templateByKey('receptionist').graph);
  assert.ok(plan.steps.length > 4);
  assert.ok(plan.collect.includes('service'));
  assert.ok(plan.collect.includes('preferred_slot'));
});

check('steps that map to a tool carry the tool name', () => {
  const plan = compileCallPlan(templateByKey('sales').graph);
  const payment = plan.steps.find((step) => step.nodeId === 'payment');
  assert.equal(payment.tool, 'create_payment_link');
  const transfer = plan.steps.find((step) => step.nodeId === 'handoff');
  assert.equal(transfer.tool, 'transfer_to_human');
});

check('a step with no matching tool is named in the notes, not dropped', () => {
  const plan = compileCallPlan(templateByKey('sales').graph);
  assert.ok(plan.notes.some((note) => /approval/i.test(note)));
});

check('the plan visits every reachable step once, loops included', () => {
  const plan = compileCallPlan(templateByKey('receptionist').graph);
  const ids = plan.steps.map((step) => step.nodeId);
  assert.equal(new Set(ids).size, ids.length);
});

console.log(`\n${passed} assertions passed.`);
