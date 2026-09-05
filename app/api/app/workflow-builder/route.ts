import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import { recordAudit } from '@/lib/demo-seed';
import { enqueueJob } from '@/lib/job-enqueue';
import { listObjects } from '@/lib/object-store';
import { executeGraph, parseGraph } from '@/lib/workflow-engine';
import {
  compileCallPlan,
  layoutGraph,
  MAX_NODES,
  NODE_SPECS,
  SILENT_TRIGGERS,
  TRIGGER_EVENTS,
  triggerEventOf,
  validateWorkflow,
  type WorkflowGraph,
} from '@/lib/workflow-nodes';
import { WORKFLOW_TEMPLATES, templateByKey } from '@/lib/workflow-templates';

export const dynamic = 'force-dynamic';

/**
 * The visual workflow builder (§7).
 *
 * Gated on `agents.manage`, read and write alike — the same permission the
 * portal uses to show the screen at all. A workflow decides what the agent
 * does on a live call, which is what that permission already governs; putting
 * reads behind a different one would show the nav item to people the API then
 * refuses.
 */
export async function GET(request: Request) {
  const auth = await requireCustomerPermission(request, 'agents.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const organizationId = auth.session.organizationId!;
  const db = getRawDb();
  const params = new URL(request.url).searchParams;

  const workflowId = params.get('workflow');
  if (workflowId) {
    const row = await db
      .prepare(`SELECT id, name, description, trigger_type, status, graph_json, steps_json,
        template_key, run_count, failure_count, last_run_at, created_at
        FROM workflows WHERE id = ? AND organization_id = ? LIMIT 1`)
      .bind(workflowId, organizationId)
      .first<WorkflowRow>();
    if (!row)
      return NextResponse.json(
        { error: 'Workflow not found.' },
        { status: 404 },
      );

    const graph = parseGraph(row.graph_json);
    const runs = await db
      .prepare(`SELECT id, status, trigger_type, started_at, completed_at, error, created_at
        FROM workflow_runs WHERE workflow_id = ? AND organization_id = ?
        ORDER BY created_at DESC LIMIT 20`)
      .bind(workflowId, organizationId)
      .all();

    return NextResponse.json({
      workflow: summarise(row),
      graph,
      layout: graph ? layoutGraph(graph) : [],
      validation: graph ? validateWorkflow(graph, { mode: 'draft' }) : null,
      publishCheck: graph ? validateWorkflow(graph, { mode: 'publish' }) : null,
      // A call workflow is guidance for the agent, not control of the audio.
      // The plan is shown so nobody has to guess which it is.
      callPlan: graph && isCallTrigger(graph) ? compileCallPlan(graph) : null,
      // A workflow authored under the old flat step list has no graph. Its
      // steps are handed back as text so they can be rebuilt, not silently
      // reinterpreted as a graph nobody drew.
      legacySteps: graph ? null : legacyStepsOf(row.steps_json),
      runs: runs.results,
    });
  }

  const runId = params.get('run');
  if (runId) {
    const run = await db
      .prepare(`SELECT r.id, r.workflow_id, r.status, r.trigger_type, r.error, r.variables_json,
        r.waiting_on, r.started_at, r.completed_at, w.name AS workflow_name
        FROM workflow_runs r JOIN workflows w ON w.id = r.workflow_id
        WHERE r.id = ? AND r.organization_id = ? LIMIT 1`)
      .bind(runId, organizationId)
      .first();
    if (!run)
      return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
    const steps = await db
      .prepare(`SELECT step_index, step_type, node_id, branch, status, output_json, error,
        started_at, completed_at FROM workflow_run_steps WHERE run_id = ? ORDER BY step_index`)
      .bind(runId)
      .all();
    return NextResponse.json({ run, steps: steps.results });
  }

  const [rows, objects] = await Promise.all([
    db
      .prepare(`SELECT id, name, description, trigger_type, status, graph_json, steps_json,
        template_key, run_count, failure_count, last_run_at, created_at
        FROM workflows WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100`)
      .bind(organizationId)
      .all<WorkflowRow>(),
    listObjects(organizationId).catch(() => []),
  ]);
  const queues = await db
    .prepare(
      `SELECT id, name FROM queues WHERE organization_id = ? AND status = 'active' ORDER BY name`,
    )
    .bind(organizationId)
    .all<{ id: string; name: string }>();

  return NextResponse.json({
    workflows: rows.results.map(summarise),
    specs: NODE_SPECS,
    triggers: TRIGGER_EVENTS,
    silentTriggers: SILENT_TRIGGERS,
    maxNodes: MAX_NODES,
    templates: WORKFLOW_TEMPLATES.map((template) => ({
      key: template.key,
      name: template.name,
      flow: template.flow,
      industry: template.industry,
      steps: template.graph.nodes.length,
    })),
    // The builder fills the Object and Queue dropdowns from the workspace's
    // own configuration, so a workflow cannot name inventory that isn't there.
    objects: objects.map((object) => ({ key: object.key, name: object.name })),
    queues: queues.results,
  });
}

export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'agents.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const organizationId = auth.session.organizationId!;
  const db = getRawDb();
  const body = (await request.json()) as {
    action?: string;
    workflowId?: string;
    name?: string;
    description?: string;
    graph?: WorkflowGraph;
    templateKey?: string;
    status?: string;
    variables?: Record<string, unknown>;
  };

  // Validation with no save: the canvas calls this as the author edits, so
  // the errors appear next to the step rather than after a failed save.
  if (body.action === 'validate') {
    const graph = body.graph ?? { nodes: [] };
    return NextResponse.json({
      draft: validateWorkflow(graph, { mode: 'draft' }),
      publish: validateWorkflow(graph, { mode: 'publish' }),
      layout: layoutGraph(graph),
      callPlan: isCallTrigger(graph) ? compileCallPlan(graph) : null,
    });
  }

  if (body.action === 'install_template') {
    const template = templateByKey(String(body.templateKey ?? ''));
    if (!template)
      return NextResponse.json({ error: 'Unknown template.' }, { status: 404 });
    const id = `wf_${crypto.randomUUID()}`;
    await db
      .prepare(`INSERT INTO workflows
        (id, organization_id, name, description, trigger_type, status, steps_json, graph_json, template_key)
        VALUES (?, ?, ?, ?, ?, 'draft', '[]', ?, ?)`)
      .bind(
        id,
        organizationId,
        template.name,
        template.flow,
        triggerEventOf(template.graph) ?? 'inbound_call',
        JSON.stringify(template.graph),
        template.key,
      )
      .run();
    await recordAudit(
      auth.session,
      'workflow.template_installed',
      'workflow',
      id,
      {
        template: template.key,
      },
    );
    // Installed as a draft on purpose: the objects, queues and amounts in a
    // template belong to whoever installs it, so it opens for editing rather
    // than switching itself on.
    return NextResponse.json({ ok: true, workflowId: id, status: 'draft' });
  }

  if (body.action === 'save') {
    const graph = body.graph ?? { nodes: [] };
    const name = String(body.name ?? '').trim();
    if (!name)
      return NextResponse.json(
        { error: 'Name this workflow.' },
        { status: 400 },
      );
    const draft = validateWorkflow(graph, { mode: 'draft' });
    if (!draft.ok)
      return NextResponse.json(
        { error: 'This workflow cannot be saved yet.', validation: draft },
        { status: 400 },
      );
    const trigger = triggerEventOf(graph) ?? 'inbound_call';
    const payload = JSON.stringify(graph);
    if (payload.length > 200_000)
      return NextResponse.json(
        { error: 'This workflow is too large.' },
        { status: 400 },
      );

    if (body.workflowId) {
      const owned = await db
        .prepare(
          `SELECT id, status FROM workflows WHERE id = ? AND organization_id = ? LIMIT 1`,
        )
        .bind(body.workflowId, organizationId)
        .first<{ id: string; status: string }>();
      if (!owned)
        return NextResponse.json(
          { error: 'Workflow not found.' },
          { status: 404 },
        );
      // Editing a live workflow drops it back to draft rather than swapping
      // the graph under calls that are already running on it.
      const status = owned.status === 'active' ? 'draft' : owned.status;
      await db
        .prepare(`UPDATE workflows SET name = ?, description = ?, trigger_type = ?, graph_json = ?,
          status = ? WHERE id = ? AND organization_id = ?`)
        .bind(
          name,
          String(body.description ?? '').slice(0, 500) || null,
          trigger,
          payload,
          status,
          body.workflowId,
          organizationId,
        )
        .run();
      await recordAudit(
        auth.session,
        'workflow.updated',
        'workflow',
        body.workflowId,
        {
          steps: graph.nodes.length,
          droppedToDraft: owned.status === 'active',
        },
      );
      return NextResponse.json({
        ok: true,
        workflowId: body.workflowId,
        status,
        droppedToDraft: owned.status === 'active',
        validation: draft,
        publish: validateWorkflow(graph, { mode: 'publish' }),
      });
    }

    const id = `wf_${crypto.randomUUID()}`;
    await db
      .prepare(`INSERT INTO workflows
        (id, organization_id, name, description, trigger_type, status, steps_json, graph_json)
        VALUES (?, ?, ?, ?, ?, 'draft', '[]', ?)`)
      .bind(
        id,
        organizationId,
        name,
        String(body.description ?? '').slice(0, 500) || null,
        trigger,
        payload,
      )
      .run();
    await recordAudit(auth.session, 'workflow.created', 'workflow', id, {
      steps: graph.nodes.length,
    });
    return NextResponse.json({
      ok: true,
      workflowId: id,
      status: 'draft',
      validation: draft,
    });
  }

  if (body.action === 'publish' || body.action === 'pause') {
    const row = await db
      .prepare(
        `SELECT id, name, graph_json FROM workflows WHERE id = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(body.workflowId, organizationId)
      .first<{ id: string; name: string; graph_json: string | null }>();
    if (!row)
      return NextResponse.json(
        { error: 'Workflow not found.' },
        { status: 404 },
      );

    if (body.action === 'pause') {
      await db
        .prepare(
          `UPDATE workflows SET status = 'paused' WHERE id = ? AND organization_id = ?`,
        )
        .bind(row.id, organizationId)
        .run();
      await recordAudit(
        auth.session,
        'workflow.paused',
        'workflow',
        row.id,
        {},
      );
      return NextResponse.json({ ok: true, status: 'paused' });
    }

    const graph = parseGraph(row.graph_json);
    if (!graph)
      return NextResponse.json(
        {
          error:
            'This workflow has no steps on the canvas. Open it and build it before publishing.',
        },
        { status: 400 },
      );
    // The gate. A graph with a loose end or an unreachable step publishes
    // nowhere — the previous executor would have run it and reported success.
    const check = validateWorkflow(graph, { mode: 'publish' });
    if (!check.ok)
      return NextResponse.json(
        { error: 'This workflow is not ready to go live.', validation: check },
        { status: 400 },
      );
    await db
      .prepare(
        `UPDATE workflows SET status = 'active' WHERE id = ? AND organization_id = ?`,
      )
      .bind(row.id, organizationId)
      .run();
    await recordAudit(auth.session, 'workflow.published', 'workflow', row.id, {
      steps: graph.nodes.length,
    });
    return NextResponse.json({ ok: true, status: 'active' });
  }

  if (body.action === 'test_run') {
    const row = await db
      .prepare(
        `SELECT id, graph_json, trigger_type FROM workflows WHERE id = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(body.workflowId, organizationId)
      .first<{ id: string; graph_json: string | null; trigger_type: string }>();
    if (!row)
      return NextResponse.json(
        { error: 'Workflow not found.' },
        { status: 404 },
      );
    const graph = parseGraph(row.graph_json);
    if (!graph)
      return NextResponse.json(
        { error: 'There is nothing on the canvas to run.' },
        { status: 400 },
      );

    const runId = `run_${crypto.randomUUID()}`;
    await db
      .prepare(`INSERT INTO workflow_runs
        (id, organization_id, workflow_id, trigger_type, status, input_json, variables_json)
        VALUES (?, ?, ?, ?, 'running', ?, ?)`)
      .bind(
        runId,
        organizationId,
        row.id,
        'test',
        JSON.stringify({ test: true }),
        JSON.stringify(body.variables ?? {}),
      )
      .run();

    // A test runs for real: it books, it messages, it creates links. Said
    // plainly on the button rather than discovered afterwards.
    const outcome = await executeGraph({
      graph,
      context: { organizationId, runId, sessionId: null, live: false },
      variables: body.variables ?? {},
    });
    await recordAudit(auth.session, 'workflow.test_run', 'workflow', row.id, {
      runId,
      status: outcome.status,
    });
    return NextResponse.json({ ok: true, run: outcome });
  }

  if (body.action === 'delete') {
    const result = await db
      .prepare(`DELETE FROM workflows WHERE id = ? AND organization_id = ?`)
      .bind(body.workflowId, organizationId)
      .run();
    await recordAudit(
      auth.session,
      'workflow.deleted',
      'workflow',
      body.workflowId ?? '',
      {},
    );
    return NextResponse.json({ ok: true, deleted: result.meta?.changes ?? 0 });
  }

  if (body.action === 'enqueue') {
    const row = await db
      .prepare(
        `SELECT id FROM workflows WHERE id = ? AND organization_id = ? AND status = 'active' LIMIT 1`,
      )
      .bind(body.workflowId, organizationId)
      .first<{ id: string }>();
    if (!row)
      return NextResponse.json(
        { error: 'Only a published workflow can be queued.' },
        { status: 404 },
      );
    const runId = `run_${crypto.randomUUID()}`;
    await db
      .prepare(`INSERT INTO workflow_runs
        (id, organization_id, workflow_id, trigger_type, status, input_json, variables_json)
        VALUES (?, ?, ?, 'manual', 'queued', '{}', ?)`)
      .bind(runId, organizationId, row.id, JSON.stringify(body.variables ?? {}))
      .run();
    await enqueueJob({
      type: 'workflow.execute',
      organizationId,
      idempotencyKey: `workflow.execute:${runId}`,
      payload: { runId },
    });
    return NextResponse.json({ ok: true, runId, status: 'queued' });
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}

type WorkflowRow = {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  status: string;
  graph_json: string | null;
  steps_json: string;
  template_key: string | null;
  run_count: number;
  failure_count: number;
  last_run_at: string | null;
  created_at: string;
};

function summarise(row: WorkflowRow) {
  const graph = parseGraph(row.graph_json);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    trigger: row.trigger_type,
    status: row.status,
    steps: graph?.nodes.length ?? 0,
    templateKey: row.template_key,
    runCount: row.run_count,
    failureCount: row.failure_count,
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
    /** True for a workflow written before the canvas existed. */
    needsRebuild: !graph,
    ready: graph ? validateWorkflow(graph, { mode: 'publish' }).ok : false,
  };
}

function isCallTrigger(graph: WorkflowGraph) {
  const event = triggerEventOf(graph);
  return event !== null && !SILENT_TRIGGERS.includes(event);
}

function legacyStepsOf(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(parsed)
      ? parsed.map((entry: unknown) =>
          typeof entry === 'string' ? entry : JSON.stringify(entry),
        )
      : [];
  } catch {
    return [];
  }
}
