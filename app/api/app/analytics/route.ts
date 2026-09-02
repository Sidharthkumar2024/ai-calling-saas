import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import { languageLabel } from '@/lib/languages';

export const dynamic = 'force-dynamic';

/**
 * Analytics aggregates (blueprint §3, §15).
 *
 * The analytics screen used to compute everything in the browser from the last
 * 100 call rows, and reported `leads: 0` because it had no lead data at all.
 * These aggregates run over the whole window in SQL, and include the
 * per-language accuracy/latency/transfer breakdown the architecture asks for.
 */
export async function GET(request: Request) {
  const auth = await requireCustomerPermission(request, 'analytics.view');
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const days = Math.min(
    Math.max(Number(url.searchParams.get('days') ?? 30), 1),
    365,
  );
  const since = `-${days} days`;
  const db = getRawDb();
  const organizationId = auth.session.organizationId;

  const [totals, daily, outcomes, sentiments, byLanguage, byAgent, leadDaily] =
    await Promise.all([
      db
        .prepare(`SELECT
            count(*) AS calls,
            coalesce(sum(duration_seconds), 0) AS total_seconds,
            coalesce(sum(cost_credits), 0) AS credits,
            coalesce(avg(nullif(latency_ms, 0)), 0) AS avg_latency,
            sum(CASE WHEN outcome IN ('resolved','information_provided','appointment_booked','payment_link_sent') THEN 1 ELSE 0 END) AS resolved,
            sum(CASE WHEN outcome = 'transferred_to_human' THEN 1 ELSE 0 END) AS transferred,
            sum(CASE WHEN status IN ('failed','provider_error','no_answer') THEN 1 ELSE 0 END) AS failed
          FROM call_records
          WHERE organization_id = ? AND started_at >= datetime('now', ?)`)
        .bind(organizationId, since)
        .first(),
      db
        .prepare(`SELECT date(started_at) AS day,
            count(*) AS calls,
            sum(CASE WHEN outcome IN ('appointment_booked','payment_link_sent','resolved') THEN 1 ELSE 0 END) AS conversions,
            coalesce(avg(nullif(latency_ms, 0)), 0) AS avg_latency
          FROM call_records
          WHERE organization_id = ? AND started_at >= datetime('now', ?)
          GROUP BY date(started_at) ORDER BY day`)
        .bind(organizationId, since)
        .all(),
      db
        .prepare(`SELECT coalesce(outcome, 'unknown') AS name, count(*) AS value
          FROM call_records
          WHERE organization_id = ? AND started_at >= datetime('now', ?)
          GROUP BY 1 ORDER BY value DESC`)
        .bind(organizationId, since)
        .all(),
      db
        .prepare(`SELECT coalesce(sentiment, 'unscored') AS name, count(*) AS value
          FROM call_records
          WHERE organization_id = ? AND started_at >= datetime('now', ?)
          GROUP BY 1 ORDER BY value DESC`)
        .bind(organizationId, since)
        .all(),
      // Per-language performance: the AI speaks many languages, so a drop in
      // one of them is invisible in a single blended average.
      db
        .prepare(`SELECT coalesce(t.language, a.primary_language, 'unknown') AS language,
            count(*) AS calls,
            coalesce(avg(nullif(c.latency_ms, 0)), 0) AS avg_latency,
            sum(CASE WHEN c.outcome = 'transferred_to_human' THEN 1 ELSE 0 END) AS transferred,
            coalesce(avg(q.overall_score), 0) AS avg_quality
          FROM call_records c
          LEFT JOIN transcripts t ON t.call_id = c.id
          LEFT JOIN voice_agents a ON a.id = c.agent_id
          LEFT JOIN call_quality_reviews q ON q.call_id = c.id
          WHERE c.organization_id = ? AND c.started_at >= datetime('now', ?)
          GROUP BY 1 ORDER BY calls DESC`)
        .bind(organizationId, since)
        .all(),
      db
        .prepare(`SELECT coalesce(a.name, 'Unassigned') AS agent,
            count(*) AS calls,
            coalesce(avg(nullif(c.latency_ms, 0)), 0) AS avg_latency,
            sum(CASE WHEN c.outcome IN ('resolved','information_provided','appointment_booked','payment_link_sent') THEN 1 ELSE 0 END) AS resolved
          FROM call_records c LEFT JOIN voice_agents a ON a.id = c.agent_id
          WHERE c.organization_id = ? AND c.started_at >= datetime('now', ?)
          GROUP BY 1 ORDER BY calls DESC LIMIT 10`)
        .bind(organizationId, since)
        .all(),
      db
        // `leads` records capture time as captured_at, not created_at.
        .prepare(`SELECT date(captured_at) AS day, count(*) AS leads
          FROM leads WHERE organization_id = ? AND captured_at >= datetime('now', ?)
          GROUP BY date(captured_at)`)
        .bind(organizationId, since)
        .all<{ day: string; leads: number }>(),
    ]);

  // Fill every day in the window so a gap reads as zero rather than closing up.
  const leadsByDay = new Map(
    (leadDaily.results ?? []).map((row) => [row.day, Number(row.leads)]),
  );
  const callsByDay = new Map(
    ((daily.results ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.day),
      row,
    ]),
  );
  const series = Array.from({ length: days }, (_, offset) => {
    const date = new Date();
    date.setDate(date.getDate() - (days - 1 - offset));
    const day = date.toISOString().slice(0, 10);
    const row = callsByDay.get(day);
    return {
      day,
      calls: Number(row?.calls ?? 0),
      conversions: Number(row?.conversions ?? 0),
      leads: leadsByDay.get(day) ?? 0,
      avgLatency: Math.round(Number(row?.avg_latency ?? 0)),
    };
  });

  const t = (totals ?? {}) as Record<string, unknown>;
  const callCount = Number(t.calls ?? 0);
  const rate = (value: unknown) =>
    callCount ? Math.round((Number(value ?? 0) / callCount) * 1000) / 10 : 0;

  return NextResponse.json({
    windowDays: days,
    totals: {
      calls: callCount,
      leads: Array.from(leadsByDay.values()).reduce((a, b) => a + b, 0),
      totalMinutes: Math.round(Number(t.total_seconds ?? 0) / 60),
      credits: Number(t.credits ?? 0),
      avgLatencyMs: Math.round(Number(t.avg_latency ?? 0)),
      resolutionRate: rate(t.resolved),
      transferRate: rate(t.transferred),
      failureRate: rate(t.failed),
    },
    series,
    outcomes: outcomes.results ?? [],
    sentiments: sentiments.results ?? [],
    byLanguage: ((byLanguage.results ?? []) as Array<Record<string, unknown>>).map(
      (row) => ({
        language: String(row.language),
        label: languageLabel(String(row.language)),
        calls: Number(row.calls ?? 0),
        avgLatencyMs: Math.round(Number(row.avg_latency ?? 0)),
        transferred: Number(row.transferred ?? 0),
        avgQuality: Math.round(Number(row.avg_quality ?? 0)),
      }),
    ),
    byAgent: ((byAgent.results ?? []) as Array<Record<string, unknown>>).map(
      (row) => ({
        agent: String(row.agent),
        calls: Number(row.calls ?? 0),
        avgLatencyMs: Math.round(Number(row.avg_latency ?? 0)),
        resolved: Number(row.resolved ?? 0),
      }),
    ),
  });
}
