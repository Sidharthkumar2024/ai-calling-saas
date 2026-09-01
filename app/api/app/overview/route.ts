import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
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

  const [leadStats, opportunityStats, calls, wallet, subscription, sources, numbers, recentLeads] =
    await Promise.all([
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
          `SELECT count(*) AS total,
             sum(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued
           FROM call_jobs WHERE organization_id = ?`,
        )
        .bind(organizationId)
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
    ]);

  return NextResponse.json({
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
  });
}
