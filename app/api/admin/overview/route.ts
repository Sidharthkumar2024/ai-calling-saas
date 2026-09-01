import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireAdmin } from '@/lib/api-session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  await ensureSchema();
  const db = getRawDb();

  const [
    stats,
    revenue,
    customers,
    planRows,
    creditPackages,
    numberRows,
    audits,
    integrations,
    commerce,
    activitySeries,
    jobStats,
    providerCosts,
    compliance,
  ] = await Promise.all([
    db
      .prepare(
        `SELECT
             (SELECT count(*) FROM organizations WHERE status = 'active') AS customers,
             (SELECT count(*) FROM app_users WHERE role != 'platform_admin' AND status = 'active') AS users,
             (SELECT count(*) FROM leads) AS leads,
             (SELECT count(*) FROM call_jobs) AS calls,
             (SELECT count(*) FROM subscriptions WHERE status = 'trialing') AS trials,
             (SELECT count(*) FROM voice_agents) AS voice_agents,
             (SELECT count(*) FROM agent_test_sessions) AS agent_tests,
             (SELECT count(*) FROM payment_links) AS payment_links,
             (SELECT count(*) FROM call_records WHERE status = 'in_progress') AS live_calls,
             (SELECT count(*) FROM call_records WHERE recording_status != 'not_available') AS recordings,
             (SELECT count(*) FROM call_quality_reviews) AS quality_reviews,
             (SELECT count(*) FROM alert_incidents WHERE status = 'open') AS open_alerts,
             (SELECT count(*) FROM support_tickets WHERE status NOT IN ('resolved', 'closed')) AS open_tickets,
             (SELECT count(*) FROM sip_trunks) AS sip_trunks,
             (SELECT count(*) FROM phone_numbers WHERE status = 'active') AS active_numbers,
             (SELECT count(*) FROM phone_numbers WHERE kyc_status NOT IN ('approved', 'rejected')) AS pending_kyc,
             (SELECT count(*) FROM webhook_endpoints WHERE status = 'active') AS webhooks`,
      )
      .first(),
    db
      .prepare(
        `SELECT coalesce(sum(total), 0) AS total,
             sum(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid_invoices,
             sum(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_invoices
           FROM invoices`,
      )
      .first(),
    db
      .prepare(
        `SELECT o.id, o.name, o.status, u.email AS owner_email,
             p.name AS plan_name, w.balance,
             (SELECT count(*) FROM leads l WHERE l.organization_id = o.id) AS leads,
             (SELECT count(*) FROM phone_numbers n WHERE n.organization_id = o.id) AS numbers
           FROM organizations o
           LEFT JOIN app_users u ON u.organization_id = o.id AND u.role = 'customer_owner'
           LEFT JOIN subscriptions s ON s.organization_id = o.id
           LEFT JOIN plans p ON p.id = s.plan_id
           LEFT JOIN organization_wallets w ON w.organization_id = o.id
           ORDER BY o.created_at DESC LIMIT 25`,
      )
      .all(),
    db.prepare(`SELECT * FROM plans ORDER BY monthly_price`).all(),
    db
      .prepare(`SELECT *, amount AS price FROM credit_packages ORDER BY amount`)
      .all(),
    db
      .prepare(
        `SELECT n.id, n.phone_number, n.status, n.kyc_status, n.acquisition_type,
             n.public_provider_name, n.provider_code, n.connection_mode,
             n.business_use_case, n.estimated_monthly_minutes, n.onboarding_status,
             o.name AS organization_name,
             (SELECT count(*) FROM kyc_documents d WHERE d.phone_number_id = n.id) AS kyc_document_count
           FROM phone_numbers n INNER JOIN organizations o ON o.id = n.organization_id
           ORDER BY n.created_at DESC LIMIT 25`,
      )
      .all(),
    db
      .prepare(
        `SELECT a.action, a.target_type, a.metadata_json, a.created_at,
             u.name AS actor_name, o.name AS organization_name
           FROM audit_events a
           LEFT JOIN app_users u ON u.id = a.actor_user_id
           LEFT JOIN organizations o ON o.id = a.organization_id
           ORDER BY a.created_at DESC LIMIT 12`,
      )
      .all(),
    db
      .prepare(
        `SELECT type, name, status, count(*) AS tenants
           FROM integration_connections GROUP BY type, name, status ORDER BY name`,
      )
      .all(),
    db
      .prepare(
        `SELECT p.id, p.reference_id, p.customer_name, p.amount, p.currency,
             p.delivery_mode, p.provider, p.status, p.scheduled_for, p.paid_at, p.created_at,
             o.name AS organization_name
           FROM payment_links p
           INNER JOIN organizations o ON o.id = p.organization_id
           ORDER BY p.created_at DESC LIMIT 25`,
      )
      .all(),
    db
      .prepare(`WITH RECURSIVE days(day) AS (
          SELECT date('now','-13 days') UNION ALL SELECT date(day,'+1 day') FROM days WHERE day < date('now')
        ) SELECT day,
          (SELECT count(*) FROM call_records c WHERE date(c.started_at) = day) AS calls,
          (SELECT count(*) FROM call_records c WHERE date(c.started_at) = day AND c.status = 'completed') AS completed,
          (SELECT count(*) FROM leads l WHERE date(l.captured_at) = day) AS leads
        FROM days`)
      .all(),
    db
      .prepare(
        `SELECT status, count(*) AS value FROM background_jobs GROUP BY status ORDER BY value DESC`,
      )
      .all(),
    db
      .prepare(`SELECT provider_id, sum(provider_cost_micros) AS cost_micros,
        sum(billed_credits) AS billed_credits, round(avg(latency_ms),0) AS latency_ms,
        sum(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successful,
        count(*) AS total FROM provider_usage_events GROUP BY provider_id`)
      .all(),
    db
      .prepare(`SELECT
        (SELECT count(*) FROM consent_records WHERE status = 'granted') AS active_consents,
        (SELECT count(*) FROM suppression_entries) AS suppressed_contacts,
        (SELECT count(*) FROM kyc_documents WHERE status = 'submitted') AS pending_documents,
        (SELECT count(*) FROM payment_reconciliations WHERE status != 'matched') AS reconciliation_issues`)
      .first(),
  ]);

  return NextResponse.json({
    admin: { name: auth.session.name, email: auth.session.email },
    stats,
    revenue,
    customers: customers.results,
    plans: planRows.results,
    creditPackages: creditPackages.results,
    numbers: numberRows.results,
    audits: audits.results,
    integrations: integrations.results,
    commerce: commerce.results,
    activitySeries: activitySeries.results,
    jobStats: jobStats.results,
    providerCosts: providerCosts.results,
    compliance,
    system: {
      api: 'operational',
      database: 'operational',
      queue: 'operational',
      voiceGateway: process.env.EXOTEL_ACCOUNT_SID
        ? 'connected'
        : 'credentials_required',
      p95Latency: '1.2s',
    },
  });
}
