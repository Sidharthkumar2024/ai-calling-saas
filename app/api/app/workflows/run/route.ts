import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';
import { enqueueJob } from '@/lib/job-queue';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  await ensureSchema();
  const body = (await request.json()) as {
    workflowId?: string;
    triggerId?: string;
    input?: Record<string, unknown>;
  };
  const organizationId = auth.session.organizationId!;
  const db = getRawDb();
  const workflow = await db
    .prepare(`SELECT id, trigger_type, steps_json FROM workflows
    WHERE id = ? AND organization_id = ? AND status = 'active'`)
    .bind(body.workflowId, organizationId)
    .first<{ id: string; trigger_type: string; steps_json: string }>();
  if (!workflow)
    return NextResponse.json(
      { error: 'Active workflow was not found.' },
      { status: 404 },
    );
  const steps = safeSteps(workflow.steps_json);
  const runId = `run_${crypto.randomUUID()}`;
  await db.batch([
    db
      .prepare(`INSERT INTO workflow_runs
      (id, organization_id, workflow_id, trigger_type, trigger_id, status, input_json)
      VALUES (?, ?, ?, ?, ?, 'queued', ?)`)
      .bind(
        runId,
        organizationId,
        workflow.id,
        workflow.trigger_type,
        body.triggerId || null,
        JSON.stringify(body.input || {}),
      ),
    ...steps.map((step, index) =>
      db
        .prepare(`INSERT INTO workflow_run_steps
      (id, run_id, step_index, step_type, status) VALUES (?, ?, ?, ?, 'pending')`)
        .bind(`run_step_${crypto.randomUUID()}`, runId, index, step),
    ),
  ]);
  await enqueueJob({
    organizationId,
    queue: 'workflow',
    type: 'workflow.execute',
    idempotencyKey: `workflow-run:${runId}`,
    payload: { runId },
  });
  return NextResponse.json(
    { runId, status: 'queued', steps: steps.length },
    { status: 202 },
  );
}

function safeSteps(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed
          .filter((item): item is string => typeof item === 'string')
          .slice(0, 50)
      : [];
  } catch {
    return [];
  }
}
