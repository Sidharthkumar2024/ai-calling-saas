import { getRawDb } from '@/db/index';
import { CONVERSION_SQL_LIST } from '@/lib/call-outcomes';
import { datasetFor, unknownReportMessage } from '@/lib/report-datasets';
import { sendDueReminders } from '@/lib/appointment-service';
import { isCallOutcome } from '@/lib/call-outcomes';
import {
  applyCallToLead,
  recordObjections,
} from '@/lib/sales-intelligence-service';
import { enqueueJob } from '@/lib/job-enqueue';
import { reasonWithTools } from '@/lib/provider-adapters';
import { closeIdlePlaygroundCalls } from '@/lib/call-telemetry';
import { dialCampaign } from '@/lib/campaign-dialer';

export { enqueueJob };
import {
  sendTransactionalEmail,
  sendWhatsAppPaymentLink,
  sendWhatsAppText,
} from '@/lib/commerce';
import { decryptSecret } from '@/lib/security';
import { executeGraph, parseGraph } from '@/lib/workflow-engine';
import {
  checkRecipients,
  isDue,
  isReportSchedule,
  type DeliveryState,
  type ReportSchedule,
} from '@/lib/report-schedules';
import { env } from 'cloudflare:workers';

type JobRow = {
  id: string;
  organization_id: string | null;
  type: string;
  payload_json: string;
  attempts: number;
  max_attempts: number;
};

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
    // Conversations the user simply walked away from must still be closed and
    // analysed, or their telemetry stays 'in progress' forever.
    await enqueueJob({
      organizationId: organization.id,
      queue: 'monitoring',
      type: 'calls.close_idle',
      idempotencyKey: `close-idle:${organization.id}:${hour}`,
      payload: {},
      priority: 150,
    });
    // Anything queued and never sent. Frequent, because a caller was told the
    // message was on its way.
    await enqueueJob({
      organizationId: organization.id,
      queue: 'messaging',
      type: 'messages.deliver',
      idempotencyKey: `messages:${organization.id}:${hour}`,
      payload: {},
      priority: 120,
    });
    // Hourly, because a reminder is only useful before the appointment and a
    // daily pass would miss most of the window.
    await enqueueJob({
      organizationId: organization.id,
      queue: 'messaging',
      type: 'appointments.remind',
      idempotencyKey: `appointments:${organization.id}:${hour}`,
      payload: {},
      priority: 110,
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
  // Every active scheduled report is read, and the cadence decides. This used
  // to ask for anything older than one day whatever its schedule said, so a
  // report set to monthly ran daily and the schedule column was decoration.
  const reports = await getRawDb()
    .prepare(`SELECT id, organization_id, schedule, last_generated_at FROM report_definitions
    WHERE status = 'active' AND schedule != 'manual'`)
    .all<{
      id: string;
      organization_id: string;
      schedule: string;
      last_generated_at: string | null;
    }>();
  const now = new Date();
  let dueReports = 0;
  for (const report of reports.results) {
    // A schedule this build does not recognise is left alone rather than run
    // on a guessed cadence.
    if (!isReportSchedule(report.schedule)) continue;
    if (
      !isDue({
        schedule: report.schedule,
        lastGeneratedAt: report.last_generated_at,
        now,
      })
    )
      continue;
    dueReports += 1;
    await enqueueJob({
      organizationId: report.organization_id,
      queue: 'reports',
      type: 'report.generate',
      // Keyed by the cadence's own period, so a weekly report cannot be
      // queued twice in one week by two cron ticks.
      idempotencyKey: `report:${report.id}:${periodKey(report.schedule, now)}`,
      payload: { reportId: report.id },
      priority: 150,
    });
  }
  return {
    organizations: organizations.results.length,
    reports: dueReports,
  };
}

/**
 * The period a run belongs to, for idempotency. Daily is the calendar day,
 * weekly the ISO-ish week bucket, monthly the calendar month.
 */
function periodKey(schedule: ReportSchedule, now: Date): string {
  const iso = now.toISOString();
  if (schedule === 'daily') return iso.slice(0, 10);
  if (schedule === 'monthly') return iso.slice(0, 7);
  const week = Math.floor(now.getTime() / (7 * 86_400_000));
  return `w${week}`;
}

/**
 * How long a lock may go unrefreshed before the job counts as abandoned.
 *
 * Five minutes is longer than any worker here takes and short enough that a
 * dropped job is retried within a cron tick or two.
 */
const STALE_LOCK = '-5 minutes';

export async function processJobs(input?: {
  limit?: number;
  workerId?: string;
}) {
  const limit = Math.min(50, Math.max(1, input?.limit || 10));
  const workerId = input?.workerId || `worker_${crypto.randomUUID()}`;
  const db = getRawDb();
  // A job whose worker died mid-run is `running` with a lock nobody will ever
  // release. The lock-age test was already here and could never fire, because
  // the status filter above it excluded exactly the rows it was written for —
  // so one stranded `call.intelligence` job sat at `running` for four days
  // while the queue drained around it. A stale lock is now a claimable job.
  const candidates = await db
    .prepare(`SELECT id FROM background_jobs
    WHERE available_at <= ?
      AND (
        (status IN ('queued','retry')
          AND (locked_at IS NULL OR locked_at < datetime('now', ?)))
        OR (status = 'running' AND locked_at IS NOT NULL
          AND locked_at < datetime('now', ?))
      )
    ORDER BY priority ASC, available_at ASC LIMIT ?`)
    .bind(new Date().toISOString(), STALE_LOCK, STALE_LOCK, limit)
    .all<{ id: string }>();
  const results: Array<Record<string, unknown>> = [];

  for (const candidate of candidates.results) {
    // The staleness test is repeated in the claim, not just the search: two
    // workers scanning at the same moment both see the same stranded job, and
    // whichever writes first refreshes `locked_at`, which makes the other's
    // update match nothing. Without it they would both run the same job.
    const claimed = await db
      .prepare(`UPDATE background_jobs SET status = 'running', locked_at = CURRENT_TIMESTAMP,
      locked_by = ?, attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND (status IN ('queued','retry')
          OR (status = 'running' AND locked_at < datetime('now', ?)))`)
      .bind(workerId, candidate.id, STALE_LOCK)
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
  if (job.type === 'scheduled.follow_up') return runFollowUp(job, payload);
  if (job.type === 'knowledge.ingest_text')
    return finalizeKnowledgeSource(job, payload);
  if (job.type === 'workflow.execute') return executeWorkflow(job, payload);
  if (job.type === 'retargeting.sync') return syncAudience(job, payload);
  if (job.type === 'alerts.evaluate') return evaluateAlerts(job);
  if (job.type === 'webhook.deliver') return retryWebhook(job, payload);
  if (job.type === 'retention.enforce') return enforceRetention(job);
  if (job.type === 'report.generate') return generateReport(job, payload);
  if (job.type === 'messages.deliver') return deliverQueuedMessages(job);
  if (job.type === 'appointments.remind') {
    if (!job.organization_id)
      throw new Error('Organization scope is required.');
    return sendDueReminders(job.organization_id);
  }
  if (job.type === 'call.intelligence') return analyseCall(job, payload);
  if (job.type === 'calls.close_idle') return closeIdleCalls(job);
  if (job.type === 'campaign.dial') {
    if (!job.organization_id)
      throw new Error('Organization scope is required.');
    const campaignId = stringValue(payload.campaignId);
    if (!campaignId) throw new Error('campaignId is required.');
    return dialCampaign(job.organization_id, campaignId);
  }
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

/**
 * Produces a real report run: rows, a summary and a downloadable CSV. This used
 * to only bump `last_generated_at`, so a scheduled report generated nothing the
 * customer could open.
 */
async function generateReport(job: JobRow, payload: Record<string, unknown>) {
  if (!job.organization_id) throw new Error('Organization scope is required.');
  const reportId = stringValue(payload.reportId);
  if (!reportId) throw new Error('Report is required.');
  return runReportNow(job.organization_id, reportId);
}

/**
 * Runs a report immediately. A manual "Generate" used to only bump
 * `last_generated_at` and report success, producing nothing.
 */
export async function runReportNow(organizationId: string, reportId: string) {
  const db = getRawDb();
  const definition = await db
    .prepare(`SELECT id, name, report_type, filters_json, recipients_json FROM report_definitions
      WHERE id = ? AND organization_id = ? AND status = 'active' LIMIT 1`)
    .bind(reportId, organizationId)
    .first<{
      id: string;
      name: string;
      report_type: string;
      filters_json: string;
      recipients_json: string | null;
    }>();
  if (!definition) throw new Error('Active report was not found.');

  const filters = safeObject(definition.filters_json);
  const windowDays = Math.min(
    Math.max(Number((filters as { windowDays?: unknown }).windowDays ?? 30), 1),
    365,
  );
  const since = `-${windowDays} days`;
  // A type nothing can be built from fails where somebody can see it failed.
  // The alternative is what this replaced: a CSV of raw call records, sent on
  // schedule under the report's own name, with a summary counting calls.
  if (!datasetFor(definition.report_type)) {
    const failedRunId = `report_run_${crypto.randomUUID()}`;
    await db
      .prepare(`INSERT INTO report_runs
        (id, organization_id, report_id, status, report_type, window_days,
         row_count, summary_json, content_csv, bytes)
        VALUES (?, ?, ?, 'failed', ?, ?, 0, ?, '', 0)`)
      .bind(
        failedRunId,
        organizationId,
        reportId,
        definition.report_type,
        windowDays,
        JSON.stringify({ error: unknownReportMessage(definition.report_type) }),
      )
      .run();
    return {
      reportId,
      runId: failedRunId,
      generated: false,
      reason: 'unknown_report_type',
      detail: unknownReportMessage(definition.report_type),
    };
  }
  const built = await buildReportRows(
    organizationId,
    definition.report_type,
    since,
  );
  const csv = toCsv(built.columns, built.rows);
  const runId = `report_run_${crypto.randomUUID()}`;
  await db
    .prepare(`INSERT INTO report_runs
      (id, organization_id, report_id, status, report_type, window_days,
       row_count, summary_json, content_csv, bytes)
      VALUES (?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?)`)
    .bind(
      runId,
      organizationId,
      reportId,
      definition.report_type,
      windowDays,
      built.rows.length,
      JSON.stringify(built.summary),
      csv,
      new TextEncoder().encode(csv).length,
    )
    .run();
  await db
    .prepare(`UPDATE report_definitions SET last_generated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?`)
    .bind(reportId, organizationId)
    .run();
  // Keep the last 20 runs per report so a daily schedule cannot grow forever.
  await db
    .prepare(`DELETE FROM report_runs WHERE report_id = ? AND id NOT IN (
        SELECT id FROM report_runs WHERE report_id = ? ORDER BY created_at DESC LIMIT 20
      )`)
    .bind(reportId, reportId)
    .run();
  const delivery = await deliverReport({
    organizationId,
    definition,
    runId,
    rows: built.rows.length,
    summary: built.summary,
  });

  return {
    reportId,
    runId,
    generated: true,
    rows: built.rows.length,
    bytes: new TextEncoder().encode(csv).length,
    delivery: delivery.state,
    recipients: delivery.count,
  };
}

/**
 * Emails a finished report to its recipients (§6).
 *
 * A scheduled report that generates and then sits in a table is a report
 * nobody reads. The three outcomes are kept apart on purpose: `sent` means an
 * email provider accepted it, `sandbox` means no provider is connected and
 * nothing left the building, and `failed` means the provider refused. A
 * workspace must be able to tell the difference, or it will believe its Monday
 * report is landing somewhere it is not.
 *
 * The CSV is not attached. It can be large and it is already downloadable, so
 * the email carries the summary and points at the run.
 */
async function deliverReport(input: {
  organizationId: string;
  definition: { id: string; name: string; recipients_json?: string | null };
  runId: string;
  rows: number;
  summary: Record<string, unknown>;
}): Promise<{ state: DeliveryState; count: number }> {
  const db = getRawDb();
  const { valid } = checkRecipients(safeList(input.definition.recipients_json));
  if (valid.length === 0) {
    await db
      .prepare(
        `UPDATE report_runs SET delivery_state = 'no_recipients' WHERE id = ?`,
      )
      .bind(input.runId)
      .run();
    return { state: 'no_recipients', count: 0 };
  }

  const lines = Object.entries(input.summary)
    .map(
      ([key, value]) =>
        `<li>${escapeHtml(key)}: ${escapeHtml(summaryText(value))}</li>`,
    )
    .join('');
  const html = `<p>${escapeHtml(input.definition.name)} — ${input.rows} row${input.rows === 1 ? '' : 's'}.</p><ul>${lines}</ul><p>Open Reports in Vaani to download the CSV.</p>`;

  let state: DeliveryState = 'sent';
  for (const to of valid) {
    try {
      const result = await sendTransactionalEmail({
        organizationId: input.organizationId,
        to,
        subject: `${input.definition.name} — ${input.rows} rows`,
        html,
      });
      if (result.status === 'sandbox_delivered' && state === 'sent')
        state = 'sandbox';
    } catch {
      state = 'failed';
    }
  }
  await db
    .prepare(
      `UPDATE report_runs SET delivery_state = ?, delivered_to = ? WHERE id = ?`,
    )
    .bind(state, valid.join(', ').slice(0, 500), input.runId)
    .run();
  return { state, count: valid.length };
}

function safeList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.map((entry: unknown) => (typeof entry === 'string' ? entry : ''))
      : [];
  } catch {
    return [];
  }
}

/** Summary values are numbers as often as strings; objects never appear there. */
function summaryText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return '—';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** One query per report type, each over real tenant data. */
async function buildReportRows(
  organizationId: string,
  reportType: string,
  since: string,
): Promise<{
  columns: string[];
  rows: Array<Record<string, unknown>>;
  summary: Record<string, unknown>;
}> {
  const db = getRawDb();
  const dataset = datasetFor(reportType);
  if (dataset === 'quality') {
    const result = await db
      .prepare(`SELECT q.created_at, c.customer_name, c.outcome, q.overall_score,
          q.resolution_score, q.knowledge_score, q.naturalness_score,
          q.policy_score, q.hallucination_count, q.status
        FROM call_quality_reviews q
        INNER JOIN call_records c ON c.id = q.call_id
        WHERE q.organization_id = ? AND q.created_at >= datetime('now', ?)
        ORDER BY q.created_at DESC LIMIT 5000`)
      .bind(organizationId, since)
      .all<Record<string, unknown>>();
    const rows = result.results ?? [];
    const scores = rows.map((row) => Number(row.overall_score ?? 0));
    return {
      columns: [
        'created_at',
        'customer_name',
        'outcome',
        'overall_score',
        'resolution_score',
        'knowledge_score',
        'naturalness_score',
        'policy_score',
        'hallucination_count',
        'status',
      ],
      rows,
      summary: {
        reviews: rows.length,
        averageScore: scores.length
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : 0,
        notPassed: rows.filter((row) => row.status !== 'passed').length,
      },
    };
  }

  if (dataset === 'leads') {
    const result = await db
      .prepare(`SELECT captured_at, name, phone, source_id, status, score, intent,
          product_interest, campaign_name
        FROM leads WHERE organization_id = ? AND captured_at >= datetime('now', ?)
        ORDER BY captured_at DESC LIMIT 5000`)
      .bind(organizationId, since)
      .all<Record<string, unknown>>();
    const rows = result.results ?? [];
    return {
      columns: [
        'captured_at',
        'name',
        'phone',
        'source_id',
        'status',
        'score',
        'intent',
        'product_interest',
        'campaign_name',
      ],
      rows,
      summary: {
        leads: rows.length,
        qualified: rows.filter((row) => row.status === 'qualified').length,
      },
    };
  }

  if (dataset === 'usage') {
    const result = await db
      // `provider` and `surface` are not columns of this table and never
      // were. Nothing could reach this branch — no report type resolved to it
      // — so the query had never once run, and it threw the moment `spend`
      // started arriving here.
      .prepare(`SELECT date(created_at) AS day, provider_id AS provider,
          category, operation, count(*) AS events,
          coalesce(sum(billed_credits), 0) AS credits,
          coalesce(sum(provider_cost_micros), 0) AS provider_cost_micros,
          coalesce(round(avg(latency_ms)), 0) AS latency_avg,
          sum(CASE WHEN unpriced = 1 THEN 1 ELSE 0 END) AS unpriced
        FROM provider_usage_events
        WHERE organization_id = ? AND created_at >= datetime('now', ?)
        GROUP BY 1, 2, 3, 4 ORDER BY day DESC, events DESC LIMIT 5000`)
      .bind(organizationId, since)
      .all<Record<string, unknown>>();
    const rows = result.results ?? [];
    return {
      columns: [
        'day',
        'provider',
        'category',
        'operation',
        'events',
        'credits',
        'provider_cost_micros',
        'latency_avg',
        'unpriced',
      ],
      rows,
      summary: {
        events: rows.reduce((sum, row) => sum + Number(row.events ?? 0), 0),
        credits: rows.reduce((sum, row) => sum + Number(row.credits ?? 0), 0),
        providers: new Set(rows.map((row) => String(row.provider))).size,
        // Rows with no rate card. Counted rather than folded into the total as
        // zero, which is the same rule the unit-economics screen follows.
        unpriced: rows.reduce((sum, row) => sum + Number(row.unpriced ?? 0), 0),
      },
    };
  }

  if (dataset === 'agents') {
    const result = await db
      .prepare(`SELECT coalesce(a.name, 'Unassigned') AS agent, count(*) AS calls,
          sum(CASE WHEN c.status = 'completed' THEN 1 ELSE 0 END) AS completed,
          sum(CASE WHEN c.outcome IN (${CONVERSION_SQL_LIST}) THEN 1 ELSE 0 END) AS converted,
          coalesce(sum(c.duration_seconds), 0) AS talk_seconds,
          coalesce(round(avg(c.latency_ms)), 0) AS latency_avg,
          coalesce(sum(c.cost_credits), 0) AS credits
        FROM call_records c
        LEFT JOIN voice_agents a ON a.id = c.agent_id AND a.organization_id = c.organization_id
        WHERE c.organization_id = ? AND c.started_at >= datetime('now', ?)
        GROUP BY c.agent_id ORDER BY calls DESC LIMIT 5000`)
      .bind(organizationId, since)
      .all<Record<string, unknown>>();
    const rows = result.results ?? [];
    return {
      columns: [
        'agent',
        'calls',
        'completed',
        'converted',
        'talk_seconds',
        'latency_avg',
        'credits',
      ],
      rows,
      summary: {
        agents: rows.length,
        calls: rows.reduce((sum, row) => sum + Number(row.calls ?? 0), 0),
        converted: rows.reduce(
          (sum, row) => sum + Number(row.converted ?? 0),
          0,
        ),
      },
    };
  }

  if (dataset === 'campaigns') {
    const result = await db
      .prepare(`SELECT coalesce(m.name, 'No campaign') AS campaign, count(*) AS calls,
          sum(CASE WHEN c.status = 'completed' THEN 1 ELSE 0 END) AS connected,
          sum(CASE WHEN c.outcome IN (${CONVERSION_SQL_LIST}) THEN 1 ELSE 0 END) AS converted,
          coalesce(sum(c.duration_seconds), 0) AS talk_seconds,
          coalesce(sum(c.cost_credits), 0) AS credits
        FROM call_records c
        LEFT JOIN campaigns m ON m.id = c.campaign_id AND m.organization_id = c.organization_id
        WHERE c.organization_id = ? AND c.started_at >= datetime('now', ?)
        GROUP BY c.campaign_id ORDER BY calls DESC LIMIT 5000`)
      .bind(organizationId, since)
      .all<Record<string, unknown>>();
    const rows = result.results ?? [];
    return {
      columns: [
        'campaign',
        'calls',
        'connected',
        'converted',
        'talk_seconds',
        'credits',
      ],
      rows,
      summary: {
        campaigns: rows.length,
        calls: rows.reduce((sum, row) => sum + Number(row.calls ?? 0), 0),
        converted: rows.reduce(
          (sum, row) => sum + Number(row.converted ?? 0),
          0,
        ),
      },
    };
  }

  // Call records. Reached only by a type that asked for them — no longer the
  // landing place for every name this function did not recognise.
  const result = await db
    .prepare(`SELECT c.started_at, c.channel, c.direction, c.customer_name,
        c.to_number, a.name AS agent, c.status, c.outcome, c.sentiment,
        c.duration_seconds, c.latency_ms, c.cost_credits
      FROM call_records c LEFT JOIN voice_agents a ON a.id = c.agent_id
      WHERE c.organization_id = ? AND c.started_at >= datetime('now', ?)
      ORDER BY c.started_at DESC LIMIT 5000`)
    .bind(organizationId, since)
    .all<Record<string, unknown>>();
  const rows = result.results ?? [];
  return {
    columns: [
      'started_at',
      'channel',
      'direction',
      'customer_name',
      'to_number',
      'agent',
      'status',
      'outcome',
      'sentiment',
      'duration_seconds',
      'latency_ms',
      'cost_credits',
    ],
    rows,
    summary: {
      calls: rows.length,
      credits: rows.reduce(
        (sum, row) => sum + Number(row.cost_credits ?? 0),
        0,
      ),
      talkMinutes: Math.round(
        rows.reduce((sum, row) => sum + Number(row.duration_seconds ?? 0), 0) /
          60,
      ),
    },
  };
}

/** RFC-4180 style escaping so a comma or quote in a name cannot shift columns. */
function toCsv(columns: string[], rows: Array<Record<string, unknown>>) {
  const escape = (value: unknown) => {
    if (value === null || value === undefined) return '';
    const text =
      typeof value === 'string'
        ? value
        : typeof value === 'number' ||
            typeof value === 'boolean' ||
            typeof value === 'bigint'
          ? value.toString()
          : JSON.stringify(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => escape(row[column])).join(','));
  }
  return lines.join('\n');
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

/**
 * A follow-up the agent promised during a call (§10 follow-up rules).
 *
 * Neither channel can be completed here, and the row says so rather than
 * pretending otherwise:
 *
 *  - A **call** follow-up becomes a callback request. Placing the outbound call
 *    needs a carrier, and marking the action done without one would record a
 *    promise as kept.
 *  - A **WhatsApp** follow-up is queued as an outbound message. Business
 *    messaging outside the 24-hour window requires a template the workspace has
 *    had approved, so free text cannot simply be sent — sending it would fail at
 *    Meta, and claiming it was sent would be worse.
 */
async function runFollowUp(job: JobRow, payload: Record<string, unknown>) {
  if (!job.organization_id) throw new Error('Organization scope is required.');
  const actionId = stringValue(payload.actionId);
  const customerPhone = stringValue(payload.customerPhone);
  if (!actionId || !customerPhone)
    throw new Error('Follow-up payload is incomplete.');
  const db = getRawDb();
  const channel =
    stringValue(payload.channel) === 'whatsapp' ? 'whatsapp' : 'call';
  const note = stringValue(payload.note) || 'Follow-up from your recent call';
  const customerName = stringValue(payload.customerName) || null;

  let outcome: Record<string, unknown>;
  if (channel === 'whatsapp') {
    await db
      .prepare(`INSERT INTO outbound_messages
        (id, organization_id, channel, destination, message_body, status)
        VALUES (?, ?, 'whatsapp', ?, ?, 'queued')`)
      .bind(
        `message_${crypto.randomUUID()}`,
        job.organization_id,
        customerPhone,
        note,
      )
      .run();
    outcome = { channel, queued: true };
  } else {
    await db
      .prepare(`INSERT INTO callback_requests
        (id, organization_id, customer_name, customer_phone, reason, status)
        VALUES (?, ?, ?, ?, ?, 'pending')`)
      .bind(
        `callback_${crypto.randomUUID()}`,
        job.organization_id,
        customerName,
        customerPhone,
        note,
      )
      .run();
    outcome = { channel, queuedAsCallback: true };
  }

  await db
    .prepare(`UPDATE scheduled_actions SET status = 'completed',
      attempt_count = attempt_count + 1, completed_at = CURRENT_TIMESTAMP,
      last_error = NULL WHERE id = ? AND organization_id = ?`)
    .bind(actionId, job.organization_id)
    .run();
  return outcome;
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
  // A payment link is a message the customer received, so it belongs in the
  // conversation rather than only in the payments list.
  if (delivery.status === 'sent')
    await recordOutboundWhatsApp(
      job.organization_id,
      row.customer_phone,
      `Payment link for ₹${(row.amount / 100).toLocaleString('en-IN')}: ${row.short_url}`,
      delivery.providerReference,
    );
  return { delivered: true, providerReference: delivery.providerReference };
}

/**
 * Actually sends the messages sitting in `outbound_messages`.
 *
 * Only rows attached to a payment link were ever delivered. Everything else —
 * the agent's `send_whatsapp`, `send_listing_media`, the workflow engine's
 * message step — was inserted as `queued` and sent by nothing at all, while
 * the tool told the model the message was on its way and the model told the
 * caller. This is the job that makes that true.
 *
 * Three outcomes, kept apart: `sent` means the provider accepted it,
 * `sandbox_delivered` means no provider is connected and nothing left the
 * building, `failed` carries the provider's own refusal. A workspace has to be
 * able to tell those apart, and a caller was told something either way.
 */
async function deliverQueuedMessages(job: JobRow) {
  if (!job.organization_id) throw new Error('Organization scope is required.');
  const db = getRawDb();
  const rows = await db
    .prepare(`SELECT id, channel, destination, message_body FROM outbound_messages
      WHERE organization_id = ? AND status = 'queued' AND payment_link_id IS NULL
        AND (scheduled_for IS NULL OR scheduled_for <= CURRENT_TIMESTAMP)
      ORDER BY created_at LIMIT 25`)
    .bind(job.organization_id)
    .all<{
      id: string;
      channel: string;
      destination: string;
      message_body: string;
    }>();

  let sent = 0;
  let sandbox = 0;
  let failed = 0;
  for (const row of rows.results ?? []) {
    let status = 'failed';
    let reference: string | null = null;
    let error: string | null = null;
    try {
      if (row.channel === 'email') {
        const result = await sendTransactionalEmail({
          organizationId: job.organization_id,
          to: row.destination,
          subject:
            row.message_body.split('\n')[0].slice(0, 120) ||
            'A message from us',
          html: `<p>${row.message_body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`,
        });
        status = result.status;
        reference = result.providerReference;
      } else {
        const result = await sendWhatsAppText({
          organizationId: job.organization_id,
          destination: row.destination,
          body: row.message_body,
        });
        status = result.status;
        reference = result.providerReference;
      }
    } catch (caught) {
      status = 'failed';
      error =
        caught instanceof Error ? caught.message : 'The provider refused it.';
    }
    if (status === 'sent') sent += 1;
    else if (status === 'failed') failed += 1;
    else sandbox += 1;

    await db
      .prepare(`UPDATE outbound_messages SET status = ?, provider_reference = ?,
        error_message = ?, sent_at = CASE WHEN ? = 'sent' THEN CURRENT_TIMESTAMP ELSE sent_at END
        WHERE id = ?`)
      .bind(status, reference, error?.slice(0, 300) ?? null, status, row.id)
      .run();
    if (row.channel !== 'email' && status === 'sent')
      await recordOutboundWhatsApp(
        job.organization_id,
        row.destination,
        row.message_body,
        reference,
      );
  }

  return { considered: rows.results?.length ?? 0, sent, sandbox, failed };
}

/**
 * Puts a message the business sent into the conversation it belongs to.
 *
 * Nothing did this. The inbox stored what customers wrote and what a person
 * typed back, but everything sent from a tool or a workflow — every question
 * the WhatsApp chatbot asks — went out and was never recorded, so a supervisor
 * opening that conversation read a column of answers with no questions. The
 * AI decision step reads the same table to work out what has been said, and
 * was reading only the customer's half of it.
 *
 * Only an accepted send is recorded. A transcript is what the customer saw; a
 * refused message is in `outbound_messages` with its error, and a sandbox send
 * never left the building. Writing either into the conversation would claim
 * something that did not happen.
 */
async function recordOutboundWhatsApp(
  organizationId: string,
  destination: string,
  body: string,
  providerReference: string | null,
) {
  const db = getRawDb();
  const phone = `+${destination.replace(/\D/g, '')}`;
  if (phone.length < 8) return;
  await db
    .prepare(`INSERT OR IGNORE INTO whatsapp_messages
      (id, organization_id, phone_number_id, wa_message_id, direction,
       sender_phone, message_type, body, media_id)
      VALUES (?, ?, 'outbound', ?, 'outbound', ?, 'text', ?, NULL)`)
    .bind(
      `wam_${crypto.randomUUID()}`,
      organizationId,
      providerReference ?? `sent_${crypto.randomUUID()}`,
      phone,
      body.slice(0, 4000),
    )
    .run();
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

/**
 * Runs a queued workflow.
 *
 * This used to walk the step list marking each one `completed` with
 * `execution: 'recorded'` — nothing ran, and a workflow that booked nothing
 * and messaged nobody still reported a clean run. The engine now executes the
 * graph, and a run that could not do something says which step and why.
 */
async function executeWorkflow(job: JobRow, payload: Record<string, unknown>) {
  if (!job.organization_id) throw new Error('Organization scope is required.');
  const runId = stringValue(payload.runId);
  if (!runId) throw new Error('Workflow run is required.');
  const db = getRawDb();
  const run = await db
    .prepare(`SELECT r.id, r.variables_json, r.call_id, w.graph_json, w.name
      FROM workflow_runs r JOIN workflows w ON w.id = r.workflow_id
      WHERE r.id = ? AND r.organization_id = ? LIMIT 1`)
    .bind(runId, job.organization_id)
    .first<{
      id: string;
      variables_json: string | null;
      call_id: string | null;
      graph_json: string | null;
      name: string;
    }>();
  if (!run) throw new Error('That workflow run no longer exists.');

  const graph = parseGraph(run.graph_json);
  if (!graph) {
    // A workflow authored under the old flat step list has no graph. Saying so
    // is the honest outcome; running an empty graph and calling it a success
    // is what this replaced.
    await db
      .prepare(`UPDATE workflow_runs SET status = 'failed', completed_at = CURRENT_TIMESTAMP,
        error = ? WHERE id = ?`)
      .bind(
        `“${run.name}” has no steps the builder can run. Open it and rebuild it on the canvas.`,
        runId,
      )
      .run();
    return { runId, status: 'failed', reason: 'no_graph' };
  }

  await db
    .prepare(
      `UPDATE workflow_runs SET status = 'running', started_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
    .bind(runId)
    .run();

  // A WhatsApp run has nobody on the line and somebody at the other end all
  // the same, so it carries the number to write to. Anything else is headless.
  const chatPhone =
    stringValue(payload.channel) === 'whatsapp'
      ? stringValue(payload.phone)
      : '';
  const outcome = await executeGraph({
    graph,
    context: {
      organizationId: job.organization_id,
      runId,
      sessionId: run.call_id,
      // A queued run has nobody on the line. Steps that speak to a caller are
      // recorded as skipped with that reason rather than as spoken.
      live: false,
      ...(chatPhone
        ? { channel: 'whatsapp' as const, contactPhone: chatPhone }
        : {}),
    },
    variables: safeJson(run.variables_json),
  });

  await db
    .prepare(
      `UPDATE workflows SET run_count = run_count + 1, last_run_at = CURRENT_TIMESTAMP,
       failure_count = failure_count + ? WHERE id = (SELECT workflow_id FROM workflow_runs WHERE id = ?)`,
    )
    .bind(outcome.status === 'failed' ? 1 : 0, runId)
    .run();

  return {
    runId,
    status: outcome.status,
    steps: outcome.steps,
    skipped: outcome.trace.filter((step) => step.status === 'skipped').length,
  };
}

function safeJson(raw: string | null): Record<string, unknown> {
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

/**
 * Post-call intelligence (§12): one model pass over the stored turns produces
 * the summary, intent, sentiment, objections and next action that call history
 * and analytics used to read from seed rows only. It also writes a real QA
 * review, sampled at the workspace's configured `qa_sample_rate`.
 */
async function closeIdleCalls(job: JobRow) {
  if (!job.organization_id) throw new Error('Organization scope is required.');
  const closed = await closeIdlePlaygroundCalls(job.organization_id);
  // Reservations outlive the calls that took them when nothing reports an end
  // — which is every realtime session. Left alone they hold a concurrency slot
  // for ever, so the workspace stops being able to call at all.
  const { closeStaleReservations } =
    await import('@/lib/browser-call-settlement');
  const { MAX_CALL_MINUTES } = await import('@/lib/call-limits');
  const released = await closeStaleReservations(
    getRawDb(),
    job.organization_id,
    MAX_CALL_MINUTES,
  );
  return { closed, reservationsReleased: released };
}

async function analyseCall(job: JobRow, payload: Record<string, unknown>) {
  if (!job.organization_id) throw new Error('Organization scope is required.');
  const callId = typeof payload.callId === 'string' ? payload.callId : '';
  if (!callId) throw new Error('callId is required.');
  const db = getRawDb();
  const organizationId = job.organization_id;

  const transcript = await db
    .prepare(
      `SELECT full_text, turn_count, language FROM transcripts WHERE call_id = ? LIMIT 1`,
    )
    .bind(callId)
    .first<{
      full_text: string;
      turn_count: number;
      language: string | null;
    }>();
  if (!transcript?.full_text?.trim()) {
    // Nothing was said; record that honestly instead of inventing a summary.
    await db
      .prepare(
        `UPDATE call_records SET intelligence_status = 'no_transcript' WHERE id = ?`,
      )
      .bind(callId)
      .run();
    return { callId, analysed: false, reason: 'no_transcript' };
  }

  const system = `You review one customer conversation for a business.
Return ONLY minified JSON with these keys and nothing else:
{"summary":string,"intent":string,"sentiment":"positive"|"neutral"|"negative","outcome":"resolved"|"information_provided"|"appointment_booked"|"payment_link_sent"|"callback_scheduled"|"transferred_to_human"|"not_interested"|"incomplete","objections":string[],"next_action":string,"customer_name":string|null,"quality":{"overall":0-100,"resolution":0-100,"knowledge":0-100,"naturalness":0-100,"policy":0-100,"hallucinations":number,"findings":string[]}}
Rules: base every field only on the transcript. The outcome field must be exactly one of the listed values - it is grouped in analytics, so free text is not accepted; put the detail in next_action instead. List each objection as a short phrase in the caller’s own words - "the price is above our budget", not an identifier like price_too_high - because the workspace reads these and answers them. Use null for a customer name that was never given. Keep summary under 40 words and write it in English. Score policy low if the agent claimed an action succeeded without confirmation, requested an OTP/CVV/PIN, or promised a refund outright.`;

  let parsed: Record<string, unknown> | null = null;
  let usedModel: string | null = null;
  try {
    const response = await reasonWithTools({
      organizationId,
      system,
      maxTokens: 700,
      messages: [
        {
          role: 'user',
          content: `Transcript (${transcript.turn_count} turns):\n${transcript.full_text.slice(0, 12_000)}`,
        },
      ],
    });
    const meta = response as unknown as { model?: unknown };
    usedModel = typeof meta.model === 'string' ? meta.model : null;
    const blocks = ((response as { content?: unknown[] }).content ??
      []) as Array<{ type?: string; text?: string }>;
    const text = blocks
      .filter(
        (block) => block.type === 'text' && typeof block.text === 'string',
      )
      .map((block) => block.text as string)
      .join('')
      .trim();
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as Record<
        string,
        unknown
      >;
    }
  } catch (error) {
    // A missing key or a provider outage must not fabricate intelligence.
    await db
      .prepare(
        `UPDATE call_records SET intelligence_status = 'unavailable' WHERE id = ?`,
      )
      .bind(callId)
      .run();
    return {
      callId,
      analysed: false,
      reason: 'provider_unavailable',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  if (!parsed) {
    await db
      .prepare(
        `UPDATE call_records SET intelligence_status = 'unparsed' WHERE id = ?`,
      )
      .bind(callId)
      .run();
    return { callId, analysed: false, reason: 'unparsed_model_output' };
  }

  const text = (key: string, fallback = '') =>
    typeof parsed?.[key] === 'string' ? (parsed[key] as string) : fallback;
  const sentiment = ['positive', 'neutral', 'negative'].includes(
    text('sentiment'),
  )
    ? text('sentiment')
    : 'neutral';
  // Outcome is grouped in analytics, so an off-list value becomes 'incomplete'
  // rather than creating a one-off bucket.
  // One shared vocabulary, so the model cannot invent an outcome no screen
  // knows how to count.
  const callOutcome = isCallOutcome(text('outcome'))
    ? text('outcome')
    : 'incomplete';
  const objections = Array.isArray(parsed.objections)
    ? parsed.objections.map((item) => String(item)).slice(0, 10)
    : [];
  const customerName = text('customer_name') || null;

  await db
    .prepare(`INSERT INTO summaries
      (id, organization_id, call_id, summary, intent, sentiment, outcome, objections_json, next_action, model)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(call_id) DO UPDATE SET summary = excluded.summary, intent = excluded.intent,
        sentiment = excluded.sentiment, outcome = excluded.outcome,
        objections_json = excluded.objections_json, next_action = excluded.next_action,
        model = excluded.model`)
    .bind(
      `summary_${crypto.randomUUID()}`,
      organizationId,
      callId,
      text('summary', 'No summary produced.'),
      text('intent') || null,
      sentiment,
      callOutcome,
      JSON.stringify(objections),
      text('next_action') || null,
      usedModel,
    )
    .run();
  await db
    .prepare(`UPDATE call_records SET summary = ?, sentiment = ?, outcome = ?,
      customer_name = coalesce(?, customer_name), intelligence_status = 'ready'
      WHERE id = ?`)
    .bind(
      text('summary', 'No summary produced.'),
      sentiment,
      callOutcome,
      customerName,
      callId,
    )
    .run();

  // QA sampling: honour the workspace setting that nothing used to read.
  const settings = await db
    .prepare(
      `SELECT qa_sample_rate FROM organization_settings WHERE organization_id = ? LIMIT 1`,
    )
    .bind(organizationId)
    .first<{ qa_sample_rate: number }>();
  const sampleRate = Math.min(
    Math.max(Number(settings?.qa_sample_rate ?? 100), 0),
    100,
  );
  let qaReviewed = false;
  const quality = (parsed.quality ?? null) as Record<string, unknown> | null;
  if (quality && Math.random() * 100 < sampleRate) {
    const score = (key: string) => {
      const value = Number(quality[key]);
      return Number.isFinite(value)
        ? Math.min(100, Math.max(0, Math.round(value)))
        : 0;
    };
    const overall = score('overall');
    const findings = Array.isArray(quality.findings)
      ? quality.findings.map((item) => String(item)).slice(0, 10)
      : [];
    const hallucinations = Number.isFinite(Number(quality.hallucinations))
      ? Math.max(0, Math.round(Number(quality.hallucinations)))
      : 0;
    await db
      .prepare(`INSERT INTO call_quality_reviews
        (id, organization_id, call_id, overall_score, resolution_score, knowledge_score,
         naturalness_score, policy_score, hallucination_count, overlap_count, status, findings_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
      .bind(
        `review_${crypto.randomUUID()}`,
        organizationId,
        callId,
        overall,
        score('resolution'),
        score('knowledge'),
        score('naturalness'),
        score('policy'),
        hallucinations,
        overall >= 70 && hallucinations === 0 ? 'passed' : 'needs_review',
        JSON.stringify(findings),
      )
      .run();
    qaReviewed = true;
  }

  // The return path (§10). Until now every field above was written to a row
  // nothing acted on: the lead's score stayed at whatever its enquiry form
  // implied, and the objections were filed and never read.
  let rescored: Awaited<ReturnType<typeof applyCallToLead>> = null;
  let objectionsFiled = 0;
  try {
    const [lead, filed] = await Promise.all([
      applyCallToLead({
        organizationId,
        callId,
        signals: {
          outcome: callOutcome,
          sentiment,
          intent: text('intent') || null,
          objections,
        },
      }),
      recordObjections({ organizationId, callId, objections }),
    ]);
    rescored = lead;
    objectionsFiled = filed.filed;
  } catch (error) {
    // The analysis itself is already saved. Failing to propagate it must not
    // roll that back or fail the job into a retry that re-bills the model.
    console.error('sales intelligence write-back failed', error);
  }

  return {
    callId,
    analysed: true,
    sentiment,
    objections: objections.length,
    objectionsFiled,
    leadRescored: rescored
      ? {
          leadId: rescored.leadId,
          previous: rescored.previous,
          score: rescored.score,
          delta: rescored.delta,
          status: rescored.status,
        }
      : null,
    qaReviewed,
    qaSampleRate: sampleRate,
    model: usedModel,
  };
}

async function evaluateAlerts(job: JobRow) {
  if (!job.organization_id) throw new Error('Organization scope is required.');
  const db = getRawDb();
  const organizationId = job.organization_id;

  const rules = await db
    .prepare(`SELECT id, name, metric, comparator, threshold, window_minutes, channels_json
    FROM alert_rules WHERE organization_id = ? AND status = 'active'`)
    .bind(organizationId)
    .all<{
      id: string;
      name: string;
      metric: string;
      comparator: string;
      threshold: number;
      window_minutes: number | null;
      channels_json: string | null;
    }>();

  // Notification destination: the workspace owner's address.
  const owner = await db
    .prepare(`SELECT u.email FROM organization_members m
      INNER JOIN app_users u ON u.id = m.user_id
      WHERE m.organization_id = ? ORDER BY m.created_at LIMIT 1`)
    .bind(organizationId)
    .first<{ email: string }>();

  let triggered = 0;
  let resolved = 0;
  let notified = 0;
  const skipped: string[] = [];
  const notMeasurable: string[] = [];

  for (const rule of rules.results ?? []) {
    const windowMinutes = Math.min(
      Math.max(Number(rule.window_minutes ?? 60), 5),
      10_080,
    );
    const measurement = await measureAlertMetric(
      organizationId,
      rule.metric,
      windowMinutes,
    );
    if (measurement === null) {
      // Two different reasons produce null, and conflating them hides a real
      // configuration error behind a routine one. A metric nobody implements is
      // a mistake to fix; a margin with no revenue behind it is simply not
      // measurable this window.
      if (KNOWN_ALERT_METRICS.has(rule.metric)) notMeasurable.push(rule.metric);
      else skipped.push(rule.metric);
      continue;
    }
    const breaching = compare(measurement, rule.comparator, rule.threshold);
    const open = await db
      .prepare(`SELECT id FROM alert_incidents
        WHERE organization_id = ? AND rule_id = ? AND status = 'open'
        ORDER BY triggered_at DESC LIMIT 1`)
      .bind(organizationId, rule.id)
      .first<{ id: string }>();

    if (breaching && !open) {
      const incidentId = `incident_${crypto.randomUUID()}`;
      await db
        .prepare(`INSERT INTO alert_incidents (id, organization_id, rule_id, current_value, status)
        VALUES (?, ?, ?, ?, 'open')`)
        .bind(incidentId, organizationId, rule.id, Math.round(measurement))
        .run();
      triggered += 1;
      notified += await dispatchAlertNotifications({
        organizationId,
        rule,
        value: measurement,
        windowMinutes,
        ownerEmail: owner?.email ?? null,
      });
    } else if (!breaching && open) {
      // Incidents used to stay open forever; close them when the metric recovers.
      await db
        .prepare(`UPDATE alert_incidents SET status = 'resolved',
          resolved_at = CURRENT_TIMESTAMP, current_value = ? WHERE id = ?`)
        .bind(Math.round(measurement), open.id)
        .run();
      resolved += 1;
    }
  }
  return {
    evaluated: (rules.results ?? []).length,
    triggered,
    resolved,
    notified,
    skippedMetrics: skipped,
    notMeasurable,
  };
}

/**
 * Every metric this worker can measure. Used to tell a metric nobody
 * implements apart from one that simply has no data this window.
 */
const KNOWN_ALERT_METRICS = new Set([
  'p95_latency_ms',
  'call_failure_rate',
  'qa_not_passed_rate',
  'queue_backlog',
  'provider_error_rate',
  'gross_margin_percent',
]);

/**
 * Returns the measured value for a metric, or null when the metric is unknown
 * Every source here is a table that live code actually writes.
 */
async function measureAlertMetric(
  organizationId: string,
  metric: string,
  windowMinutes: number,
): Promise<number | null> {
  const db = getRawDb();
  const since = `-${windowMinutes} minutes`;

  if (metric === 'p95_latency_ms') {
    // True p95 over recorded provider calls (SQLite has no percentile).
    const rows = await db
      .prepare(`SELECT latency_ms FROM provider_usage_events
        WHERE organization_id = ? AND latency_ms IS NOT NULL
          AND created_at >= datetime('now', ?)
        ORDER BY latency_ms`)
      .bind(organizationId, since)
      .all<{ latency_ms: number }>();
    const values = (rows.results ?? []).map((row) => Number(row.latency_ms));
    if (!values.length) return 0;
    const index = Math.min(
      values.length - 1,
      Math.max(0, Math.ceil(0.95 * values.length) - 1),
    );
    return values[index];
  }

  if (metric === 'call_failure_rate') {
    const row = await db
      .prepare(`SELECT
          count(*) AS total,
          sum(CASE WHEN status IN ('failed','provider_error','no_answer') THEN 1 ELSE 0 END) AS failures
        FROM call_records
        WHERE organization_id = ? AND started_at >= datetime('now', ?)`)
      .bind(organizationId, since)
      .first<{ total: number; failures: number }>();
    const total = Number(row?.total ?? 0);
    if (!total) return 0;
    return (Number(row?.failures ?? 0) / total) * 100;
  }

  if (metric === 'qa_not_passed_rate') {
    const row = await db
      .prepare(`SELECT
          count(*) AS total,
          sum(CASE WHEN status != 'passed' THEN 1 ELSE 0 END) AS not_passed
        FROM call_quality_reviews
        WHERE organization_id = ? AND created_at >= datetime('now', ?)`)
      .bind(organizationId, since)
      .first<{ total: number; not_passed: number }>();
    const total = Number(row?.total ?? 0);
    if (!total) return 0;
    return (Number(row?.not_passed ?? 0) / total) * 100;
  }

  if (metric === 'queue_backlog') {
    const row = await db
      .prepare(`SELECT count(*) AS queued FROM background_jobs
        WHERE organization_id = ? AND status = 'queued'`)
      .bind(organizationId)
      .first<{ queued: number }>();
    return Number(row?.queued ?? 0);
  }

  if (metric === 'provider_error_rate') {
    const row = await db
      .prepare(`SELECT
          count(*) AS total,
          sum(CASE WHEN status IS NOT NULL AND status NOT IN ('ok','success','succeeded') THEN 1 ELSE 0 END) AS errors
        FROM provider_usage_events
        WHERE organization_id = ? AND created_at >= datetime('now', ?)`)
      .bind(organizationId, since)
      .first<{ total: number; errors: number }>();
    const total = Number(row?.total ?? 0);
    if (!total) return 0;
    return (Number(row?.errors ?? 0) / total) * 100;
  }

  // §28: margin-floor alerting. Returns the gross margin as a percentage so a
  // rule can be written as "warn below 40". Deliberately null rather than 0
  // when there is no revenue in the window — a workspace that billed nothing
  // has no margin, and firing a floor breach at it would be noise.
  if (metric === 'gross_margin_percent') {
    const [revenueRow, costRow] = await Promise.all([
      db
        .prepare(`SELECT coalesce(sum(total), 0) AS revenue FROM invoices
          WHERE organization_id = ? AND status = 'paid' AND paid_at >= datetime('now', ?)`)
        .bind(organizationId, since)
        .first<{ revenue: number }>(),
      db
        .prepare(`SELECT coalesce(sum(coalesce(base_cost_micros, 0)), 0) AS cost,
            sum(CASE WHEN unpriced = 1 THEN 1 ELSE 0 END) AS unpriced
          FROM provider_usage_events
          WHERE organization_id = ? AND created_at >= datetime('now', ?)`)
        .bind(organizationId, since)
        .first<{ cost: number; unpriced: number }>(),
    ]);
    const revenue = Number(revenueRow?.revenue ?? 0);
    if (revenue <= 0) return null;
    // An incomplete cost base makes the margin look better than it is, and a
    // floor alert that cannot fire because half the cost is missing is worse
    // than no alert at all.
    if (Number(costRow?.unpriced ?? 0) > 0) return null;
    const costMinor = Math.round(Number(costRow?.cost ?? 0) / 10_000);
    return ((revenue - costMinor) / revenue) * 100;
  }

  return null;
}

/** Alert channels used to be stored and never delivered. */
async function dispatchAlertNotifications(input: {
  organizationId: string;
  rule: {
    id: string;
    name: string;
    metric: string;
    threshold: number;
    channels_json: string | null;
  };
  value: number;
  windowMinutes: number;
  ownerEmail: string | null;
}) {
  const db = getRawDb();
  let channels: string[] = [];
  try {
    const parsed = JSON.parse(input.rule.channels_json || '[]') as unknown;
    channels = Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    channels = [];
  }
  if (!channels.length) channels = ['email'];
  const body = `Alert "${input.rule.name}" fired: ${input.rule.metric} is ${Math.round(
    input.value,
  )} (threshold ${input.rule.threshold}) over the last ${input.windowMinutes} minutes.`;

  let sent = 0;
  for (const channel of channels) {
    const destination =
      channel === 'email' ? input.ownerEmail : `alert_rule:${input.rule.id}`;
    if (!destination) continue;
    await db
      .prepare(`INSERT INTO outbound_messages
        (id, organization_id, channel, destination, template_name, message_body, status)
        VALUES (?, ?, ?, ?, 'vaani_alert', ?, 'queued')`)
      .bind(
        `msg_${crypto.randomUUID()}`,
        input.organizationId,
        channel === 'webhook' ? 'webhook' : 'email',
        destination,
        body.slice(0, 900),
      )
      .run();
    sent += 1;
  }
  return sent;
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
