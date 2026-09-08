/**
 * The visual workflow builder's node catalogue and graph validation (§7).
 *
 * §7 lists thirteen node kinds. What it does not say — and what decides
 * whether this module is worth having — is what happens when a workflow is
 * wired wrongly. The executor this replaces marked every step `completed`
 * without running it, so a broken graph looked identical to a working one.
 *
 * So the rule here is that a workflow which cannot run must fail to save,
 * not fail at 3am on a live call:
 *
 *   **Every path reaches an End. Every branch points at a node that exists.
 *   Every loop contains something that waits for a human. A node that needs a
 *   caller cannot sit in a workflow that has no call.**
 *
 * That last one is the rule that catches the mistake people actually make:
 * `ask` and `say` are meaningless when the trigger is a webhook or a nightly
 * schedule, because there is nobody on the line to ask. The builder refuses
 * it by name rather than running it and recording silence as success.
 *
 * Pure: the catalogue, the graph rules and the validator. No database.
 */

export type NodeKind =
  | 'trigger'
  | 'say'
  | 'ask'
  | 'ai_decision'
  | 'crm_lookup'
  | 'object_search'
  | 'condition'
  | 'document_request'
  | 'booking'
  | 'payment'
  | 'approval'
  | 'message'
  | 'human_transfer'
  | 'end';

/**
 * §7's "Ask / Say" is one row but two behaviours — one collects an answer and
 * branches on it, the other only speaks — so they are separate kinds here.
 * Thirteen rows, fourteen kinds.
 */
export const NODE_KINDS: NodeKind[] = [
  'trigger',
  'say',
  'ask',
  'ai_decision',
  'crm_lookup',
  'object_search',
  'condition',
  'document_request',
  'booking',
  'payment',
  'approval',
  'message',
  'human_transfer',
  'end',
];

export type FieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'number'
  | 'boolean'
  | 'list';

export type NodeField = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  /** Fixed choices for `select`. Empty means the UI fills them from the workspace. */
  options?: string[];
  help?: string;
  placeholder?: string;
};

export type NodeSpec = {
  kind: NodeKind;
  label: string;
  /** §7's own description of the node's purpose. */
  purpose: string;
  fields: NodeField[];
  /**
   * Named exits. `['next']` is a plain single exit. `'dynamic'` means the
   * exits come from the node's own config — an AI decision branches on the
   * outcomes the author listed, so the builder cannot know them in advance.
   */
  branches: string[] | 'dynamic';
  /** Needs somebody on the line. Rejected in webhook and scheduled workflows. */
  needsConversation: boolean;
  /** Can park the run and wait for something outside it (a person, a payment). */
  canSuspend: boolean;
  /** Changes something outside the workflow: money, a message, a booking, a queue. */
  sideEffect: boolean;
};

export const TRIGGER_EVENTS = [
  'inbound_call',
  'outbound_campaign',
  'web_voice',
  'whatsapp_message',
  'webhook',
  'scheduled',
] as const;

export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

/**
 * Triggers where nobody can be spoken to or written to, so `say` and `ask`
 * cannot mean anything.
 *
 * `whatsapp_message` is deliberately not here. It has no audio, but it does
 * have somebody at the other end and a way to reach them — the difference is
 * that a WhatsApp `ask` waits minutes or hours for the answer instead of
 * seconds, which the engine handles by parking the run rather than by
 * forbidding the step.
 */
export const SILENT_TRIGGERS: TriggerEvent[] = ['webhook', 'scheduled'];

/** Triggers that carry a WhatsApp conversation rather than a voice call. */
export const CHAT_TRIGGERS: TriggerEvent[] = ['whatsapp_message'];

export const NODE_SPECS: Record<NodeKind, NodeSpec> = {
  trigger: {
    kind: 'trigger',
    label: 'Trigger',
    purpose:
      'Inbound call, outbound campaign, web voice, WhatsApp message, webhook, scheduled event.',
    fields: [
      {
        key: 'event',
        label: 'Starts on',
        type: 'select',
        required: true,
        options: [...TRIGGER_EVENTS],
      },
      {
        key: 'filter',
        label: 'Only when',
        type: 'text',
        required: false,
        help: 'Optional condition on the trigger payload, e.g. lead.source = website.',
      },
    ],
    branches: ['next'],
    needsConversation: false,
    canSuspend: false,
    sideEffect: false,
  },
  say: {
    kind: 'say',
    label: 'Say',
    purpose:
      'Tell the customer something. Spoken on a call, sent as a message on WhatsApp.',
    fields: [
      {
        key: 'text',
        label: 'What the agent says',
        type: 'textarea',
        required: true,
        placeholder: 'Thank you, I have your details.',
      },
    ],
    branches: ['next'],
    needsConversation: true,
    canSuspend: false,
    sideEffect: false,
  },
  ask: {
    kind: 'ask',
    label: 'Ask',
    purpose:
      'Ask the customer something and wait for the answer. On a call that is seconds; on WhatsApp the run parks until they reply.',
    fields: [
      { key: 'question', label: 'Question', type: 'textarea', required: true },
      {
        key: 'variable',
        label: 'Save the answer as',
        type: 'text',
        required: true,
        placeholder: 'group_size',
        help: 'Later nodes read it as {{group_size}}.',
      },
      {
        key: 'expect',
        label: 'Expected answer',
        type: 'select',
        required: false,
        options: ['any', 'number', 'yes_no', 'date', 'phone', 'email'],
      },
    ],
    branches: ['next'],
    needsConversation: true,
    // On WhatsApp the answer arrives whenever the customer gets round to it,
    // so the run is parked rather than held open.
    canSuspend: true,
    sideEffect: false,
  },
  ai_decision: {
    kind: 'ai_decision',
    label: 'AI decision',
    purpose: 'Intent, qualification, classification, language or next action.',
    fields: [
      {
        key: 'instruction',
        label: 'What to decide',
        type: 'textarea',
        required: true,
        placeholder: 'Is this caller asking about admissions, fees or hostel?',
      },
      {
        key: 'outcomes',
        label: 'Possible outcomes',
        type: 'list',
        required: true,
        help: 'Each outcome becomes an exit you can wire separately.',
      },
    ],
    branches: 'dynamic',
    needsConversation: false,
    canSuspend: false,
    sideEffect: false,
  },
  crm_lookup: {
    kind: 'crm_lookup',
    label: 'CRM lookup',
    purpose: 'Find customer, lead, deal, order or case.',
    fields: [
      {
        key: 'entity',
        label: 'Look up',
        type: 'select',
        required: true,
        options: ['lead', 'contact', 'order'],
      },
      {
        key: 'match',
        label: 'Match on',
        type: 'select',
        required: true,
        options: ['phone', 'email', 'id'],
      },
      {
        key: 'value',
        label: 'Value',
        type: 'text',
        required: true,
        placeholder: '{{caller_phone}}',
      },
      {
        key: 'variable',
        label: 'Save the result as',
        type: 'text',
        required: false,
        placeholder: 'lead',
      },
    ],
    branches: ['found', 'not_found'],
    needsConversation: false,
    canSuspend: false,
    sideEffect: false,
  },
  object_search: {
    kind: 'object_search',
    label: 'Object search',
    purpose: 'Filter product, property or service inventory.',
    fields: [
      {
        key: 'object',
        label: 'Object',
        type: 'select',
        required: true,
        help: 'One of this workspace’s business objects.',
      },
      {
        key: 'filters',
        label: 'Filters',
        type: 'list',
        required: false,
        help: 'field=value, one per line. Values may use {{variables}}.',
      },
      {
        key: 'variable',
        label: 'Save the results as',
        type: 'text',
        required: false,
        placeholder: 'matches',
      },
    ],
    branches: ['found', 'none'],
    needsConversation: false,
    canSuspend: false,
    sideEffect: false,
  },
  condition: {
    kind: 'condition',
    label: 'Condition',
    purpose: 'Rules based on fields, score, availability or policy.',
    fields: [
      {
        key: 'expression',
        label: 'Condition',
        type: 'text',
        required: true,
        placeholder: 'lead.score >= 60',
        help: 'Supports = != > >= < <= contains, and {{variables}}.',
      },
    ],
    branches: ['true', 'false'],
    needsConversation: false,
    canSuspend: false,
    sideEffect: false,
  },
  document_request: {
    kind: 'document_request',
    label: 'Document request',
    purpose: 'Ask for a missing document and send an upload link.',
    fields: [
      {
        key: 'document',
        label: 'Document',
        type: 'text',
        required: true,
        placeholder: 'PAN card',
      },
      {
        key: 'channel',
        label: 'Send the link over',
        type: 'select',
        required: true,
        options: ['whatsapp', 'email', 'sms'],
      },
      {
        key: 'destination',
        label: 'Send to',
        type: 'text',
        required: false,
        placeholder: '{{caller_phone}}',
      },
    ],
    branches: ['next'],
    needsConversation: false,
    canSuspend: false,
    sideEffect: true,
  },
  booking: {
    kind: 'booking',
    label: 'Booking',
    purpose: 'Find a slot and confirm it.',
    fields: [
      { key: 'service', label: 'Service', type: 'text', required: true },
      {
        key: 'when',
        label: 'Requested time',
        type: 'text',
        required: false,
        placeholder: '{{preferred_slot}}',
      },
      {
        key: 'mode',
        label: 'Mode',
        type: 'select',
        required: false,
        options: ['in_person', 'phone', 'video'],
      },
    ],
    branches: ['booked', 'unavailable'],
    needsConversation: false,
    canSuspend: false,
    sideEffect: true,
  },
  payment: {
    kind: 'payment',
    label: 'Payment',
    purpose: 'Create a payment request or link.',
    fields: [
      {
        key: 'amount',
        label: 'Amount',
        type: 'text',
        required: true,
        placeholder: '{{fee}}',
      },
      { key: 'purpose', label: 'For', type: 'text', required: true },
      {
        key: 'channel',
        label: 'Send the link over',
        type: 'select',
        required: false,
        options: ['whatsapp', 'email', 'sms', 'none'],
      },
      {
        key: 'destination',
        label: 'Send to',
        type: 'text',
        required: true,
        placeholder: '{{caller_phone}}',
        help: 'A payment link with nowhere to go is not a payment link.',
      },
    ],
    branches: ['next'],
    needsConversation: false,
    canSuspend: false,
    sideEffect: true,
  },
  approval: {
    kind: 'approval',
    label: 'Approval',
    purpose: 'Manager or finance approval.',
    fields: [
      {
        key: 'action',
        label: 'Action being approved',
        type: 'text',
        required: true,
      },
      { key: 'amount', label: 'Amount', type: 'text', required: false },
      { key: 'reason', label: 'Reason', type: 'textarea', required: false },
    ],
    branches: ['approved', 'rejected'],
    needsConversation: false,
    canSuspend: true,
    sideEffect: true,
  },
  message: {
    kind: 'message',
    label: 'WhatsApp / Email',
    purpose: 'Send a follow-up, media or template message.',
    fields: [
      {
        key: 'channel',
        label: 'Channel',
        type: 'select',
        required: true,
        options: ['whatsapp', 'email', 'sms'],
      },
      { key: 'destination', label: 'Send to', type: 'text', required: false },
      { key: 'body', label: 'Message', type: 'textarea', required: true },
      {
        key: 'template',
        label: 'Template name',
        type: 'text',
        required: false,
      },
    ],
    branches: ['next'],
    needsConversation: false,
    canSuspend: false,
    sideEffect: true,
  },
  human_transfer: {
    kind: 'human_transfer',
    label: 'Human transfer',
    purpose: 'Queue by team, skill or language.',
    fields: [
      { key: 'queue', label: 'Queue', type: 'select', required: false },
      { key: 'skill', label: 'Skill', type: 'text', required: false },
      { key: 'language', label: 'Language', type: 'text', required: false },
      {
        key: 'reason',
        label: 'Transfer reason',
        type: 'text',
        required: false,
      },
    ],
    branches: ['accepted', 'no_agent'],
    needsConversation: false,
    canSuspend: false,
    sideEffect: true,
  },
  end: {
    kind: 'end',
    label: 'End',
    purpose: 'Disposition, summary and follow-up.',
    fields: [
      {
        key: 'disposition',
        label: 'Disposition',
        type: 'text',
        required: true,
      },
      { key: 'followUp', label: 'Follow-up', type: 'text', required: false },
    ],
    branches: [],
    needsConversation: false,
    canSuspend: false,
    sideEffect: false,
  },
};

export type WorkflowNode = {
  id: string;
  kind: NodeKind;
  /** The author's own name for this step. Falls back to the kind's label. */
  name?: string;
  config: Record<string, unknown>;
  /** branch name -> node id. */
  next: Record<string, string | null>;
};

export type WorkflowGraph = { nodes: WorkflowNode[] };

/**
 * Bounds. A workflow is authored by a person and executed by a machine, so
 * both ends need a ceiling: one on how big a graph may get, one on how many
 * steps a single run may take before it is stopped and said so.
 */
export const MAX_NODES = 60;
export const MAX_RUN_STEPS = 100;

export type ValidationIssue = {
  nodeId: string | null;
  message: string;
};

export type Validation = {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

/**
 * The exits a node actually has, given its config. Static for most kinds;
 * an AI decision's exits are the outcomes its author listed.
 */
export function branchesOf(node: WorkflowNode): string[] {
  const spec = NODE_SPECS[node.kind];
  if (!spec) return [];
  if (spec.branches !== 'dynamic') return spec.branches;
  const outcomes = asList(node.config.outcomes)
    .map((entry) => slug(entry))
    .filter((entry) => entry.length > 0);
  return unique(outcomes);
}

export function triggerEventOf(graph: WorkflowGraph): TriggerEvent | null {
  const trigger = graph.nodes.find((node) => node.kind === 'trigger');
  if (!trigger) return null;
  const event = textValue(trigger.config.event);
  return (TRIGGER_EVENTS as readonly string[]).includes(event)
    ? (event as TriggerEvent)
    : null;
}

/** Node ids reachable from the trigger by following wired branches. */
export function reachableFrom(
  graph: WorkflowGraph,
  startId: string,
): Set<string> {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const queue = [startId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    const node = byId.get(id);
    if (!node) continue;
    seen.add(id);
    for (const branch of branchesOf(node)) {
      const target = node.next?.[branch];
      if (target) queue.push(target);
    }
  }
  return seen;
}

/**
 * Loops that can never exit.
 *
 * A cycle is not automatically wrong — "keep asking until they give a date"
 * is a real workflow. But a cycle made only of conditions and lookups
 * recomputes the same values forever, so it is rejected by name. A cycle is
 * allowed when it passes through something that waits for new input from
 * outside the run: an `ask`, or an `approval`.
 */
export function unexitableCycles(graph: WorkflowGraph): string[][] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const cycles: string[][] = [];
  const colour = new Map<string, 'grey' | 'black'>();
  const stack: string[] = [];

  const walk = (id: string) => {
    const node = byId.get(id);
    if (!node) return;
    const state = colour.get(id);
    if (state === 'black') return;
    if (state === 'grey') {
      const start = stack.indexOf(id);
      if (start >= 0) cycles.push(stack.slice(start));
      return;
    }
    colour.set(id, 'grey');
    stack.push(id);
    for (const branch of branchesOf(node)) {
      const target = node.next?.[branch];
      if (target) walk(target);
    }
    stack.pop();
    colour.set(id, 'black');
  };

  for (const node of graph.nodes) walk(node.id);

  return cycles.filter((cycle) => {
    const waits = cycle.some((id) => {
      const kind = byId.get(id)?.kind;
      return kind === 'ask' || kind === 'approval';
    });
    return !waits;
  });
}

/**
 * Validates a graph.
 *
 * `mode` is the one concession to authoring: a half-wired draft is saved with
 * its loose ends reported as warnings, and the same loose ends block
 * publishing. Nothing that would misbehave at runtime is ever a warning.
 */
export function validateWorkflow(
  graph: WorkflowGraph,
  options: { mode?: 'draft' | 'publish' } = {},
): Validation {
  const mode = options.mode ?? 'publish';
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const add = (
    list: 'error' | 'warning',
    nodeId: string | null,
    message: string,
  ) => {
    (list === 'error' ? errors : warnings).push({ nodeId, message });
  };
  // A loose end blocks a publish and only warns on a draft; everything else
  // is an error in both modes.
  const loose = mode === 'publish' ? 'error' : 'warning';

  const nodes = graph.nodes ?? [];
  if (nodes.length === 0) {
    return {
      ok: false,
      errors: [{ nodeId: null, message: 'This workflow has no steps yet.' }],
      warnings: [],
    };
  }
  if (nodes.length > MAX_NODES)
    add(
      'error',
      null,
      `A workflow can hold ${MAX_NODES} steps; this one has ${nodes.length}.`,
    );

  const seenIds = new Set<string>();
  for (const node of nodes) {
    if (!node.id) {
      add('error', null, 'A step is missing its id.');
      continue;
    }
    if (seenIds.has(node.id))
      add('error', node.id, `Two steps share the id “${node.id}”.`);
    seenIds.add(node.id);
    if (!NODE_SPECS[node.kind])
      add('error', node.id, `“${String(node.kind)}” is not a step type.`);
  }

  const triggers = nodes.filter((node) => node.kind === 'trigger');
  if (triggers.length === 0)
    add(
      'error',
      null,
      'Every workflow starts with a Trigger; this one has none.',
    );
  if (triggers.length > 1)
    add(
      'error',
      null,
      `A workflow has one Trigger; this one has ${triggers.length}.`,
    );

  const event = triggerEventOf(graph);
  if (triggers.length === 1 && !event)
    add('error', triggers[0].id, 'Choose what this workflow starts on.');

  if (!nodes.some((node) => node.kind === 'end'))
    add(loose, null, 'No End step, so no run can record a disposition.');

  for (const node of nodes) {
    const spec = NODE_SPECS[node.kind];
    if (!spec) continue;

    for (const field of spec.fields) {
      if (!field.required) continue;
      const value = node.config?.[field.key];
      const empty =
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value.trim() === '') ||
        (Array.isArray(value) && value.length === 0);
      if (empty)
        add('error', node.id, `${spec.label}: ${field.label} is required.`);
    }

    if (node.kind === 'ai_decision' && branchesOf(node).length < 2)
      add(
        'error',
        node.id,
        'An AI decision needs at least two outcomes to choose between.',
      );

    // The rule that catches the real mistake: nobody is on the line.
    if (spec.needsConversation && event && SILENT_TRIGGERS.includes(event))
      add(
        'error',
        node.id,
        `${spec.label} needs somebody on the line, and a ${event.replace('_', ' ')} workflow has no call.`,
      );

    for (const branch of branchesOf(node)) {
      const target = node.next?.[branch] ?? null;
      if (!target) {
        add(
          loose,
          node.id,
          `${spec.label}: the “${branch}” exit is not wired to anything.`,
        );
        continue;
      }
      if (!seenIds.has(target))
        add(
          'error',
          node.id,
          `${spec.label}: the “${branch}” exit points at a step that does not exist.`,
        );
    }
  }

  if (triggers.length === 1) {
    const live = reachableFrom(graph, triggers[0].id);
    for (const node of nodes)
      if (!live.has(node.id))
        add(
          loose,
          node.id,
          `${NODE_SPECS[node.kind]?.label ?? 'This step'} can never be reached.`,
        );
  }

  for (const cycle of unexitableCycles(graph))
    add(
      'error',
      cycle[0],
      `These steps loop into each other with nothing that waits for an answer, so a run would never leave: ${cycle.join(' → ')}.`,
    );

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Lays the graph out in columns by distance from the trigger, so the canvas
 * draws the same shape every time instead of asking people to arrange boxes.
 */
export function layoutGraph(
  graph: WorkflowGraph,
): Array<{ id: string; column: number; row: number }> {
  const trigger = graph.nodes.find((node) => node.kind === 'trigger');
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const depth = new Map<string, number>();
  if (trigger) {
    const queue: Array<[string, number]> = [[trigger.id, 0]];
    while (queue.length > 0) {
      const [id, level] = queue.shift()!;
      const node = byId.get(id);
      if (!node) continue;
      const known = depth.get(id);
      if (known !== undefined && known >= level) continue;
      depth.set(id, level);
      for (const branch of branchesOf(node)) {
        const target = node.next?.[branch];
        if (target) queue.push([target, level + 1]);
      }
    }
  }
  // Anything the trigger cannot reach still has to be visible, or an author
  // cannot find the step the validator is complaining about.
  const orphanColumn = Math.max(0, ...depth.values()) + 1;
  const rows = new Map<number, number>();
  return graph.nodes.map((node) => {
    const column = depth.get(node.id) ?? orphanColumn;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return { id: node.id, column, row };
  });
}

/** Config values arrive as JSON, so a field can hold anything. Only a string is a string. */
export function textValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return '';
}

function asList(value: unknown): string[] {
  if (Array.isArray(value))
    return value.map((entry: unknown) => textValue(entry));
  if (typeof value === 'string')
    return value
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  return [];
}

export function slug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function unique(values: string[]) {
  return [...new Set(values)];
}

/* ------------------------------------------------------------------ *
 * Runtime helpers — pure, so the executor's decisions are testable
 * without a database or a call.
 * ------------------------------------------------------------------ */

/** Reads `lead.score` out of the run's variables. Missing is undefined, never a guess. */
export function readPath(
  variables: Record<string, unknown>,
  path: string,
): unknown {
  const parts = path
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);
  let current: unknown = variables;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Fills `{{variable}}` from the run's variables.
 *
 * A variable that has no value is left as its own placeholder rather than
 * replaced with an empty string: "Confirmed for {{preferred_slot}}" reaching a
 * caller unchanged is embarrassing, but "Confirmed for " is worse — it reads as
 * a finished sentence and hides that the workflow lost the value.
 */
export function interpolate(
  template: string,
  variables: Record<string, unknown>,
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, path: string) => {
    const value = readPath(variables, path);
    if (value === undefined || value === null) return whole;
    if (typeof value === 'object') {
      const count = Array.isArray(value) ? value.length : undefined;
      return count === undefined ? whole : String(count);
    }
    return primitiveText(value);
  });
}

export const CONDITION_OPERATORS = [
  '>=',
  '<=',
  '!=',
  '=',
  '>',
  '<',
  'contains',
] as const;

export type ConditionResult = {
  value: boolean;
  /** Why it came out that way — recorded on the step, so a run is explainable. */
  explain: string;
  /** True when the left side had no value at all. */
  missing: boolean;
};

/**
 * Evaluates a Condition node's expression.
 *
 * Deliberately tiny: two sides and one operator, no boolean algebra, no
 * function calls, nothing that could become an expression language nobody can
 * audit. If a workflow needs `and`, it needs two Condition nodes, and then the
 * canvas shows the logic instead of hiding it in a string.
 *
 * A missing left-hand value is **false**, and says so. Treating "we never
 * collected the score" as "the score is below 60" would be a lie of the same
 * family this codebase keeps removing, so `missing` is carried out separately
 * and the step records it.
 */
export function evaluateCondition(
  expression: string,
  variables: Record<string, unknown>,
): ConditionResult {
  const raw = String(expression ?? '').trim();
  if (!raw)
    return {
      value: false,
      explain: 'No condition was written.',
      missing: true,
    };

  let operator = '';
  let index = -1;
  for (const candidate of CONDITION_OPERATORS) {
    const found =
      candidate === 'contains'
        ? raw.toLowerCase().indexOf(' contains ')
        : raw.indexOf(candidate);
    if (found > 0) {
      operator = candidate;
      index = found;
      break;
    }
  }
  if (!operator)
    return {
      value: false,
      explain: `“${raw}” has no comparison in it.`,
      missing: true,
    };

  const width = operator === 'contains' ? ' contains '.length : operator.length;
  const leftText = raw.slice(0, index).trim();
  const rightText = raw.slice(index + width).trim();

  // The left side names something the run collected, so an unset one is
  // genuinely absent. The right side is usually a literal the author typed.
  const left = resolveSide(leftText, variables, 'reference');
  const right = resolveSide(rightText, variables, 'literal');

  if (left === undefined || left === null || left === '')
    return {
      value: false,
      explain: `${leftText} has no value in this run, so the condition is false.`,
      missing: true,
    };

  const value = compare(left, operator, right);
  return {
    value,
    explain: `${leftText} = ${describe(left)} ${operator} ${describe(right)} → ${value}`,
    missing: false,
  };
}

function resolveSide(
  text: string,
  variables: Record<string, unknown>,
  side: 'reference' | 'literal',
): unknown {
  const bare = text.replace(/^\{\{\s*|\s*\}\}$/g, '').trim();
  if (/^-?\d+(\.\d+)?$/.test(bare)) return Number(bare);
  if (/^"(.*)"$/.test(bare) || /^'(.*)'$/.test(bare)) return bare.slice(1, -1);
  const resolved = readPath(variables, bare);
  if (resolved !== undefined) return resolved;
  // A reference the run never collected is absent, and stays absent. Falling
  // back to the literal text here is what made `lead.score >= 60` come out
  // *true* on a run that never had a score: compared as a word, "lead.score"
  // sorts above "60".
  if (side === 'reference') return undefined;
  // The right-hand side is usually a literal the author typed — `yes`,
  // `available` — so a word that names no variable stays that word.
  return bare;
}

function compare(left: unknown, operator: string, right: unknown): boolean {
  if (operator === 'contains')
    return String(left).toLowerCase().includes(String(right).toLowerCase());
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const numeric =
    Number.isFinite(leftNumber) &&
    Number.isFinite(rightNumber) &&
    String(left).trim() !== '' &&
    String(right).trim() !== '';
  if (numeric) {
    if (operator === '=') return leftNumber === rightNumber;
    if (operator === '!=') return leftNumber !== rightNumber;
    if (operator === '>') return leftNumber > rightNumber;
    if (operator === '>=') return leftNumber >= rightNumber;
    if (operator === '<') return leftNumber < rightNumber;
    if (operator === '<=') return leftNumber <= rightNumber;
  }
  const leftText = String(left).trim().toLowerCase();
  const rightText = String(right).trim().toLowerCase();
  if (operator === '=') return leftText === rightText;
  if (operator === '!=') return leftText !== rightText;
  if (operator === '>') return leftText > rightText;
  if (operator === '>=') return leftText >= rightText;
  if (operator === '<') return leftText < rightText;
  if (operator === '<=') return leftText <= rightText;
  return false;
}

function describe(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (typeof value === 'string') return `“${value}”`;
  if (value === null || typeof value !== 'object') return primitiveText(value);
  return Array.isArray(value) ? `${value.length} results` : 'a record';
}

/** Stringifies anything that is not an object. Objects never reach here. */
function primitiveText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (typeof value === 'bigint') return value.toString();
  return '';
}

/* ------------------------------------------------------------------ *
 * Live calls
 * ------------------------------------------------------------------ */

export type CallPlanStep = {
  nodeId: string;
  label: string;
  instruction: string;
  /** The agent tool this step corresponds to, where one exists. */
  tool: string | null;
};

export type CallPlan = {
  steps: CallPlanStep[];
  /** Variables the agent is expected to collect during the call. */
  collect: string[];
  /** Steps the plan cannot express as conversation, named rather than dropped. */
  notes: string[];
};

/**
 * Compiles a graph into a plan for a live call.
 *
 * A word about what this is and is not. On a phone call the model drives the
 * conversation turn by turn and calls tools; nothing in this architecture lets
 * a workflow seize the audio and read a script. So for call triggers the graph
 * is compiled into the agent's plan — the order to work through, the questions
 * to ask, the values to collect, the tools to use — and the agent executes it
 * through the tool loop that already exists.
 *
 * That means a call workflow is **guidance, not control**, and the builder
 * says so on the screen. Headless triggers (webhook, scheduled) are the
 * opposite: there the engine executes every node itself.
 *
 * Branch-heavy graphs flatten into a plan that names the branches, because a
 * plan the model can follow is a list, not a graph.
 */
export function compileCallPlan(graph: WorkflowGraph): CallPlan {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const trigger = graph.nodes.find((node) => node.kind === 'trigger');
  const steps: CallPlanStep[] = [];
  const collect: string[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  const queue: string[] = trigger ? [trigger.next?.next ?? ''] : [];

  while (queue.length > 0 && steps.length < MAX_NODES) {
    const id = queue.shift()!;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (!node) continue;
    const spec = NODE_SPECS[node.kind];
    const label = node.name?.trim() || spec?.label || node.kind;

    if (node.kind === 'ask') {
      const variable = textValue(node.config.variable);
      if (variable) collect.push(variable);
      steps.push({
        nodeId: id,
        label,
        instruction: `Ask: “${textValue(node.config.question)}”. Remember the answer as ${variable || 'a note'}.`,
        tool: null,
      });
    } else if (node.kind === 'say') {
      steps.push({
        nodeId: id,
        label,
        instruction: `Tell the caller, in your own words: ${textValue(node.config.text)}`,
        tool: null,
      });
    } else if (node.kind === 'ai_decision') {
      const outcomes = branchesOf(node);
      steps.push({
        nodeId: id,
        label,
        instruction: `Decide: ${textValue(node.config.instruction)} Choose one of: ${outcomes.join(', ')}. Then follow that branch.`,
        tool: null,
      });
    } else if (node.kind === 'condition') {
      steps.push({
        nodeId: id,
        label,
        instruction: `Only continue down the “true” branch when ${textValue(node.config.expression)}.`,
        tool: null,
      });
    } else {
      const tool = TOOL_FOR_KIND[node.kind] ?? null;
      steps.push({
        nodeId: id,
        label,
        instruction: instructionFor(node, spec?.label ?? node.kind),
        tool,
      });
      if (!tool && node.kind !== 'end')
        notes.push(
          `${label} has no matching agent tool and will need a person.`,
        );
    }

    for (const branch of branchesOf(node)) {
      const target = node.next?.[branch];
      if (target) queue.push(target);
    }
  }

  return { steps, collect: unique(collect), notes };
}

/** Which existing agent tool each node kind maps onto during a live call. */
export const TOOL_FOR_KIND: Partial<Record<NodeKind, string>> = {
  crm_lookup: 'lookup_customer',
  object_search: 'search_catalog',
  booking: 'book_appointment',
  payment: 'create_payment_link',
  message: 'send_whatsapp',
  document_request: 'request_document',
  human_transfer: 'transfer_to_human',
  end: 'end_call',
};

function instructionFor(node: WorkflowNode, label: string): string {
  if (node.kind === 'crm_lookup')
    return `Look the caller up in the CRM by ${textValue(node.config.match) || 'phone'}.`;
  if (node.kind === 'object_search')
    return `Search ${textValue(node.config.object) || 'the catalogue'} for what the caller described, and answer only from what comes back.`;
  if (node.kind === 'booking')
    return `Offer real slots for ${textValue(node.config.service) || 'the service'} and book the one they choose.`;
  if (node.kind === 'payment')
    return `Create a payment link for ${textValue(node.config.purpose) || 'the amount agreed'} and tell them where it was sent.`;
  if (node.kind === 'message')
    return `Send a ${textValue(node.config.channel) || 'WhatsApp'} follow-up: ${textValue(node.config.body)}`;
  if (node.kind === 'document_request')
    return `Ask for ${textValue(node.config.document)} and send the upload link over ${textValue(node.config.channel) || 'WhatsApp'}.`;
  if (node.kind === 'human_transfer')
    return `Transfer to a person${textValue(node.config.skill) ? ` with the ${textValue(node.config.skill)} skill` : ''}. Reason: ${textValue(node.config.reason) || 'the caller needs one'}.`;
  if (node.kind === 'approval')
    return `Do not promise ${textValue(node.config.action)} yourself — it needs a manager's approval first.`;
  if (node.kind === 'end')
    return `Close the call and record the disposition ${textValue(node.config.disposition)}.`;
  return label;
}
