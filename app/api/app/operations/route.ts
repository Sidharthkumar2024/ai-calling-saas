import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';
import { recordAudit } from '@/lib/demo-seed';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  await ensureSchema();
  const db = getRawDb();
  const organizationId = auth.session.organizationId!;
  const [campaigns, trunks, knowledgeBases, workflows, graphAgents, calls, quality, alertRules, incidents, reports, settings, stats] = await Promise.all([
    scoped(db, 'campaigns', organizationId, 'created_at DESC'),
    scoped(db, 'sip_trunks', organizationId, 'created_at DESC'),
    scoped(db, 'knowledge_bases', organizationId, 'created_at DESC'),
    scoped(db, 'workflows', organizationId, 'created_at DESC'),
    scoped(db, 'graph_agents', organizationId, 'updated_at DESC'),
    db.prepare(`SELECT c.*, a.name AS agent_name, q.overall_score, q.status AS qa_status
      FROM call_records c LEFT JOIN voice_agents a ON a.id = c.agent_id
      LEFT JOIN call_quality_reviews q ON q.call_id = c.id
      WHERE c.organization_id = ? ORDER BY c.started_at DESC LIMIT 100`).bind(organizationId).all(),
    db.prepare(`SELECT q.*, c.customer_name, c.outcome, c.started_at
      FROM call_quality_reviews q INNER JOIN call_records c ON c.id = q.call_id
      WHERE q.organization_id = ? ORDER BY q.created_at DESC LIMIT 100`).bind(organizationId).all(),
    scoped(db, 'alert_rules', organizationId, 'created_at DESC'),
    db.prepare(`SELECT i.*, r.name AS rule_name, r.metric, r.threshold
      FROM alert_incidents i INNER JOIN alert_rules r ON r.id = i.rule_id
      WHERE i.organization_id = ? ORDER BY i.triggered_at DESC LIMIT 100`).bind(organizationId).all(),
    scoped(db, 'report_definitions', organizationId, 'created_at DESC'),
    db.prepare('SELECT * FROM organization_settings WHERE organization_id = ? LIMIT 1').bind(organizationId).first(),
    db.prepare(`SELECT
      count(*) AS total_calls,
      sum(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_calls,
      sum(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS live_calls,
      round(avg(CASE WHEN duration_seconds > 0 THEN duration_seconds END), 0) AS average_duration,
      round(avg(CASE WHEN latency_ms > 0 THEN latency_ms END), 0) AS average_latency,
      sum(CASE WHEN recording_status != 'not_available' THEN 1 ELSE 0 END) AS recordings,
      sum(cost_credits) AS credits_used
      FROM call_records WHERE organization_id = ?`).bind(organizationId).first(),
  ]);
  return NextResponse.json({
    campaigns: campaigns.results,
    sipTrunks: trunks.results,
    knowledgeBases: knowledgeBases.results,
    workflows: workflows.results,
    graphAgents: graphAgents.results,
    calls: calls.results,
    qualityReviews: quality.results,
    alertRules: alertRules.results,
    incidents: incidents.results,
    reports: reports.results,
    settings,
    stats,
  });
}

export async function POST(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const body = await request.json() as Record<string, unknown>;
  const action = clean(body.action, 60);
  const organizationId = auth.session.organizationId!;
  const db = getRawDb();
  const id = `${action.replace('create_', '')}_${crypto.randomUUID()}`;
  const name = clean(body.name, 100);

  if (action === 'create_campaign') {
    if (!name) return invalid('Campaign name is required.');
    const agent = await db.prepare('SELECT id FROM voice_agents WHERE organization_id = ? ORDER BY created_at LIMIT 1').bind(organizationId).first<{ id: string }>();
    await db.prepare(`INSERT INTO campaigns (id, organization_id, agent_id, name, status, audience_size, concurrency, retry_policy_json, calling_window_json)
      VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)`).bind(id, organizationId, agent?.id ?? null, name, bounded(body.audienceSize, 0, 1_000_000, 0), bounded(body.concurrency, 1, 50, 1), '{"attempts":3,"backoffMinutes":[120,1440]}', '{"timezone":"Asia/Kolkata","start":"10:00","end":"19:00"}').run();
  } else if (action === 'create_sip_trunk') {
    const gateway = clean(body.gatewayUri, 240);
    if (!name || !gateway || !gateway.startsWith('sip:')) return invalid('Name and a sip: gateway URI are required.');
    await db.prepare(`INSERT INTO sip_trunks (id, organization_id, name, provider, gateway_uri, auth_type, transport, media_encryption, codecs_json, status)
      VALUES (?, ?, ?, ?, ?, 'userpass', ?, ?, '["PCMU","PCMA"]', 'testing_required')`).bind(id, organizationId, name, clean(body.provider, 40) || 'custom', gateway, clean(body.transport, 8) || 'tls', clean(body.mediaEncryption, 12) || 'sdes').run();
  } else if (action === 'create_knowledge_base') {
    if (!name) return invalid('Knowledge base name is required.');
    await db.prepare(`INSERT INTO knowledge_bases (id, organization_id, name, description, language, status)
      VALUES (?, ?, ?, ?, ?, 'ready')`).bind(id, organizationId, name, clean(body.description, 500), clean(body.language, 60) || 'multilingual').run();
  } else if (action === 'create_workflow') {
    if (!name) return invalid('Workflow name is required.');
    await db.prepare(`INSERT INTO workflows (id, organization_id, name, trigger_type, status, steps_json)
      VALUES (?, ?, ?, ?, 'draft', ?)`).bind(id, organizationId, name, clean(body.triggerType, 100) || 'call.completed', JSON.stringify(body.steps ?? ['check_consent', 'update_crm'])).run();
  } else if (action === 'create_graph_agent') {
    if (!name) return invalid('Graph agent name is required.');
    await db.prepare(`INSERT INTO graph_agents (id, organization_id, name, status, graph_json)
      VALUES (?, ?, ?, 'draft', ?)`).bind(id, organizationId, name, JSON.stringify({ nodes: [{ id: 'greeting', type: 'conversation' }, { id: 'handoff', type: 'transfer' }], edges: [['greeting', 'handoff']] })).run();
  } else if (action === 'create_alert') {
    if (!name) return invalid('Alert name is required.');
    await db.prepare(`INSERT INTO alert_rules (id, organization_id, name, metric, comparator, threshold, window_minutes, frequency_minutes, channels_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`).bind(id, organizationId, name, clean(body.metric, 80) || 'call_failure_rate', ['>','<','>=','<='].includes(String(body.comparator)) ? body.comparator : '>', bounded(body.threshold, 0, 100_000, 10), bounded(body.windowMinutes, 5, 1440, 60), bounded(body.frequencyMinutes, 5, 1440, 15), JSON.stringify(['email', 'webhook'])).run();
  } else if (action === 'create_report') {
    if (!name) return invalid('Report name is required.');
    await db.prepare(`INSERT INTO report_definitions (id, organization_id, name, report_type, schedule, filters_json, status)
      VALUES (?, ?, ?, ?, ?, '{}', 'active')`).bind(id, organizationId, name, clean(body.reportType, 80) || 'call_performance', clean(body.schedule, 40) || 'manual').run();
  } else if (action === 'generate_report') {
    const reportId = clean(body.reportId, 140);
    const result = await db.prepare(`UPDATE report_definitions SET last_generated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?`).bind(reportId, organizationId).run();
    if (!result.meta.changes) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });
    await recordAudit(auth.session, 'report.generated', 'report', reportId);
    return NextResponse.json({ generated: true });
  } else if (action === 'update_settings') {
    const defaultLanguage = clean(body.defaultLanguage, 40) || 'hinglish';
    const recordingPolicy = ['disabled','record_with_consent','always_record'].includes(String(body.recordingPolicy)) ? String(body.recordingPolicy) : 'record_with_consent';
    await db.prepare(`INSERT INTO organization_settings
      (organization_id, timezone, default_language, enabled_languages_json, recording_policy, recording_retention_days, transcript_retention_days, qa_sample_rate, redact_sensitive_data, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(organization_id) DO UPDATE SET timezone=excluded.timezone, default_language=excluded.default_language,
      enabled_languages_json=excluded.enabled_languages_json, recording_policy=excluded.recording_policy,
      recording_retention_days=excluded.recording_retention_days, transcript_retention_days=excluded.transcript_retention_days,
      qa_sample_rate=excluded.qa_sample_rate, redact_sensitive_data=excluded.redact_sensitive_data, updated_at=CURRENT_TIMESTAMP`)
      .bind(organizationId, clean(body.timezone, 80) || 'Asia/Kolkata', defaultLanguage, JSON.stringify(['hi-IN','en-IN','hinglish','haryanvi']), recordingPolicy, bounded(body.recordingRetentionDays, 1, 3650, 90), bounded(body.transcriptRetentionDays, 1, 3650, 180), bounded(body.qaSampleRate, 0, 100, 100), body.redactSensitiveData === false ? 0 : 1).run();
    await recordAudit(auth.session, 'settings.updated', 'organization_settings', organizationId);
    return NextResponse.json({ updated: true });
  } else {
    return invalid('Unsupported operations action.');
  }

  await recordAudit(auth.session, `${action}.created`, action.replace('create_', ''), id, { name });
  return NextResponse.json({ id }, { status: 201 });
}

function scoped(db: D1Database, table: string, organizationId: string, order: string) {
  return db.prepare(`SELECT * FROM ${table} WHERE organization_id = ? ORDER BY ${order} LIMIT 100`).bind(organizationId).all();
}

function clean(value: unknown, max: number) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function bounded(value: unknown, min: number, max: number, fallback: number) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback; }
function invalid(error: string) { return NextResponse.json({ error }, { status: 400 }); }
