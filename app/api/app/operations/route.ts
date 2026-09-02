import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { recordAudit } from '@/lib/demo-seed';
import { encryptSecret } from '@/lib/security';
import { SUPPORTED_LANGUAGE_CODES } from '@/lib/languages';
import {
  type CustomerPermission,
  requireAnyCustomerPermission,
  requireCustomerPermission,
} from '@/lib/customer-rbac';

export const dynamic = 'force-dynamic';


export async function GET(request: Request) {
  const auth = await requireAnyCustomerPermission(request, [
    'calls.monitor',
    'analytics.view',
    'agents.manage',
    'campaigns.manage',
    'telephony.manage',
    'workspace.manage',
  ]);
  if (auth.response) return auth.response;
  await ensureSchema();
  const db = getRawDb();
  const organizationId = auth.session.organizationId!;
  const [
    campaigns,
    trunks,
    knowledgeBases,
    workflows,
    graphAgents,
    calls,
    quality,
    alertRules,
    incidents,
    reports,
    settings,
    stats,
    agentOptions,
    numberOptions,
  ] = await Promise.all([
    scoped(db, 'campaigns', organizationId, 'created_at DESC'),
    db
      .prepare(`SELECT id, name, provider, gateway_uri, auth_type, transport,
        media_encryption, codecs_json, status, last_checked_at, created_at,
        CASE WHEN encrypted_credentials IS NULL THEN 0 ELSE 1 END AS has_credentials
      FROM sip_trunks WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100`)
      .bind(organizationId)
      .all(),
    scoped(db, 'knowledge_bases', organizationId, 'created_at DESC'),
    scoped(db, 'workflows', organizationId, 'created_at DESC'),
    scoped(db, 'graph_agents', organizationId, 'updated_at DESC'),
    db
      .prepare(`SELECT c.id, c.agent_id, c.lead_id, c.campaign_id, c.direction,
        c.from_number, c.to_number, c.customer_name, c.status, c.outcome,
        c.duration_seconds, c.latency_ms, c.sentiment, c.summary,
        c.recording_status, c.cost_credits, c.disconnect_reason, c.started_at,
        c.ended_at, c.created_at, a.name AS agent_name, q.overall_score,
        q.status AS qa_status
      FROM call_records c LEFT JOIN voice_agents a ON a.id = c.agent_id
      LEFT JOIN call_quality_reviews q ON q.call_id = c.id
      WHERE c.organization_id = ? ORDER BY c.started_at DESC LIMIT 100`)
      .bind(organizationId)
      .all(),
    db
      .prepare(`SELECT q.*, c.customer_name, c.outcome, c.started_at
      FROM call_quality_reviews q INNER JOIN call_records c ON c.id = q.call_id
      WHERE q.organization_id = ? ORDER BY q.created_at DESC LIMIT 100`)
      .bind(organizationId)
      .all(),
    scoped(db, 'alert_rules', organizationId, 'created_at DESC'),
    db
      .prepare(`SELECT i.*, r.name AS rule_name, r.metric, r.threshold
      FROM alert_incidents i INNER JOIN alert_rules r ON r.id = i.rule_id
      WHERE i.organization_id = ? ORDER BY i.triggered_at DESC LIMIT 100`)
      .bind(organizationId)
      .all(),
    scoped(db, 'report_definitions', organizationId, 'created_at DESC'),
    db
      .prepare(
        'SELECT * FROM organization_settings WHERE organization_id = ? LIMIT 1',
      )
      .bind(organizationId)
      .first(),
    db
      .prepare(`SELECT
      count(*) AS total_calls,
      sum(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_calls,
      sum(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS live_calls,
      round(avg(CASE WHEN duration_seconds > 0 THEN duration_seconds END), 0) AS average_duration,
      round(avg(CASE WHEN latency_ms > 0 THEN latency_ms END), 0) AS average_latency,
      sum(CASE WHEN recording_status != 'not_available' THEN 1 ELSE 0 END) AS recordings,
      sum(cost_credits) AS credits_used
      FROM call_records WHERE organization_id = ?`)
      .bind(organizationId)
      .first(),
    db
      .prepare(`SELECT id, name, status, primary_language, voice_name FROM voice_agents
      WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100`)
      .bind(organizationId)
      .all(),
    db
      .prepare(`SELECT id, phone_number, status, direction, kyc_status FROM phone_numbers
      WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100`)
      .bind(organizationId)
      .all(),
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
    options: {
      agents: agentOptions.results,
      phoneNumbers: numberOptions.results,
      workflows: workflows.results,
    },
    settings,
    stats,
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const action = clean(body.action, 60);
  const permission = operationPermission(action);
  const auth = await requireCustomerPermission(request, permission);
  if (auth.response) return auth.response;
  await ensureSchema();
  const organizationId = auth.session.organizationId!;
  const db = getRawDb();
  const id = `${action.replace('create_', '')}_${crypto.randomUUID()}`;
  const name = clean(body.name, 100);

  if (action === 'create_campaign') {
    if (!name) return invalid('Campaign name is required.');
    const requestedAgentId = clean(body.agentId, 140);
    const agent = requestedAgentId
      ? await db
          .prepare(
            'SELECT id, status FROM voice_agents WHERE id = ? AND organization_id = ? LIMIT 1',
          )
          .bind(requestedAgentId, organizationId)
          .first<{ id: string; status: string }>()
      : await db
          .prepare(
            'SELECT id, status FROM voice_agents WHERE organization_id = ? ORDER BY created_at LIMIT 1',
          )
          .bind(organizationId)
          .first<{ id: string; status: string }>();
    if (!agent)
      return invalid('Choose an AI agent that belongs to this workspace.');
    const workflowId = clean(body.workflowId, 140);
    if (workflowId) {
      const workflow = await db
        .prepare(
          'SELECT id FROM workflows WHERE id = ? AND organization_id = ? LIMIT 1',
        )
        .bind(workflowId, organizationId)
        .first();
      if (!workflow)
        return invalid(
          'The selected workflow was not found in this workspace.',
        );
    }
    const fromNumberId = clean(body.fromNumberId, 140);
    if (fromNumberId) {
      const number = await db
        .prepare(
          'SELECT id FROM phone_numbers WHERE id = ? AND organization_id = ? LIMIT 1',
        )
        .bind(fromNumberId, organizationId)
        .first();
      if (!number)
        return invalid(
          'The selected calling number was not found in this workspace.',
        );
    }
    const rawContacts = Array.isArray(body.contacts) ? body.contacts : [];
    if (rawContacts.length > 1_000)
      return invalid(
        'Inline campaign creation supports up to 1,000 contacts. Use CSV/API batch import for larger audiences.',
      );
    const contacts = [
      ...new Set(
        rawContacts
          .map((value) => clean(value, 20).replace(/[\s()-]/g, ''))
          .filter((value) => /^\+[1-9]\d{7,14}$/.test(value)),
      ),
    ];
    if (rawContacts.length && !contacts.length)
      return invalid(
        'Add at least one valid E.164 contact, for example +919876543210.',
      );
    const granted = await db
      .prepare(`SELECT phone FROM consent_records WHERE organization_id = ? AND status = 'granted'
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP) LIMIT 10000`)
      .bind(organizationId)
      .all<{ phone: string }>();
    const grantedPhones = new Set(granted.results.map((item) => item.phone));
    const retryPolicy = {
      attempts: bounded(body.maxAttempts, 1, 8, 3),
      backoffMinutes: numberList(body.retryMinutes, 8, 1, 10_080, [120, 1440]),
      objective: clean(body.objective, 80) || 'lead_qualification',
      workflowId: workflowId || null,
      workflowVersion: bounded(body.workflowVersion, 1, 1000, 1),
      fromNumberId: fromNumberId || null,
    };
    const callingWindow = {
      timezone: clean(body.timezone, 80) || 'Asia/Kolkata',
      start: validTime(body.windowStart, '10:00'),
      end: validTime(body.windowEnd, '19:00'),
    };
    await db
      .prepare(`INSERT INTO campaigns (id, organization_id, agent_id, name, status, audience_size, concurrency, retry_policy_json, calling_window_json)
      VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)`)
      .bind(
        id,
        organizationId,
        agent.id,
        contacts.length || bounded(body.audienceSize, 0, 1_000_000, 0),
        bounded(body.concurrency, 1, 50, 1),
        JSON.stringify(retryPolicy),
        JSON.stringify(callingWindow),
      )
      .run();
    if (contacts.length) {
      await db.batch(
        contacts.map((phone) =>
          db
            .prepare(`INSERT INTO campaign_contacts
        (id, organization_id, campaign_id, phone, status, consent_status)
        VALUES (?, ?, ?, ?, 'pending', ?)`)
            .bind(
              `campaign_contact_${crypto.randomUUID()}`,
              organizationId,
              id,
              phone,
              grantedPhones.has(phone) ? 'granted' : 'unknown',
            ),
        ),
      );
    }
  } else if (action === 'create_sip_trunk') {
    const gateway = clean(body.gatewayUri, 240);
    if (!name || !gateway || !gateway.startsWith('sip:'))
      return invalid('Name and a sip: gateway URI are required.');
    const authType = ['userpass', 'ip'].includes(String(body.authType))
      ? String(body.authType)
      : 'userpass';
    const username = clean(body.username, 160);
    const password = clean(body.password, 500);
    if (authType === 'userpass' && (!username || !password))
      return invalid(
        'SIP username and password are required for credential authentication.',
      );
    const transport = ['tls', 'tcp', 'udp'].includes(String(body.transport))
      ? String(body.transport)
      : 'tls';
    const mediaEncryption = ['sdes', 'dtls', 'none'].includes(
      String(body.mediaEncryption),
    )
      ? String(body.mediaEncryption)
      : 'sdes';
    const codecs = stringList(body.codecs, 8)
      .map((value) => value.toUpperCase())
      .filter((value) => ['PCMU', 'PCMA', 'OPUS', 'G722'].includes(value));
    const encryptedCredentials =
      authType === 'userpass'
        ? await encryptSecret(JSON.stringify({ username, password }))
        : null;
    const trunkStatus =
      transport === 'tls' && mediaEncryption !== 'none'
        ? 'configuration_saved'
        : 'security_review_required';
    await db
      .prepare(`INSERT INTO sip_trunks (id, organization_id, name, provider, gateway_uri, auth_type, encrypted_credentials, transport, media_encryption, codecs_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        id,
        organizationId,
        name,
        clean(body.provider, 40) || 'custom',
        gateway,
        authType,
        encryptedCredentials,
        transport,
        mediaEncryption,
        JSON.stringify(codecs.length ? codecs : ['PCMU', 'PCMA']),
        trunkStatus,
      )
      .run();
  } else if (action === 'validate_sip_trunk') {
    const trunkId = clean(body.trunkId, 140);
    const trunk = await db
      .prepare(`SELECT id, auth_type, encrypted_credentials, transport,
        media_encryption, codecs_json FROM sip_trunks
      WHERE id = ? AND organization_id = ? LIMIT 1`)
      .bind(trunkId, organizationId)
      .first<{
        id: string;
        auth_type: string;
        encrypted_credentials: string | null;
        transport: string;
        media_encryption: string;
        codecs_json: string;
      }>();
    if (!trunk)
      return NextResponse.json(
        { error: 'SIP trunk not found.' },
        { status: 404 },
      );
    if (trunk.transport !== 'tls' || trunk.media_encryption === 'none') {
      return NextResponse.json(
        {
          error:
            'TLS and SRTP media encryption are required before provider testing.',
        },
        { status: 409 },
      );
    }
    if (trunk.auth_type === 'userpass' && !trunk.encrypted_credentials) {
      return NextResponse.json(
        { error: 'Encrypted SIP credentials are missing.' },
        { status: 409 },
      );
    }
    const codecs = stringList(JSON.parse(trunk.codecs_json) as unknown, 8);
    if (!codecs.length)
      return NextResponse.json(
        { error: 'At least one supported codec is required.' },
        { status: 409 },
      );
    await db
      .prepare(`UPDATE sip_trunks SET status = 'provider_test_pending',
      last_checked_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`)
      .bind(trunkId, organizationId)
      .run();
    await recordAudit(
      auth.session,
      'sip_trunk.validation_passed',
      'sip_trunk',
      trunkId,
      {
        nextStep: 'media_plane_options_and_register_test',
      },
    );
    return NextResponse.json({
      validated: true,
      status: 'provider_test_pending',
      nextStep:
        'The media plane must run SIP OPTIONS, REGISTER and a two-way audio test before activation.',
    });
  } else if (action === 'create_knowledge_base') {
    if (!name) return invalid('Knowledge base name is required.');
    await db
      .prepare(`INSERT INTO knowledge_bases (id, organization_id, name, description, language, status)
      VALUES (?, ?, ?, ?, ?, 'ready')`)
      .bind(
        id,
        organizationId,
        name,
        clean(body.description, 500),
        clean(body.language, 60) || 'multilingual',
      )
      .run();
  } else if (action === 'create_workflow') {
    if (!name) return invalid('Workflow name is required.');
    const allowedSteps = new Set([
      'check_consent',
      'update_crm',
      'send_follow_up',
      'send_whatsapp',
      'create_payment_link',
      'schedule_follow_up',
      'sync_retargeting',
      'notify_human',
    ]);
    const steps = stringList(body.steps, 20).filter((step) =>
      allowedSteps.has(step),
    );
    if (!steps.length)
      return invalid('Add at least one supported workflow step.');
    await db
      .prepare(`INSERT INTO workflows (id, organization_id, name, trigger_type, status, steps_json)
      VALUES (?, ?, ?, ?, 'draft', ?)`)
      .bind(
        id,
        organizationId,
        name,
        clean(body.triggerType, 100) || 'call.completed',
        JSON.stringify(steps),
      )
      .run();
  } else if (action === 'create_graph_agent') {
    if (!name) return invalid('Graph agent name is required.');
    await db
      .prepare(`INSERT INTO graph_agents (id, organization_id, name, status, graph_json)
      VALUES (?, ?, ?, 'draft', ?)`)
      .bind(
        id,
        organizationId,
        name,
        JSON.stringify({
          nodes: [
            { id: 'greeting', type: 'conversation' },
            { id: 'handoff', type: 'transfer' },
          ],
          edges: [['greeting', 'handoff']],
        }),
      )
      .run();
  } else if (action === 'create_alert') {
    if (!name) return invalid('Alert name is required.');
    await db
      .prepare(`INSERT INTO alert_rules (id, organization_id, name, metric, comparator, threshold, window_minutes, frequency_minutes, channels_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`)
      .bind(
        id,
        organizationId,
        name,
        clean(body.metric, 80) || 'call_failure_rate',
        ['>', '<', '>=', '<='].includes(String(body.comparator))
          ? body.comparator
          : '>',
        bounded(body.threshold, 0, 100_000, 10),
        bounded(body.windowMinutes, 5, 1440, 60),
        bounded(body.frequencyMinutes, 5, 1440, 15),
        JSON.stringify(['email', 'webhook']),
      )
      .run();
  } else if (action === 'create_report') {
    if (!name) return invalid('Report name is required.');
    await db
      .prepare(`INSERT INTO report_definitions (id, organization_id, name, report_type, schedule, filters_json, status)
      VALUES (?, ?, ?, ?, ?, '{}', 'active')`)
      .bind(
        id,
        organizationId,
        name,
        clean(body.reportType, 80) || 'call_performance',
        clean(body.schedule, 40) || 'manual',
      )
      .run();
  } else if (action === 'generate_report') {
    const reportId = clean(body.reportId, 140);
    const result = await db
      .prepare(`UPDATE report_definitions SET last_generated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?`)
      .bind(reportId, organizationId)
      .run();
    if (!result.meta.changes)
      return NextResponse.json({ error: 'Report not found.' }, { status: 404 });
    await recordAudit(auth.session, 'report.generated', 'report', reportId);
    return NextResponse.json({ generated: true });
  } else if (action === 'update_settings') {
    const defaultLanguage = clean(body.defaultLanguage, 40) || 'hinglish';
    // Honour the submitted language set (validated) instead of overwriting it
    // with a fixed list — that overwrite is why Punjabi could not be saved.
    const submittedLanguages = Array.isArray(body.enabledLanguages)
      ? body.enabledLanguages
          .map((item) => String(item))
          .filter((item) => SUPPORTED_LANGUAGE_CODES.has(item))
      : [];
    const enabledLanguages = submittedLanguages.length
      ? Array.from(new Set([defaultLanguage, ...submittedLanguages]))
      : ['hi-IN', 'en-IN', 'hinglish', 'haryanvi'];
    const recordingPolicy = [
      'disabled',
      'record_with_consent',
      'always_record',
    ].includes(String(body.recordingPolicy))
      ? String(body.recordingPolicy)
      : 'record_with_consent';
    await db
      .prepare(`INSERT INTO organization_settings
      (organization_id, timezone, default_language, enabled_languages_json, recording_policy, recording_retention_days, transcript_retention_days, qa_sample_rate, redact_sensitive_data, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(organization_id) DO UPDATE SET timezone=excluded.timezone, default_language=excluded.default_language,
      enabled_languages_json=excluded.enabled_languages_json, recording_policy=excluded.recording_policy,
      recording_retention_days=excluded.recording_retention_days, transcript_retention_days=excluded.transcript_retention_days,
      qa_sample_rate=excluded.qa_sample_rate, redact_sensitive_data=excluded.redact_sensitive_data, updated_at=CURRENT_TIMESTAMP`)
      .bind(
        organizationId,
        clean(body.timezone, 80) || 'Asia/Kolkata',
        defaultLanguage,
        JSON.stringify(enabledLanguages),
        recordingPolicy,
        bounded(body.recordingRetentionDays, 1, 3650, 90),
        bounded(body.transcriptRetentionDays, 1, 3650, 180),
        bounded(body.qaSampleRate, 0, 100, 100),
        body.redactSensitiveData === false ? 0 : 1,
      )
      .run();
    await recordAudit(
      auth.session,
      'settings.updated',
      'organization_settings',
      organizationId,
    );
    return NextResponse.json({ updated: true });
  } else {
    return invalid('Unsupported operations action.');
  }

  await recordAudit(
    auth.session,
    `${action}.created`,
    action.replace('create_', ''),
    id,
    { name },
  );
  return NextResponse.json({ id }, { status: 201 });
}

function scoped(
  db: D1Database,
  table: string,
  organizationId: string,
  order: string,
) {
  return db
    .prepare(
      `SELECT * FROM ${table} WHERE organization_id = ? ORDER BY ${order} LIMIT 100`,
    )
    .bind(organizationId)
    .all();
}

function clean(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function bounded(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n)
    ? Math.max(min, Math.min(max, Math.round(n)))
    : fallback;
}
function stringList(value: unknown, max: number) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().slice(0, 100))
        .filter(Boolean)
        .slice(0, max)
    : [];
}
function numberList(
  value: unknown,
  max: number,
  min: number,
  ceiling: number,
  fallback: number[],
) {
  const result = Array.isArray(value)
    ? value
        .map(Number)
        .filter(
          (item) => Number.isFinite(item) && item >= min && item <= ceiling,
        )
        .slice(0, max)
    : [];
  return result.length ? result : fallback;
}
function validTime(value: unknown, fallback: string) {
  const result = clean(value, 5);
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(result) ? result : fallback;
}
function invalid(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}
// Explicit map, not substring matching: a new action must be classified
// deliberately rather than inheriting a permission by accident. Report and
// alert creation are writes, so they need analytics.manage — analytics.view is
// read-only by definition and must never authorise a mutation.
const OPERATION_PERMISSIONS: Record<string, CustomerPermission> = {
  create_campaign: 'campaigns.manage',
  create_sip_trunk: 'telephony.manage',
  validate_sip_trunk: 'telephony.manage',
  create_knowledge_base: 'agents.manage',
  create_workflow: 'agents.manage',
  create_graph_agent: 'agents.manage',
  create_alert: 'analytics.manage',
  create_report: 'analytics.manage',
  generate_report: 'analytics.manage',
  update_settings: 'workspace.manage',
};

function operationPermission(action: string): CustomerPermission {
  // Unknown actions fall to the most restrictive workspace permission so a new
  // handler cannot ship unguarded.
  return OPERATION_PERMISSIONS[action] ?? 'workspace.manage';
}
