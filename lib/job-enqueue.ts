import { getRawDb } from '@/db/index';

/**
 * Job enqueueing, split out of lib/job-queue.ts so callers that only need to
 * queue work do not import the worker module. call-telemetry queues jobs and
 * job-queue calls back into call-telemetry, which made the two modules a
 * cycle — the kind that resolves to `undefined` at call time.
 */
export async function enqueueJob(input: {
  organizationId?: string | null;
  queue?: string;
  type: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
  availableAt?: string;
}) {
  const id = `job_${crypto.randomUUID()}`;
  await getRawDb()
    .prepare(`INSERT INTO background_jobs
    (id, organization_id, queue, type, idempotency_key, payload_json, status, priority, max_attempts, available_at)
    VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
    ON CONFLICT(idempotency_key) DO NOTHING`)
    .bind(
      id,
      input.organizationId || null,
      input.queue || 'default',
      input.type,
      input.idempotencyKey,
      JSON.stringify(input.payload),
      input.priority ?? 100,
      input.maxAttempts ?? 5,
      input.availableAt ?? new Date().toISOString(),
    )
    .run();
  return id;
}
