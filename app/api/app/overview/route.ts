import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { CONVERSION_SQL_LIST } from '@/lib/call-outcomes';
import { workspaceOnboarding } from '@/lib/onboarding-service';
import { requireCustomer } from '@/lib/api-session';
import { ensureDemoLeads } from '@/lib/demo-seed';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const organizationId = auth.session.organizationId!;
  await ensureSchema();
  await ensureDemoLeads(organizationId);
  const db = getRawDb();

  const [
    leadStats,
    opportunityStats,
    calls,
    wallet,
    subscription,
    sources,
    numbers,
    recentLeads,
    activitySeries,
    outcomeBreakdown,
    readiness,
  ] = await Promise.all([
    db
      .prepare(
        `SELECT count(*) AS total,
             sum(CASE WHEN score >= 75 THEN 1 ELSE 0 END) AS qualified,
             round(avg(score), 1) AS average_score
           FROM leads WHERE organization_id = ?`,
      )
      .bind(organizationId)
      .first(),
    db
      .prepare(
        `SELECT count(*) AS total, coalesce(sum(estimated_value), 0) AS value
           FROM sales_opportunities WHERE organization_id = ?`,
      )
      .bind(organizationId)
      .first(),
    db
      .prepare(
        // Both numbers used to come from `call_jobs`, which nothing has ever
        // inserted a row into — so the tile read "0 calls, 0 queued" for a
        // workspace that had made hundreds. The real call log is
        // `call_records`, and the real queue is the campaign's own contacts.
        `SELECT
             (SELECT count(*) FROM call_records WHERE organization_id = ?) AS total,
             (SELECT count(*) FROM campaign_contacts cc
                JOIN campaigns c ON c.id = cc.campaign_id
              WHERE c.organization_id = ? AND cc.status = 'pending') AS queued`,
      )
      .bind(organizationId, organizationId)
      .first(),
    db
      .prepare(
        `SELECT balance, low_balance_threshold
           FROM organization_wallets WHERE organization_id = ?`,
      )
      .bind(organizationId)
      .first(),
    db
      .prepare(
        `SELECT s.status, s.current_period_end, p.id AS plan_id, p.name AS plan_name,
             p.code AS plan_code, p.included_credits, p.max_agents, p.max_numbers, p.concurrency
           FROM subscriptions s INNER JOIN plans p ON p.id = s.plan_id
           WHERE s.organization_id = ? LIMIT 1`,
      )
      .bind(organizationId)
      .first(),
    db
      .prepare(
        `SELECT type, name, status FROM lead_sources
           WHERE organization_id = ? ORDER BY name`,
      )
      .bind(organizationId)
      .all(),
    db
      .prepare(
        `SELECT id, phone_number, acquisition_type, assigned_agent_name,
             direction, kyc_status, status
           FROM phone_numbers WHERE organization_id = ? ORDER BY created_at DESC`,
      )
      .bind(organizationId)
      .all(),
    db
      .prepare(
        `SELECT l.id, l.name, l.phone, l.score, l.intent, l.status,
             l.ai_summary, s.name AS source_name, o.stage, o.estimated_value
           FROM leads l
           INNER JOIN lead_sources s ON s.id = l.source_id
           LEFT JOIN sales_opportunities o ON o.lead_id = l.id
           WHERE l.organization_id = ? ORDER BY l.captured_at DESC LIMIT 6`,
      )
      .bind(organizationId)
      .all(),
    db
      .prepare(`WITH RECURSIVE days(day) AS (
          SELECT date('now','-13 days') UNION ALL SELECT date(day,'+1 day') FROM days WHERE day < date('now')
        ) SELECT day,
          (SELECT count(*) FROM leads l WHERE l.organization_id = ? AND date(l.captured_at) = day) AS leads,
          (SELECT count(*) FROM call_records c WHERE c.organization_id = ? AND date(c.started_at) = day) AS calls,
          (SELECT count(*) FROM call_records c WHERE c.organization_id = ? AND date(c.started_at) = day
             AND c.outcome IN (${CONVERSION_SQL_LIST})) AS conversions
        FROM days`)
      .bind(organizationId, organizationId, organizationId)
      .all(),
    db
      .prepare(`SELECT coalesce(outcome, 'unknown') AS name, count(*) AS value
        FROM call_records WHERE organization_id = ? GROUP BY outcome ORDER BY value DESC`)
      .bind(organizationId)
      .all(),
    import('@/lib/provider-adapters').then(({ providerReadiness }) =>
      providerReadiness(organizationId),
    ),
  ]);

  // §3: the onboarding wizard's state, derived from evidence rather than a
  // stored counter — the previous `onboarding_profiles.stage` was written once
  // at signup and never advanced.
  const onboarding = await workspaceOnboarding(organizationId);

  return NextResponse.json({
    onboarding,
    workspace: {
      name: auth.session.organizationName,
      user: { name: auth.session.name, email: auth.session.email },
    },
    stats: {
      leads: Number(leadStats?.total ?? 0),
      qualified: Number(leadStats?.qualified ?? 0),
      averageScore: Number(leadStats?.average_score ?? 0),
      pipelineValue: Number(opportunityStats?.value ?? 0),
      opportunities: Number(opportunityStats?.total ?? 0),
      calls: Number(calls?.total ?? 0),
      queuedCalls: Number(calls?.queued ?? 0),
      credits: Number(wallet?.balance ?? 0),
      lowBalanceThreshold: Number(wallet?.low_balance_threshold ?? 0),
    },
    subscription,
    sources: sources.results,
    numbers: numbers.results,
    recentLeads: recentLeads.results,
    activitySeries: activitySeries.results,
    outcomeBreakdown: outcomeBreakdown.results,
    providerReadiness: readiness,
  });
}
