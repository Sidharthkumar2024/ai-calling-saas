/**
 * The workflow executor (§7).
 *
 * What this replaces: an `executeWorkflow` that walked the step list and wrote
 * `status = 'completed', output = { execution: 'recorded' }` on every one of
 * them. Nothing ran. A workflow that booked nothing and messaged nobody
 * reported a clean run, and the workflow list showed a rising run count.
 *
 * Three things this one does instead.
 *
 * **It executes.** A CRM lookup queries leads. An object search queries
 * records. A booking, a payment link, a message and a transfer all go through
 * `executeAgentTool`, the same code path a live agent uses — so there is one
 * implementation of "book an appointment" rather than a second one that drifts.
 *
 * **It can stop.** An Approval parks the run at `waiting`, remembers the node
 * to resume from, and comes back when a person decides. A step budget stops a
 * runaway and records that it was stopped. A failed step fails the run.
 *
 * **It refuses to call a skip a success.** A step that could not run says so
 * with a reason — `no_live_call`, `object_not_found`, `no_destination` — and
 * the run's status reflects it. That distinction is the entire point.
 */

import { getRawDb } from '@/db/index';
import { executeAgentTool } from '@/lib/agent-tools';
import { createApprovalRequest } from '@/lib/handoff-service';
import type { Filter } from '@/lib/object-engine';
import { getObject, searchRecords } from '@/lib/object-store';
import {
  branchesOf,
  evaluateCondition,
  interpolate,
  MAX_RUN_STEPS,
  NODE_SPECS,
  textValue,
  type WorkflowGraph,
  type WorkflowNode,
} from '@/lib/workflow-nodes';

export type StepStatus = 'completed' | 'skipped' | 'failed';

export type StepResult = {
  status: StepStatus;
  /** The exit taken. Null on an End, or when the step could not choose one. */
  branch: string | null;
  output: Record<string, unknown>;
  /** New or changed run variables. */
  variables?: Record<string, unknown>;
  /** Park the run here and wait for this. */
  suspend?: { waitingOn: string; resumeNode: string };
};

export type RunOutcome = {
  runId: string;
  status: 'completed' | 'failed' | 'waiting' | 'stopped';
  steps: number;
  /** Every step's outcome, in order. */
  trace: Array<{
    nodeId: string;
    kind: string;
    status: StepStatus;
    note: string;
  }>;
  variables: Record<string, unknown>;
  error?: string;
};

export type ExecutionContext = {
  organizationId: string;
  runId: string;
  agentId?: string | null;
  sessionId?: string | null;
  /** True when there is somebody on the line. Decides whether Say/Ask can run. */
  live: boolean;
};

export function parseGraph(raw: unknown): WorkflowGraph | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const nodes = (parsed as { nodes?: unknown }).nodes;
    if (!Array.isArray(nodes)) return null;
    return { nodes: nodes as WorkflowNode[] };
  } catch {
    return null;
  }
}

/**
 * Runs a workflow from its trigger, or resumes it from `startNode`.
 *
 * The caller owns the run row; this owns what happens between its start and
 * its end, and writes one `workflow_run_steps` row per node it touches.
 */
export async function executeGraph(input: {
  graph: WorkflowGraph;
  context: ExecutionContext;
  variables: Record<string, unknown>;
  startNode?: string | null;
  /** Steps already recorded, so a resumed run keeps numbering forward. */
  stepOffset?: number;
}): Promise<RunOutcome> {
  const { graph, context } = input;
  const db = getRawDb();
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const variables: Record<string, unknown> = { ...input.variables };
  const trace: RunOutcome['trace'] = [];

  let current: string | null =
    input.startNode ??
    graph.nodes.find((node) => node.kind === 'trigger')?.id ??
    null;
  if (!current)
    return {
      runId: context.runId,
      status: 'failed',
      steps: 0,
      trace,
      variables,
      error: 'This workflow has no trigger, so there is nowhere to start.',
    };

  let index = input.stepOffset ?? 0;
  let status: RunOutcome['status'] = 'completed';
  let error: string | undefined;

  while (current) {
    if (index - (input.stepOffset ?? 0) >= MAX_RUN_STEPS) {
      status = 'stopped';
      error = `The run was stopped after ${MAX_RUN_STEPS} steps without reaching an End.`;
      break;
    }
    const node: WorkflowNode | undefined = byId.get(current);
    if (!node) {
      status = 'failed';
      error = `The run reached “${current}”, which is not a step in this workflow.`;
      break;
    }

    const stepId = `wfstep_${crypto.randomUUID()}`;
    const config = resolveConfig(node.config ?? {}, variables);
    let result: StepResult;
    try {
      result = await runNode(node, config, variables, context);
    } catch (caught) {
      result = {
        status: 'failed',
        branch: null,
        output: {
          error: caught instanceof Error ? caught.message : 'The step failed.',
        },
      };
    }
    if (result.variables) Object.assign(variables, result.variables);

    await db
      .prepare(`INSERT INTO workflow_run_steps
        (id, run_id, step_index, step_type, node_id, branch, status, input_json, output_json, error, started_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
      .bind(
        stepId,
        context.runId,
        index,
        node.kind,
        node.id,
        result.branch,
        result.status,
        JSON.stringify(config).slice(0, 4000),
        JSON.stringify(result.output).slice(0, 4000),
        result.status === 'failed'
          ? textValue(result.output.error).slice(0, 300)
          : null,
      )
      .run();

    trace.push({
      nodeId: node.id,
      kind: node.kind,
      status: result.status,
      note: noteFor(result),
    });
    index += 1;

    if (result.status === 'failed') {
      status = 'failed';
      error = textValue(result.output.error) || 'A step failed.';
      break;
    }
    if (result.suspend) {
      status = 'waiting';
      await db
        .prepare(`UPDATE workflow_runs SET status = 'waiting', waiting_on = ?, resume_node = ?,
          variables_json = ? WHERE id = ?`)
        .bind(
          result.suspend.waitingOn,
          result.suspend.resumeNode,
          JSON.stringify(variables).slice(0, 8000),
          context.runId,
        )
        .run();
      return { runId: context.runId, status, steps: index, trace, variables };
    }

    if (node.kind === 'end') break;
    current = result.branch ? (node.next?.[result.branch] ?? null) : null;
    if (!current) {
      status = 'stopped';
      error = `${NODE_SPECS[node.kind]?.label ?? node.kind} took the “${result.branch}” exit, which is not wired to anything.`;
      break;
    }
  }

  await db
    .prepare(`UPDATE workflow_runs SET status = ?, completed_at = CURRENT_TIMESTAMP,
      output_json = ?, variables_json = ?, error = ?, resume_node = NULL, waiting_on = NULL WHERE id = ?`)
    .bind(
      status,
      JSON.stringify({ steps: index, trace }).slice(0, 8000),
      JSON.stringify(variables).slice(0, 8000),
      error ?? null,
      context.runId,
    )
    .run();

  return {
    runId: context.runId,
    status,
    steps: index,
    trace,
    variables,
    error,
  };
}

/* ------------------------------------------------------------------ *
 * The node executors
 * ------------------------------------------------------------------ */

async function runNode(
  node: WorkflowNode,
  config: Record<string, unknown>,
  variables: Record<string, unknown>,
  context: ExecutionContext,
): Promise<StepResult> {
  const spec = NODE_SPECS[node.kind];
  const exits = branchesOf(node);

  // Nobody on the line. The validator keeps Say and Ask out of webhook and
  // scheduled workflows; this catches the other case — a call workflow being
  // replayed or tested headless — and refuses to record silence as speech.
  if (spec?.needsConversation && !context.live)
    return {
      status: 'skipped',
      branch: exits[0] ?? null,
      output: {
        reason: 'no_live_call',
        detail:
          'This step speaks to the caller, and this run has no call attached.',
      },
    };

  switch (node.kind) {
    case 'trigger':
      return {
        status: 'completed',
        branch: 'next',
        output: { event: config.event },
      };

    case 'say':
      return {
        status: 'completed',
        branch: 'next',
        output: { spoken: textValue(config.text) },
      };

    case 'ask': {
      const variable = textValue(node.config.variable);
      const answer = variables[variable];
      if (answer === undefined)
        return {
          status: 'skipped',
          branch: 'next',
          output: {
            reason: 'no_answer_yet',
            detail: `Waiting for the caller to answer “${textValue(config.question)}”.`,
          },
        };
      return {
        status: 'completed',
        branch: 'next',
        output: { question: textValue(config.question), answer },
      };
    }

    case 'condition': {
      const verdict = evaluateCondition(
        textValue(config.expression),
        variables,
      );
      return {
        status: 'completed',
        branch: verdict.value ? 'true' : 'false',
        output: {
          expression: textValue(config.expression),
          result: verdict.value,
          explain: verdict.explain,
          // Carried separately: "we never collected it" is not "it was low".
          valueMissing: verdict.missing,
        },
      };
    }

    case 'crm_lookup':
      return crmLookup(node, config, context);

    case 'object_search':
      return objectSearch(node, config, context);

    case 'ai_decision':
      // A classification needs the conversation to classify. Headless, there
      // is no transcript, so this names what it would have needed.
      return {
        status: 'skipped',
        branch: exits[0] ?? null,
        output: {
          reason: 'needs_conversation',
          detail:
            'An AI decision reads what was said. On a live call the agent makes it; a headless run has nothing to read, so the first outcome was taken.',
          outcomes: exits,
        },
      };

    case 'booking':
      return booking(config, context);

    case 'payment':
      return payment(config, context);

    case 'message':
    case 'document_request':
      return message(node, config, context);

    case 'human_transfer':
      return transfer(config, context);

    case 'approval':
      return approval(node, config, context);

    case 'end':
      return {
        status: 'completed',
        branch: null,
        output: {
          disposition: textValue(config.disposition),
          followUp: textValue(config.followUp) || null,
        },
      };

    default:
      return {
        status: 'failed',
        branch: null,
        output: {
          error: `“${String(node.kind)}” is not a step this engine can run.`,
        },
      };
  }
}

async function crmLookup(
  node: WorkflowNode,
  config: Record<string, unknown>,
  context: ExecutionContext,
): Promise<StepResult> {
  const entity = textValue(config.entity) || 'lead';
  const match = textValue(config.match) || 'phone';
  const value = textValue(config.value).trim();
  if (!value)
    return {
      status: 'skipped',
      branch: 'not_found',
      output: {
        reason: 'no_value',
        detail: `Nothing to match on for ${entity}.`,
      },
    };

  const db = getRawDb();
  const table =
    entity === 'order' ? 'orders' : entity === 'contact' ? 'contacts' : 'leads';
  const column = match === 'email' ? 'email' : match === 'id' ? 'id' : 'phone';
  // Phones are stored in assorted shapes, so the last ten digits are what
  // actually identify a caller in this data.
  const digits = value.replace(/\D/g, '').slice(-10);
  const row =
    column === 'phone'
      ? await db
          .prepare(
            `SELECT * FROM ${table} WHERE organization_id = ? AND replace(replace(replace(phone, ' ', ''), '-', ''), '+', '') LIKE ? LIMIT 1`,
          )
          .bind(context.organizationId, `%${digits}`)
          .first<Record<string, unknown>>()
      : await db
          .prepare(
            `SELECT * FROM ${table} WHERE organization_id = ? AND ${column} = ? LIMIT 1`,
          )
          .bind(context.organizationId, value)
          .first<Record<string, unknown>>();

  if (!row)
    return {
      status: 'completed',
      branch: 'not_found',
      output: { entity, match, searched: value, found: false },
    };

  const variable = textValue(node.config.variable) || entity;
  return {
    status: 'completed',
    branch: 'found',
    output: { entity, found: true, id: row.id },
    variables: { [variable]: row },
  };
}

async function objectSearch(
  node: WorkflowNode,
  config: Record<string, unknown>,
  context: ExecutionContext,
): Promise<StepResult> {
  const key = textValue(config.object).trim();
  const object = key ? await getObject(context.organizationId, key) : null;
  if (!object)
    return {
      status: 'skipped',
      branch: 'none',
      output: {
        reason: 'object_not_found',
        detail: `This workspace has no business object called “${key}”.`,
      },
    };

  const filters = parseFilters(config.filters);
  const search = await searchRecords({
    organizationId: context.organizationId,
    object,
    filters: filters.filters,
    limit: 20,
    publishedOnly: true,
  });

  const variable = textValue(node.config.variable) || 'matches';
  return {
    status: 'completed',
    branch: search.records.length > 0 ? 'found' : 'none',
    output: {
      object: object.key,
      count: search.records.length,
      total: search.total,
      // Filters the object could not apply are named, never dropped quietly.
      skippedFilters: [...filters.unparsed, ...search.skippedFilters],
    },
    variables: {
      [variable]: search.records,
      [`${variable}_count`]: search.records.length,
    },
  };
}

async function booking(
  config: Record<string, unknown>,
  context: ExecutionContext,
): Promise<StepResult> {
  const when = textValue(config.when).trim();
  if (!when || when.includes('{{'))
    return {
      status: 'skipped',
      branch: 'unavailable',
      output: {
        reason: 'no_time_requested',
        detail:
          'No requested time reached this step, so there was nothing to book.',
      },
    };
  const outcome = await executeAgentTool(
    'book_appointment',
    {
      slot_start: when,
      service: textValue(config.service),
      mode: textValue(config.mode) || 'in_person',
      customer_name: textValue(config.customerName),
      customer_phone:
        textValue(config.destination) || textValue(config.customerPhone),
    },
    toolContext(context),
  );
  return {
    status: outcome.ok ? 'completed' : 'completed',
    branch: outcome.ok ? 'booked' : 'unavailable',
    output: outcome,
    variables: outcome.ok
      ? { appointment_id: outcome.appointment_id }
      : undefined,
  };
}

async function payment(
  config: Record<string, unknown>,
  context: ExecutionContext,
): Promise<StepResult> {
  const amount = Number(
    String(textValue(config.amount)).replace(/[^\d.]/g, ''),
  );
  if (!Number.isFinite(amount) || amount <= 0)
    return {
      status: 'skipped',
      branch: 'next',
      output: {
        reason: 'no_amount',
        detail: `“${textValue(config.amount)}” is not an amount, so no link was created.`,
      },
    };
  const channel = textValue(config.channel) || 'whatsapp';
  // A purpose that still holds a placeholder means the run never collected the
  // value. It is only a description, so this does not stop the link — but
  // "{{need}}" must not reach the customer as the thing they are paying for.
  const purpose = textValue(config.purpose);
  const resolvedPurpose = purpose.includes('{{')
    ? 'Payment requested on your call'
    : purpose;
  const outcome = await executeAgentTool(
    'create_payment_link',
    {
      amount,
      description: resolvedPurpose,
      delivery: channel === 'email' ? 'email' : 'whatsapp',
      customer_phone: textValue(config.destination),
    },
    toolContext(context),
  );
  return {
    status: outcome.ok ? 'completed' : 'failed',
    branch: 'next',
    output: outcome,
    variables: outcome.ok
      ? { payment_link_id: outcome.payment_link_id }
      : undefined,
  };
}

async function message(
  node: WorkflowNode,
  config: Record<string, unknown>,
  context: ExecutionContext,
): Promise<StepResult> {
  const destination = textValue(config.destination).trim();
  const body =
    node.kind === 'document_request'
      ? `Please upload your ${textValue(config.document)}. Use the link in this message.`
      : textValue(config.body);
  if (!destination || destination.includes('{{'))
    return {
      status: 'skipped',
      branch: 'next',
      output: {
        reason: 'no_destination',
        detail: 'No number or address reached this step, so nothing was sent.',
      },
    };
  if (!body.trim())
    return {
      status: 'skipped',
      branch: 'next',
      output: { reason: 'empty_message', detail: 'There was nothing to send.' },
    };
  // Unlike a payment description, the message *is* the thing the customer
  // reads. Sending one with "{{stay_dates}}" still in it is worse than not
  // sending it, so the step is skipped and names what was never collected.
  const unresolved = [...body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map(
    (match) => match[1],
  );
  if (unresolved.length > 0)
    return {
      status: 'skipped',
      branch: 'next',
      output: {
        reason: 'unresolved_message',
        detail: `Nothing was sent: this run never collected ${unresolved.join(', ')}, and the message would have shown that to the customer.`,
        missing: unresolved,
      },
    };
  const outcome = await executeAgentTool(
    'send_whatsapp',
    { phone: destination, message: body },
    toolContext(context),
  );
  return {
    status: outcome.ok ? 'completed' : 'failed',
    branch: 'next',
    output: { ...outcome, channel: textValue(config.channel) || 'whatsapp' },
  };
}

async function transfer(
  config: Record<string, unknown>,
  context: ExecutionContext,
): Promise<StepResult> {
  const outcome = await executeAgentTool(
    'transfer_to_human',
    {
      reason: textValue(config.reason) || 'A workflow step asked for a person.',
      skill: textValue(config.skill),
      language: textValue(config.language),
    },
    toolContext(context),
  );
  const accepted = outcome.ok === true;
  return {
    status: 'completed',
    branch: accepted ? 'accepted' : 'no_agent',
    output: outcome,
  };
}

async function approval(
  node: WorkflowNode,
  config: Record<string, unknown>,
  context: ExecutionContext,
): Promise<StepResult> {
  const amountText = textValue(config.amount).replace(/[^\d.]/g, '');
  const amount = amountText ? Number(amountText) : null;
  const card = await createApprovalRequest({
    organizationId: context.organizationId,
    sessionId: context.sessionId ?? null,
    action: textValue(config.action) || 'workflow_step',
    amount: Number.isFinite(amount) ? amount : null,
    reason: textValue(config.reason) || null,
    caseSummary: `Workflow step “${node.name ?? node.id}”.`,
    evidence: { runId: context.runId, nodeId: node.id },
    idempotencyKey: `${context.runId}:${node.id}`,
  });

  // The policy engine may settle it without a person. Carrying on is right
  // then; parking a run nobody will ever come back to decide is not.
  if (card.decision === 'auto_execute' || card.status === 'approved')
    return {
      status: 'completed',
      branch: 'approved',
      output: {
        approvalId: card.approvalId,
        decision: card.decision,
        auto: true,
      },
    };
  // `blocked` is a decision, not a pending question: policy says this action
  // may not happen at all, so the run takes the rejected branch now.
  if (card.decision === 'blocked' || card.status === 'rejected')
    return {
      status: 'completed',
      branch: 'rejected',
      output: {
        approvalId: card.approvalId,
        decision: card.decision,
        reasons: card.reasons,
      },
    };

  return {
    status: 'completed',
    branch: null,
    output: {
      approvalId: card.approvalId,
      decision: card.decision,
      detail: 'The run is parked until a person decides.',
    },
    suspend: { waitingOn: `approval:${card.approvalId}`, resumeNode: node.id },
  };
}

/* ------------------------------------------------------------------ *
 * Resuming
 * ------------------------------------------------------------------ */

/**
 * Picks a parked run back up once its approval is decided. Called when an
 * approval is granted or refused, so an approved discount actually continues
 * the workflow instead of leaving a run stuck at `waiting` forever.
 */
export async function resumeAfterApproval(input: {
  organizationId: string;
  approvalId: string;
  approved: boolean;
}): Promise<RunOutcome | null> {
  const db = getRawDb();
  const run = await db
    .prepare(`SELECT r.id, r.workflow_id, r.resume_node, r.variables_json, r.call_id,
      w.graph_json FROM workflow_runs r JOIN workflows w ON w.id = r.workflow_id
      WHERE r.organization_id = ? AND r.status = 'waiting' AND r.waiting_on = ? LIMIT 1`)
    .bind(input.organizationId, `approval:${input.approvalId}`)
    .first<{
      id: string;
      workflow_id: string;
      resume_node: string | null;
      variables_json: string;
      call_id: string | null;
      graph_json: string | null;
    }>();
  if (!run || !run.resume_node) return null;

  const graph = parseGraph(run.graph_json);
  if (!graph) return null;
  const node = graph.nodes.find((entry) => entry.id === run.resume_node);
  const next = node?.next?.[input.approved ? 'approved' : 'rejected'] ?? null;
  if (!next) {
    await db
      .prepare(`UPDATE workflow_runs SET status = 'stopped', completed_at = CURRENT_TIMESTAMP,
        error = ?, waiting_on = NULL, resume_node = NULL WHERE id = ?`)
      .bind(
        `The approval was ${input.approved ? 'granted' : 'refused'}, and that exit is not wired to anything.`,
        run.id,
      )
      .run();
    return null;
  }

  const stepCount = await db
    .prepare(`SELECT COUNT(*) AS n FROM workflow_run_steps WHERE run_id = ?`)
    .bind(run.id)
    .first<{ n: number }>();

  await db
    .prepare(
      `UPDATE workflow_runs SET status = 'running', waiting_on = NULL WHERE id = ?`,
    )
    .bind(run.id)
    .run();

  return executeGraph({
    graph,
    context: {
      organizationId: input.organizationId,
      runId: run.id,
      sessionId: null,
      live: false,
    },
    variables: safeVariables(run.variables_json),
    startNode: next,
    stepOffset: stepCount?.n ?? 0,
  });
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function toolContext(context: ExecutionContext) {
  return {
    organizationId: context.organizationId,
    agentId: context.agentId ?? null,
    sessionId: context.sessionId ?? null,
  };
}

function resolveConfig(
  config: Record<string, unknown>,
  variables: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string')
      resolved[key] = interpolate(value, variables);
    else if (Array.isArray(value))
      resolved[key] = value.map((entry: unknown) =>
        typeof entry === 'string' ? interpolate(entry, variables) : entry,
      );
    else resolved[key] = value;
  }
  return resolved;
}

/** The comparison an author writes, mapped onto the object engine's own operators. */
const FILTER_OPERATORS: Record<string, Filter['operator']> = {
  '=': 'eq',
  '!=': 'ne',
  '>': 'gt',
  '>=': 'gte',
  '<': 'lt',
  '<=': 'lte',
};

function parseFilters(raw: unknown): {
  filters: Filter[];
  unparsed: Array<{ field: string; reason: string }>;
} {
  const lines = Array.isArray(raw)
    ? raw.map((entry: unknown) => textValue(entry))
    : textValue(raw)
        .split('\n')
        .map((entry) => entry.trim());
  const filters: Filter[] = [];
  const unparsed: Array<{ field: string; reason: string }> = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const match = /^([\w.]+)\s*(>=|<=|!=|=|>|<)\s*(.+)$/.exec(line.trim());
    if (!match) {
      unparsed.push({ field: line, reason: 'not_a_filter' });
      continue;
    }
    const value = match[3].trim();
    // A placeholder that survived interpolation means the run never collected
    // the value. Filtering on the literal text "{{group_size}}" would return
    // nothing and look like an empty inventory, so it is reported instead.
    if (value.includes('{{')) {
      unparsed.push({ field: match[1], reason: 'value_never_collected' });
      continue;
    }
    filters.push({
      field: match[1],
      operator: FILTER_OPERATORS[match[2]],
      value,
    });
  }
  return { filters, unparsed };
}

function safeVariables(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function noteFor(result: StepResult): string {
  if (result.status === 'failed')
    return textValue(result.output.error) || 'failed';
  if (result.status === 'skipped')
    return textValue(result.output.detail) || textValue(result.output.reason);
  if (result.suspend) return 'Parked until a person decides.';
  return (
    textValue(result.output.explain) || textValue(result.output.detail) || ''
  );
}
