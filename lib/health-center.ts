import { getRawDb } from '@/db/index';
import { queueVerdict } from '@/lib/queue-health';
import { summariseSilentRuns } from '@/lib/job-outcomes';
import {
  DEFAULT_THRESHOLDS,
  classifyService,
  rollUp,
  type ServiceHealth,
  type ServiceSample,
} from '@/lib/service-health';
import { jobFailurePattern, type JobAttempt } from '@/lib/activity-timeline';
import { providerReadiness } from '@/lib/provider-adapters';

/**
 * API Health Center (§29).
 *
 * Gathers what can actually be measured for every component §29 lists, and
 * hands it to the pure classifier. The rule this file keeps: **nothing is
 * asserted.** A component with no evidence comes back `unknown`, which is the
 * state the old panel was missing — it reported `api: 'operational'` as a
 * constant and a provider's health as whether an environment variable was set.
 */

const WINDOW_MINUTES = 60;

export type HealthReport = {
  overall: string;
  windowMinutes: number;
  components: ServiceHealth[];
  /**
   * Jobs that are failing, with the shape of the failure (§29).
   *
   * The panel showed a backlog count and `background_jobs.last_error`, which is
   * the most recent failure of one job and cannot say whether it fails every
   * time — a bad payload or a missing column — or intermittently, which is a
   * provider or a timeout. `job_attempts` has recorded every attempt including
   * its error since the queue shipped, and nothing read it.
   */
  failingJobs: Array<{
    jobId: string;
    type: string;
    status: string;
    attempts: number;
    failures: number;
    pattern: string;
    lastError: string | null;
    distinctErrors: string[];
  }>;
  /**
   * Runs that completed while leaving their work undone.
   *
   * `failingJobs` above only looks at jobs in a failing state, so a run that
   * succeeded at doing nothing was invisible — which is exactly what a
   * reminder run looks like when the workspace has no WhatsApp connection.
   * Nothing failed, so nothing was reported, and the customer was never
   * reminded.
   */
  silentJobs: Array<{
    type: string;
    runs: number;
    considered: number;
    skipped: number;
    message: string;
  }>;
  measuredAt: string;
};

/** Usage-derived components: everything that writes a provider usage event. */
async function providerSamples(): Promise<Map<string, Partial<ServiceSample>>> {
  const db = getRawDb();
  const rows = await db
    .prepare(
      `SELECT provider_id AS component, category,
         count(*) AS total,
         sum(CASE WHEN status IS NOT NULL AND status NOT IN ('ok','success','succeeded') THEN 1 ELSE 0 END) AS failures,
         max(CASE WHEN status IN ('ok','success','succeeded') THEN created_at END) AS last_success_at,
         max(CASE WHEN status IS NOT NULL AND status NOT IN ('ok','success','succeeded') THEN created_at END) AS last_failure_at
       FROM provider_usage_events
       WHERE created_at >= datetime('now', ?)
       GROUP BY provider_id`,
    )
    .bind(`-${WINDOW_MINUTES} minutes`)
    .all<{
      component: string;
      total: number;
      failures: number;
      last_success_at: string | null;
      last_failure_at: string | null;
    }>();

  // p95 needs the individual latencies, so it is computed here rather than in
  // SQL — SQLite has no percentile function.
  const latencies = await db
    .prepare(
      `SELECT provider_id AS component, latency_ms FROM provider_usage_events
       WHERE created_at >= datetime('now', ?) AND latency_ms IS NOT NULL
       ORDER BY provider_id`,
    )
    .bind(`-${WINDOW_MINUTES} minutes`)
    .all<{ component: string; latency_ms: number }>();
  const byComponent = new Map<string, number[]>();
  for (const row of latencies.results ?? []) {
    const list = byComponent.get(row.component) ?? [];
    list.push(Number(row.latency_ms));
    byComponent.set(row.component, list);
  }

  const samples = new Map<string, Partial<ServiceSample>>();
  for (const row of rows.results ?? []) {
    const list = (byComponent.get(row.component) ?? []).sort((a, b) => a - b);
    samples.set(row.component, {
      total: Number(row.total ?? 0),
      failures: Number(row.failures ?? 0),
      p95LatencyMs: list.length
        ? list[Math.min(list.length - 1, Math.floor(list.length * 0.95))]
        : null,
      lastSuccessAt: row.last_success_at,
      lastFailureAt: row.last_failure_at,
    });
  }
  return samples;
}

/** Stored per-component facts a time window cannot show. */
async function storedHealth() {
  const rows = await getRawDb()
    .prepare(
      `SELECT component, last_success_at, last_failure_at, consecutive_failures,
         breaker_opened_at, maintenance_until, token_expires_at, quota_used, quota_limit
       FROM service_health`,
    )
    .all<{
      component: string;
      last_success_at: string | null;
      last_failure_at: string | null;
      consecutive_failures: number;
      breaker_opened_at: string | null;
      maintenance_until: string | null;
      token_expires_at: string | null;
      quota_used: number | null;
      quota_limit: number | null;
    }>();
  const map = new Map<string, Partial<ServiceSample>>();
  for (const row of rows.results ?? [])
    map.set(row.component, {
      lastSuccessAt: row.last_success_at,
      lastFailureAt: row.last_failure_at,
      consecutiveFailures: Number(row.consecutive_failures ?? 0),
      openedAt: row.breaker_opened_at,
      maintenanceUntil: row.maintenance_until,
      tokenExpiresAt: row.token_expires_at,
      quotaUsed: row.quota_used,
      quotaLimit: row.quota_limit,
    });
  return map;
}

/**
 * Webhook health, which the tables have always recorded and nothing surfaced.
 */
async function webhookSample(): Promise<Partial<ServiceSample>> {
  const row = await getRawDb()
    .prepare(
      // Delivery success is the HTTP status the endpoint returned; there is no
      // separate status column, and `delivered_at` is the only timestamp.
      `SELECT count(*) AS total,
         sum(CASE WHEN status_code IS NULL OR status_code < 200 OR status_code >= 300
           THEN 1 ELSE 0 END) AS failures,
         max(CASE WHEN status_code >= 200 AND status_code < 300 THEN delivered_at END) AS last_success_at
       FROM webhook_deliveries WHERE delivered_at >= datetime('now', ?)`,
    )
    .bind(`-${WINDOW_MINUTES} minutes`)
    .first<{
      total: number;
      failures: number;
      last_success_at: string | null;
    }>();
  return {
    total: Number(row?.total ?? 0),
    failures: Number(row?.failures ?? 0),
    lastSuccessAt: row?.last_success_at ?? null,
  };
}

async function databaseSample(): Promise<Partial<ServiceSample>> {
  const started = Date.now();
  try {
    await getRawDb().prepare('SELECT 1 AS ok').first();
    const elapsed = Date.now() - started;
    return {
      total: 1,
      failures: 0,
      p95LatencyMs: elapsed,
      lastSuccessAt: new Date().toISOString(),
    };
  } catch {
    return { total: 1, failures: 1, lastFailureAt: new Date().toISOString() };
  }
}

/**
 * Whether background work is being drained.
 *
 * Kept apart from `queueSample` because it answers a different question. That
 * one measures the queue's lifetime success rate and depth, which is what let
 * a three-day-dead scheduler report healthy: hundreds of old completions, a
 * ~0% error rate, and nothing running.
 */
async function queueMovement() {
  const row = await getRawDb()
    .prepare(
      `SELECT
         sum(CASE WHEN status IN ('queued','retry') THEN 1 ELSE 0 END) AS waiting,
         sum(CASE WHEN status = 'dead_letter' THEN 1 ELSE 0 END) AS dead,
         min(CASE WHEN status IN ('queued','retry') THEN available_at END) AS oldest_waiting_at,
         max(completed_at) AS last_completed_at
       FROM background_jobs`,
    )
    .first<{
      waiting: number;
      dead: number;
      oldest_waiting_at: string | null;
      last_completed_at: string | null;
    }>();
  return queueVerdict({
    waiting: Number(row?.waiting ?? 0),
    dead: Number(row?.dead ?? 0),
    oldestWaitingAt: row?.oldest_waiting_at ?? null,
    lastCompletedAt: row?.last_completed_at ?? null,
  });
}

async function queueSample(): Promise<Partial<ServiceSample>> {
  const row = await getRawDb()
    .prepare(
      `SELECT
         sum(CASE WHEN status IN ('queued','retry') THEN 1 ELSE 0 END) AS queued,
         sum(CASE WHEN status = 'dead_letter' THEN 1 ELSE 0 END) AS dead,
         sum(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
         max(CASE WHEN status = 'completed' THEN updated_at END) AS last_success_at
       FROM background_jobs`,
    )
    .first<{
      queued: number;
      dead: number;
      completed: number;
      last_success_at: string | null;
    }>();
  const queued = Number(row?.queued ?? 0);
  const dead = Number(row?.dead ?? 0);
  const completed = Number(row?.completed ?? 0);
  return {
    total: completed + dead,
    failures: dead,
    lastSuccessAt: row?.last_success_at ?? null,
    // A backlog is not an error rate, so it is reported as quota pressure —
    // the honest analogy, since it is "how full is this" rather than "how
    // often does it fail".
    quotaUsed: queued,
    quotaLimit: 100,
  };
}

/**
 * Reads the attempt history of jobs that are currently in trouble.
 *
 * Limited to jobs that have actually failed and are not completed: a healthy
 * queue produces no rows here, and a panel listing every job that once
 * retried would bury the ones that matter.
 */
async function failingJobs() {
  const rows = await getRawDb()
    .prepare(
      `SELECT j.id AS jobId, j.type, j.status,
              a.attempt, a.status AS attemptStatus, a.duration_ms AS durationMs,
              a.error, a.created_at AS createdAt
       FROM background_jobs j
       INNER JOIN job_attempts a ON a.job_id = j.id
       WHERE j.status IN ('retry', 'dead_letter', 'failed')
       ORDER BY j.updated_at DESC, a.attempt ASC
       LIMIT 200`,
    )
    .all<{
      jobId: string;
      type: string;
      status: string;
      attempt: number;
      attemptStatus: string;
      durationMs: number | null;
      error: string | null;
      createdAt: string;
    }>();

  const byJob = new Map<
    string,
    { type: string; status: string; attempts: JobAttempt[] }
  >();
  for (const row of rows.results ?? []) {
    const entry = byJob.get(row.jobId) ?? {
      type: row.type,
      status: row.status,
      attempts: [],
    };
    entry.attempts.push({
      attempt: Number(row.attempt ?? 0),
      status: row.attemptStatus,
      durationMs: row.durationMs,
      error: row.error,
      createdAt: row.createdAt,
    });
    byJob.set(row.jobId, entry);
  }

  return [...byJob.entries()].map(([jobId, entry]) => ({
    jobId,
    type: entry.type,
    status: entry.status,
    ...jobFailurePattern(entry.attempts),
  }));
}

const PATTERN_URGENCY: Record<string, number> = {
  always: 3,
  intermittent: 2,
  recovered: 1,
  clean: 0,
};

/** The §29 component list, measured. */
/** Completed runs, so a job that did nothing can be told from one that did. */
async function silentJobs() {
  const rows = await getRawDb()
    .prepare(
      `SELECT j.type, a.result_json AS result
       FROM background_jobs j
       INNER JOIN job_attempts a ON a.job_id = j.id
       WHERE a.status = 'completed' AND a.created_at >= datetime('now', '-24 hours')
       ORDER BY a.created_at DESC LIMIT 500`,
    )
    .all<{ type: string; result: string | null }>();
  return summariseSilentRuns(rows.results ?? []);
}

export async function healthReport(): Promise<HealthReport> {
  const [
    providers,
    stored,
    webhook,
    database,
    queue,
    movement,
    readiness,
    jobs,
    silent,
  ] = await Promise.all([
    providerSamples(),
    storedHealth(),
    webhookSample(),
    databaseSample(),
    queueSample(),
    queueMovement().catch(
      () =>
        ({
          state: 'unknown',
          reason: 'The queue could not be read.',
          waitedMs: null,
          idleMs: null,
        }) as const,
    ),
    providerReadiness().catch(() => []),
    // Never allowed to take the panel down: the health screen exists to be
    // readable when things are broken.
    failingJobs().catch(() => []),
    silentJobs().catch(() => []),
  ]);

  const configured = new Map<string, boolean>();
  for (const entry of readiness as Array<{
    adapter?: string;
    configured?: boolean;
  }>)
    if (entry?.adapter) {
      // Usage metering stores the normalized provider name (for example
      // `anthropic`), while legacy platform rows use `provider_anthropic`.
      // Register both aliases so the health center classifies the same calls
      // that the provider-performance screen measures.
      const isConfigured = entry.configured === true;
      configured.set(entry.adapter, isConfigured);
      configured.set(`provider_${entry.adapter}`, isConfigured);
    }

  const components: ServiceSample[] = [];
  const seen = new Set<string>();

  for (const [component, sample] of providers) {
    seen.add(component);
    components.push({
      component,
      total: 0,
      failures: 0,
      ...stored.get(component),
      ...sample,
      configured: configured.get(component),
    } as ServiceSample);
  }
  // A provider that is configured but has produced no events must still appear;
  // its absence from the usage table is exactly the thing worth showing.
  for (const [component, isConfigured] of configured) {
    if (seen.has(component)) continue;
    components.push({
      component,
      total: 0,
      failures: 0,
      ...stored.get(component),
      configured: isConfigured,
    } as ServiceSample);
  }

  components.push({
    component: 'database',
    total: 0,
    failures: 0,
    ...database,
  } as ServiceSample);
  components.push({
    component: 'job_queue',
    total: 0,
    failures: 0,
    ...queue,
  } as ServiceSample);
  components.push({
    component: 'webhooks',
    total: 0,
    failures: 0,
    ...webhook,
  } as ServiceSample);

  const classified = components.map((sample) =>
    classifyService(sample, DEFAULT_THRESHOLDS),
  );
  // The queue's verdict replaces the one derived from its error rate. A
  // stopped scheduler is not a low error rate; it is the whole product not
  // running, and it has to be able to make the headline red.
  const withMovement = classified.map((entry) =>
    entry.component === 'job_queue'
      ? { ...entry, state: movement.state, reason: movement.reason }
      : entry,
  );
  return {
    overall: rollUp(withMovement.map((entry) => entry.state)),
    windowMinutes: WINDOW_MINUTES,
    components: withMovement.sort((a, b) =>
      a.component.localeCompare(b.component),
    ),
    // Worst first: 'always' is a bug in the job, 'intermittent' is usually a
    // provider, and 'recovered' needs nobody's attention today.
    failingJobs: [...jobs].sort(
      (a, b) => PATTERN_URGENCY[b.pattern] - PATTERN_URGENCY[a.pattern],
    ),
    silentJobs: silent,
    measuredAt: new Date().toISOString(),
  };
}

/**
 * Records the outcome of a provider call so the breaker and last-success
 * timestamps mean something. Failures accumulate; one success clears them.
 */
export async function recordServiceOutcome(input: {
  component: string;
  ok: boolean;
}) {
  const db = getRawDb();
  if (input.ok) {
    await db
      .prepare(
        `INSERT INTO service_health (component, last_success_at, consecutive_failures, breaker_opened_at, updated_at)
         VALUES (?, CURRENT_TIMESTAMP, 0, NULL, CURRENT_TIMESTAMP)
         ON CONFLICT(component) DO UPDATE SET last_success_at = CURRENT_TIMESTAMP,
           consecutive_failures = 0, breaker_opened_at = NULL,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .bind(input.component)
      .run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO service_health (component, last_failure_at, consecutive_failures, updated_at)
       VALUES (?, CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(component) DO UPDATE SET last_failure_at = CURRENT_TIMESTAMP,
         consecutive_failures = consecutive_failures + 1,
         breaker_opened_at = CASE
           WHEN consecutive_failures + 1 >= ? AND breaker_opened_at IS NULL
           THEN CURRENT_TIMESTAMP ELSE breaker_opened_at END,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(input.component, DEFAULT_THRESHOLDS.breakerFailures)
    .run();
}
