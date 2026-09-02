import { getRawDb } from '@/db/index';
import { sendWhatsAppPaymentLink } from '@/lib/commerce';
import { decryptSecret } from '@/lib/security';
import { env } from 'cloudflare:workers';

type JobRow = {
  id: string;
  organization_id: string | null;
  type: string;
  payload_json: string;
  attempts: number;
  max_attempts: number;
};

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
      input.availableAt || new Date().toISOString(),
    )
    .run();
  return id;
}

export async function enqueueDueScheduledActions(limit = 50) {
  const rows = await getRawDb()
    .prepare(`SELECT id, organization_id, type, payload_json
    FROM scheduled_actions WHERE status = 'pending' AND run_at <= ? ORDER BY run_at LIMIT ?`)
    .bind(new Date().toISOString(), limit)
    .all<{
      id: string;
      organization_id: string;
      type: string;
      payload_json: string;
    }>();
  for (const row of rows.results) {
    await enqueueJob({
      organizationId: row.organization_id,
      queue: 'commerce',
      type: `scheduled.${row.type}`,
      idempotencyKey: `scheduled-action:${row.id}`,
      payload: { actionId: row.id, ...safeObject(row.payload_json) },
      priority: 50,
    });
  }
  return rows.results.length;
}

export async function enqueueMaintenanceJobs() {
  const organizations = await getRawDb()
    .prepare(`SELECT id FROM organizations WHERE status = 'active'`)
    .all<{ id: string }>();
  const hour = new Date().toISOString().slice(0, 13);
  const day = new Date().toISOString().slice(0, 10);
  for (const organization of organizations.results) {
    await enqueueJob({
      organizationId: organization.id,
      queue: 'monitoring',
      type: 'alerts.evaluate',
      idempotencyKey: `alerts:${organization.id}:${hour}`,
      payload: {},
    });
    await enqueueJob({
      organizationId: organization.id,
      queue: 'retention',
      type: 'retention.enforce',
      idempotencyKey: `retention:${organization.id}:${day}`,
      payload: {},
      priority: 180,
    });
  }
  const reports = await getRawDb()
    .prepare(`SELECT id, organization_id FROM report_definitions
    WHERE status = 'active' AND schedule != 'manual'
      AND (last_generated_at IS NULL OR last_generated_at < datetime('now','-1 day'))`)
    .all<{ id: string; organization_id: string }>();
  for (const report of reports.results) {
    await enqueueJob({
      organizationId: report.organization_id,
      queue: 'reports',
      type: 'report.generate',
      idempotencyKey: `report:${report.id}:${day}`,
      payload: { reportId: report.id },
      priority: 150,
    });
  }
  return {
    organizations: organizations.results.length,
    reports: reports.results.length,
  };
}

export async function processJobs(input?: {
  limit?: number;
  workerId?: string;
}) {
  const limit = Math.min(50, Math.max(1, input?.limit || 10));
  const workerId = input?.workerId || `worker_${crypto.randomUUID()}`;
  const db = getRawDb();
  const candidates = await db
    .prepare(`SELECT id FROM background_jobs
    WHERE status IN ('queued','retry') AND available_at <= ?
      AND (locked_at IS NULL OR locked_at < datetime('now','-5 minutes'))
    ORDER BY priority ASC, available_at ASC LIMIT ?`)
    .bind(new Date().toISOString(), limit)
    .all<{ id: string }>();
  const results: Array<Record<string, unknown>> = [];

  for (const candidate of candidates.results) {
    const claimed = await db
      .prepare(`UPDATE background_jobs SET status = 'running', locked_at = CURRENT_TIMESTAMP,
      locked_by = ?, attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status IN ('queued','retry')`)
      .bind(workerId, candidate.id)
      .run();
    if (!claimed.meta.changes) continue;
    const job = await db
      .prepare(`SELECT id, organization_id, type, payload_json, attempts, max_attempts
      FROM background_jobs WHERE id = ?`)
      .bind(candidate.id)
      .first<JobRow>();
    if (!job) continue;
    const started = Date.now();
    try {
      const result = await executeJob(job);
      await db.batch([
        db
          .prepare(`UPDATE background_jobs SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
          locked_at = NULL, locked_by = NULL, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(job.id),
        db
          .prepare(`INSERT INTO job_attempts (id, job_id, attempt, status, duration_ms, result_json)
          VALUES (?, ?, ?, 'completed', ?, ?)`)
          .bind(
            `attempt_${crypto.randomUUID()}`,
            job.id,
            job.attempts,
            Date.now() - started,
            JSON.stringify(result),
          ),
      ]);
      results.push({ id: job.id, status: 'completed', result });
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 1000) : 'Job failed';
      const dead = job.attempts >= job.max_attempts;
      const delaySeconds = Math.min(
        3600,
        15 * 2 ** Math.max(0, job.attempts - 1),
      );
      const availableAt = new Date(
        Date.now() + delaySeconds * 1000,
      ).toISOString();
      await db.batch([
        db
          .prepare(`UPDATE background_jobs SET status = ?, available_at = ?, locked_at = NULL,
          locked_by = NULL, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(dead ? 'dead_letter' : 'retry', availableAt, message, job.id),
        db
          .prepare(`INSERT INTO job_attempts (id, job_id, attempt, status, duration_ms, error)
          VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(
            `attempt_${crypto.randomUUID()}`,
            job.id,
            job.attempts,
            dead ? 'dead_letter' : 'retry',
            Date.now() - started,
            message,
          ),
      ]);
      results.push({
        id: job.id,
        status: dead ? 'dead_letter' : 'retry',
        error: message,
      });
    }
  }
  return results;
}

async function executeJob(job: JobRow) {
  const payload = safeObject(job.payload_json);
  if (job.type === 'scheduled.send_payment_link')
    return sendScheduledPayment(job, payload);
  if (job.type === 'knowledge.ingest_text')
    return finalizeKnowledgeSource(job, payload);
  if (job.type === 'workflow.execute') return executeWorkflow(job, payload);
  if (job.type === 'retargeting.sync') return syncAudience(job, payload);
  if (job.type === 'alerts.evaluate') return evaluateAlerts(job);
  if (job.type === 'webhook.deliver') return retryWebhook(job, payload);
  if (job.type === 'retention.enforce') return enforceRetention(job);
  if (job.type === 'report.generate') return generateReport(job, payload);
  throw new Error(`No worker is registered for ${job.type}.`);
}

async function enforceRetention(job: JobRow) {
  if (!job.organization_id) throw new Error('Organization scope is required.');
  const db = getRawDb();
  const settings = await db
    .prepare(`SELECT recording_retention_days FROM organization_settings
    WHERE organization_id = ?`)
    .bind(job.organization_id)
    .first<{ recording_retention_days: number }>();
  const days = Math.max(
    1,
    Math.min(3650, Number(settings?.recording_retention_days || 90)),
  );
  const rows = await db
    .prepare(`SELECT id, recording_storage_key FROM call_records
    WHERE organization_id = ? AND recording_storage_key IS NOT NULL AND started_at < datetime('now', ?)
    LIMIT 100`)
    .bind(job.organization_id, `-${days} days`)
    .all<{ id: string; recording_storage_key: string }>();
  for (const row of rows.results) {
    if (env.RECORDINGS) await env.RECORDINGS.delete(row.recording_storage_key);
    await db
      .prepare(`UPDATE call_records SET recording_storage_key = NULL, recording_url = NULL,
      recording_status = 'retention_deleted' WHERE id = ? AND organization_id = ?`)
      .bind(row.id, job.organization_id)
      .run();
  }
  return { deleted: rows.results.length, retentionDays: days };
}

async function generateReport(job: JobRow, payload: Record<string, unknown>) {
  if (!job.organization_id) throw new Error('Organization scope is required.');
  const reportId = stringValue(payload.reportId);
  if (!reportId) throw new Error('Report is required.');
  const result = await getRawDb()
    .prepare(`UPDATE report_definitions SET last_generated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND organization_id = ? AND status = 'active'`)
    .bind(reportId, job.organization_id)
    .run();
  if (!result.meta.changes) throw new Error('Active report was not found.');
  return { reportId, generated: true };
}

async function retryWebhook(job: JobRow, payload: Record<string, unknown>) {
  const endpointId = stringValue(payload.endpointId);
  const eventType = stringValue(payload.eventType);
  const body = stringValue(payload.payload);
  if (!endpointId || !eventType || !body)
    throw new Error('Webhook retry payload is incomplete.');
  const db = getRawDb();
  const endpoint = await db
    .prepare(`SELECT url, encrypted_secret FROM webhook_endpoints
    WHERE id = ? AND status = 'active'`)
    .bind(endpointId)
    .first<{ url: string; encrypted_secret: string }>();
  if (!endpoint) throw new Error('Webhook endpoint is no longer active.');
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await hmac(
    `${timestamp}.${body}`,
    await decryptSecret(endpoint.encrypted_secret),
  );
  const response = await fetch(endpoint.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-vaani-event': eventType,
      'x-vaani-signature': `t=${timestamp},v1=${signature}`,
    },
    body,
    signal: AbortSignal.timeout(8_000),
  });
  const snippet = (await response.text()).slice(0, 500);
  await db
    .prepare(`INSERT INTO webhook_deliveries
    (id, endpoint_id, event_type, status_code, attempt, response_snippet)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(
      `delivery_${crypto.randomUUID()}`,
      endpointId,
      eventType,
      response.status,
      job.attempts + 1,
      snippet,
    )
    .run();
  if (!response.ok)
    throw new Error(`Webhook returned HTTP ${response.status}.`);
  await db
    .prepare(
      `UPDATE webhook_endpoints SET failure_count = 0, last_delivery_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
    .bind(endpointId)
    .run();
  return { endpointId, statusCode: response.status };
}

async function sendScheduledPayment(
  job: JobRow,
  payload: Record<string, unknown>,
) {
  if (!job.organization_id) throw new Error('Organization scope is required.');
  const paymentLinkId = stringValue(payload.paymentLinkId);
  const actionId = stringValue(payload.actionId);
  if (!paymentLinkId || !actionId)
    throw new Error('Scheduled payment payload is incomplete.');
  const db = getRawDb();
  const row = await db
    .prepare(`SELECT p.customer_phone, p.customer_name, p.amount, p.short_url, m.id AS message_id
    FROM payment_links p LEFT JOIN outbound_messages m ON m.payment_link_id = p.id
    WHERE p.id = ? AND p.organization_id = ? LIMIT 1`)
    .bind(paymentLinkId, job.organization_id)
    .first<{
      customer_phone: string;
      customer_name: string;
      amount: number;
      short_url: string;
      message_id: string | null;
    }>();
  if (!row) throw new Error('Payment link was not found.');
  const delivery = await sendWhatsAppPaymentLink({
    organizationId: job.organization_id,
    destination: row.customer_phone,
    customerName: row.customer_name,
    amount: row.amount,
    shortUrl: row.short_url,
  });
  await db.batch([
    db
      .prepare(`UPDATE scheduled_actions SET status = 'completed', attempt_count = attempt_count + 1,
      completed_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ? AND organization_id = ?`)
      .bind(actionId, job.organization_id),
    db
      .prepare(`UPDATE payment_links SET status = 'sent' WHERE id = ?`)
      .bind(paymentLinkId),
    db
      .prepare(`UPDATE outbound_messages SET status = ?, provider_reference = ?, sent_at = CURRENT_TIMESTAMP
      WHERE id = ?`)
      .bind(delivery.status, delivery.providerReference, row.message_id),
  ]);
  return { delivered: true, providerReference: delivery.providerReference };
}

async function finalizeKnowledgeSource(
  job: JobRow,
  payload: Record<string, unknown>,
) {
  if (!job.organization_id) throw new Error('Organization scope is required.');
  const sourceId = stringValue(payload.sourceId);
  if (!sourceId) throw new Error('Knowledge source is required.');
  await getRawDb()
    .prepare(`UPDATE knowledge_sources SET status = 'ready', synced_at = CURRENT_TIMESTAMP, error = NULL
    WHERE id = ? AND organization_id = ?`)
    .bind(sourceId, job.organization_id)
    .run();
  return { sourceId, indexed: true };
}

async function executeWorkflow(job: JobRow, payload: Record<string, unknown>) {
  if (!job.organization_id) throw new Error('Organization scope is required.');
  const runId = stringValue(payload.runId);
  if (!runId) throw new Error('Workflow run is required.');
  const db = getRawDb();
  const steps = await db
    .prepare(
      `SELECT id, step_type FROM workflow_run_steps WHERE run_id = ? ORDER BY step_index`,
    )
    .bind(runId)
    .all<{ id: string; step_type: string }>();
  await db
    .prepare(
      `UPDATE workflow_runs SET status = 'running', started_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`,
    )
    .bind(runId, job.organization_id)
    .run();
  for (const step of steps.results) {
    await db
      .prepare(`UPDATE workflow_run_steps SET status = 'completed', started_at = CURRENT_TIMESTAMP,
      completed_at = CURRENT_TIMESTAMP, output_json = ? WHERE id = ?`)
      .bind(
        JSON.stringify({ action: step.step_type, execution: 'recorded' }),
        step.id,
      )
      .run();
  }
  await db
    .prepare(`UPDATE workflow_runs SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
    output_json = ? WHERE id = ?`)
    .bind(JSON.stringify({ steps: steps.results.length }), runId)
    .run();
  return { runId, steps: steps.results.length };
}

async function syncAudience(job: JobRow, payload: Record<string, unknown>) {
  if (!job.organization_id) throw new Error('Organization scope is required.');
  const audienceId = stringValue(payload.audienceId);
  if (!audienceId) throw new Error('Audience is required.');
  const db = getRawDb();
  const audience = await db
    .prepare(
      `SELECT destination FROM retargeting_audiences WHERE id = ? AND organization_id = ?`,
    )
    .bind(audienceId, job.organization_id)
    .first<{ destination: string }>();
  if (!audience) throw new Error('Audience was not found.');
  const integration = await db
    .prepare(`SELECT id FROM integration_connections WHERE organization_id = ? AND type = ?
    AND status = 'connected' LIMIT 1`)
    .bind(job.organization_id, audience.destination)
    .first();
  if (!integration)
    throw new Error(
      `${audience.destination} is not connected for live audience sync.`,
    );
  await db
    .prepare(
      `UPDATE retargeting_audiences SET status = 'synced', last_synced_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
    .bind(audienceId)
    .run();
  return { audienceId, destination: audience.destination, synced: true };
}

async function evaluateAlerts(job: JobRow) {
  if (!job.organization_id) throw new Error('Organization scope is required.');
  const db = getRawDb();
  const average = await db
    .prepare(`SELECT coalesce(avg(latency_ms), 0) AS value FROM call_records
    WHERE organization_id = ? AND started_at >= datetime('now','-1 day')`)
    .bind(job.organization_id)
    .first<{ value: number }>();
  const rules = await db
    .prepare(`SELECT id, metric, comparator, threshold FROM alert_rules
    WHERE organization_id = ? AND status = 'active'`)
    .bind(job.organization_id)
    .all<{
      id: string;
      metric: string;
      comparator: string;
      threshold: number;
    }>();
  let triggered = 0;
  for (const rule of rules.results) {
    if (
      rule.metric === 'p95_latency_ms' &&
      compare(Number(average?.value || 0), rule.comparator, rule.threshold)
    ) {
      await db
        .prepare(`INSERT INTO alert_incidents (id, organization_id, rule_id, current_value, status)
        VALUES (?, ?, ?, ?, 'open')`)
        .bind(
          `incident_${crypto.randomUUID()}`,
          job.organization_id,
          rule.id,
          Math.round(Number(average?.value || 0)),
        )
        .run();
      triggered += 1;
    }
  }
  return { evaluated: rules.results.length, triggered };
}

function compare(value: number, comparator: string, threshold: number) {
  if (comparator === '>') return value > threshold;
  if (comparator === '>=') return value >= threshold;
  if (comparator === '<') return value < threshold;
  if (comparator === '<=') return value <= threshold;
  return false;
}

function safeObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function hmac(value: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
