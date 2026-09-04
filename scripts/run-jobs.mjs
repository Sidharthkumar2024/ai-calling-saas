#!/usr/bin/env node
/**
 * Vaani job tick — drives the durable queue from an external scheduler.
 *
 * The worker entry (vinext/server/fetch-handler) exports only `fetch`, so a
 * Cloudflare cron trigger has no `scheduled` handler to call. An external cron
 * hitting this endpoint is therefore the supported scheduler.
 *
 *   CRON_SECRET=... VAANI_BASE_URL=https://your-host node scripts/run-jobs.mjs
 */
const baseUrl = (process.env.VAANI_BASE_URL || 'http://localhost:3000').replace(
  /\/+$/,
  '',
);
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error(
    'CRON_SECRET is not set. Set the same value the server uses, or the request is rejected.',
  );
  process.exit(2);
}

const started = Date.now();
try {
  const response = await fetch(`${baseUrl}/api/internal/jobs`, {
    method: 'POST',
    headers: { 'x-vaani-cron-secret': secret },
  });
  const text = await response.text();
  if (!response.ok) {
    console.error(
      `job tick failed: HTTP ${response.status} ${text.slice(0, 400)}`,
    );
    process.exit(1);
  }
  const payload = JSON.parse(text);
  const processed = Array.isArray(payload.processed) ? payload.processed : [];
  const failed = processed.filter((job) => job.status !== 'completed');
  console.log(
    JSON.stringify({
      ok: true,
      ms: Date.now() - started,
      queued: payload.queued,
      maintenance: payload.maintenance,
      processed: processed.length,
      failed: failed.length,
    }),
  );
  // A tick that ran but left failures should be visible to the scheduler.
  process.exit(failed.length ? 1 : 0);
} catch (error) {
  console.error(`job tick could not reach ${baseUrl}: ${String(error)}`);
  process.exit(1);
}
