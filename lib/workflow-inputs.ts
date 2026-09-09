/**
 * What a run has to be given before it can do anything.
 *
 * A workflow reads values it never collects itself: `{{caller_phone}}` comes
 * from the call, `{{fee}}` from whatever triggered it. Started for real, those
 * arrive with the trigger. Started by hand from the builder, nothing supplies
 * them — and a step whose value is missing does not fail loudly, it goes on
 * with the placeholder still in the sentence or skips with "no value in this
 * run". So a manual run of a real workflow was a page of skipped steps that
 * told you nothing about the workflow.
 *
 * This works out which names are read and never set, so the person starting
 * the run can be asked for exactly those and no more.
 */
import {
  CONDITION_OPERATORS,
  NODE_SPECS,
  textValue,
  type WorkflowGraph,
  type WorkflowNode,
} from './workflow-nodes.ts';

/** `lead.score` is supplied by whatever sets `lead`. */
function rootOf(path: string): string {
  return path.split('.')[0]?.trim() ?? '';
}

const REFERENCE = /\{\{\s*([\w.]+)\s*\}\}/g;

function stringsIn(value: unknown, into: string[]): string[] {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value))
    for (const item of value) stringsIn(item, into);
  else if (value && typeof value === 'object')
    for (const item of Object.values(value as Record<string, unknown>))
      stringsIn(item, into);
  return into;
}

/**
 * The left side of a condition names something the run collected, and it is
 * written bare as often as in braces — `lead.score >= 60`. Reading only the
 * braced form would leave the one value the branch turns on unasked for.
 */
export function conditionReference(expression: string): string | null {
  const raw = String(expression ?? '').trim();
  if (!raw) return null;
  let index = -1;
  for (const candidate of CONDITION_OPERATORS) {
    const found =
      candidate === 'contains'
        ? raw.toLowerCase().indexOf(' contains ')
        : raw.indexOf(candidate);
    if (found > 0) {
      index = found;
      break;
    }
  }
  if (index < 0) return null;
  const bare = raw
    .slice(0, index)
    .trim()
    .replace(/^\{\{\s*|\s*\}\}$/g, '')
    .trim();
  if (!bare) return null;
  // A number or a quoted word on the left is a literal, not a name.
  if (/^-?\d+(\.\d+)?$/.test(bare)) return null;
  if (/^"(.*)"$/.test(bare) || /^'(.*)'$/.test(bare)) return null;
  if (!/^[\w.]+$/.test(bare)) return null;
  return rootOf(bare);
}

/** Every name the graph reads, whatever sets it. */
export function referencesIn(graph: WorkflowGraph): string[] {
  const found = new Set<string>();
  for (const node of graph.nodes ?? []) {
    for (const text of stringsIn(node.config ?? {}, []))
      for (const match of text.matchAll(REFERENCE)) {
        const root = rootOf(match[1]);
        if (root) found.add(root);
      }
    if (node.kind === 'condition') {
      const named = conditionReference(
        textValue((node.config ?? {}).expression),
      );
      if (named) found.add(named);
    }
  }
  return [...found].sort();
}

/** The three kinds that write a name back into the run. */
const WRITES_VARIABLE = ['ask', 'crm_lookup', 'object_search'];

export function producedBy(graph: WorkflowGraph): string[] {
  const found = new Set<string>();
  for (const node of graph.nodes ?? []) {
    if (!WRITES_VARIABLE.includes(node.kind)) continue;
    const name = rootOf(textValue((node.config ?? {}).variable));
    if (name) found.add(name);
  }
  return [...found].sort();
}

/**
 * Read and never set — so nothing in the workflow can produce it and the run
 * has to be handed it. Order is not considered: a name set by a later step is
 * still the workflow's own, and asking for it would be asking somebody to do
 * the workflow's job.
 */
export function inputsNeeded(graph: WorkflowGraph): string[] {
  const produced = new Set(producedBy(graph));
  return referencesIn(graph).filter((name) => !produced.has(name));
}

export type SkippedStep = { id: string; kind: string; label: string };

/**
 * The steps a run with nobody on the line cannot perform.
 *
 * Not a warning about the workflow — these are fine on a real call. It is a
 * warning about *this* way of running it, and it is the difference between
 * reading a trace full of skips as a broken workflow and reading it as a
 * workflow that was never spoken.
 */
export function spokenSteps(graph: WorkflowGraph): SkippedStep[] {
  return (graph.nodes ?? [])
    .filter((node: WorkflowNode) => NODE_SPECS[node.kind]?.needsConversation)
    .map((node: WorkflowNode) => ({
      id: node.id,
      kind: node.kind,
      label: node.name?.trim() || NODE_SPECS[node.kind]?.label || node.kind,
    }));
}

/** Steps that reach the outside world whether or not anybody is listening. */
export function sideEffectSteps(graph: WorkflowGraph): SkippedStep[] {
  return (graph.nodes ?? [])
    .filter((node: WorkflowNode) => NODE_SPECS[node.kind]?.sideEffect)
    .map((node: WorkflowNode) => ({
      id: node.id,
      kind: node.kind,
      label: node.name?.trim() || NODE_SPECS[node.kind]?.label || node.kind,
    }));
}

/**
 * What to tell somebody before they start one by hand, in their own language
 * rather than in step kinds. Both halves matter and they pull opposite ways:
 * the spoken steps will not happen, and the rest will happen for real.
 */
export function manualRunNote(graph: WorkflowGraph): string[] {
  const notes: string[] = [];
  const spoken = spokenSteps(graph);
  if (spoken.length)
    notes.push(
      `${spoken.length} step${spoken.length === 1 ? '' : 's'} speak${
        spoken.length === 1 ? 's' : ''
      } to the customer and there is nobody on the line, so ${
        spoken.length === 1 ? 'it is' : 'they are'
      } skipped: ${spoken.map((step) => step.label).join(', ')}.`,
    );
  const effects = sideEffectSteps(graph);
  if (effects.length)
    notes.push(
      `${effects.length} step${effects.length === 1 ? '' : 's'} act${
        effects.length === 1 ? 's' : ''
      } for real — booking, messaging, charging: ${effects
        .map((step) => step.label)
        .join(', ')}.`,
    );
  return notes;
}
