import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';
import { recordAudit } from '@/lib/demo-seed';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import {
  DEFAULT_SEND_POLICY,
  MEDIA_KINDS,
  type MediaKind,
  type SendPolicy,
} from '@/lib/whatsapp-media';
import {
  allowedTransitions,
  canTransition,
  isAgentState,
  LIVE_STATE,
  publishReadiness,
  STATE_LABEL,
} from '@/lib/agent-lifecycle';
import {
  cloneAgent,
  listVersions,
  restoreVersion,
  snapshotAgent,
} from '@/lib/agent-versions';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const db = getRawDb();
  const [agents, onboarding, sessions, wallet] = await Promise.all([
    db
      .prepare(
        `SELECT * FROM voice_agents WHERE organization_id = ? ORDER BY updated_at DESC`,
      )
      .bind(auth.session.organizationId)
      .all(),
    db
      .prepare(`SELECT phone, use_case, primary_language, stage, trial_granted_at, completed_at
        FROM onboarding_profiles WHERE organization_id = ? LIMIT 1`)
      .bind(auth.session.organizationId)
      .first(),
    db
      .prepare(`SELECT s.id, s.agent_id, s.mode, s.status, s.credits_used, s.created_at,
          count(m.id) AS message_count
        FROM agent_test_sessions s
        LEFT JOIN agent_test_messages m ON m.session_id = s.id
        WHERE s.organization_id = ?
        GROUP BY s.id ORDER BY s.created_at DESC LIMIT 8`)
      .bind(auth.session.organizationId)
      .all(),
    db
      .prepare(
        'SELECT balance, low_balance_threshold FROM organization_wallets WHERE organization_id = ?',
      )
      .bind(auth.session.organizationId)
      .first(),
  ]);
  return NextResponse.json({
    agents: agents.results,
    onboarding,
    testSessions: sessions.results,
    wallet,
    testModes: [
      { id: 'text', label: 'Text chat', cost: 10, requiresNumber: false },
      {
        id: 'browser_voice',
        label: 'Browser voice',
        cost: 10,
        requiresNumber: false,
      },
      { id: 'phone', label: 'Phone call', cost: 10, requiresNumber: true },
    ],
  });
}

export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'agents.manage');
  if (auth.response) return auth.response;
  const body = (await request.json()) as {
    name?: string;
    useCase?: string;
    language?: string;
  };
  const name = body.name?.trim();
  if (!name || name.length > 60) {
    return NextResponse.json(
      { error: 'Agent name is required.' },
      { status: 400 },
    );
  }
  const db = getRawDb();
  const planLimit = await db
    .prepare(`SELECT p.max_agents FROM subscriptions s
      INNER JOIN plans p ON p.id = s.plan_id WHERE s.organization_id = ? LIMIT 1`)
    .bind(auth.session.organizationId)
    .first<{ max_agents: number }>();
  const count = await db
    .prepare(
      'SELECT count(*) AS total FROM voice_agents WHERE organization_id = ?',
    )
    .bind(auth.session.organizationId)
    .first<{ total: number }>();
  if (Number(count?.total ?? 0) >= Number(planLimit?.max_agents ?? 1)) {
    return NextResponse.json(
      { error: 'Your current plan agent limit has been reached.' },
      { status: 409 },
    );
  }
  const id = `agent_${crypto.randomUUID()}`;
  const language = body.language?.trim() || 'hi-IN';
  await db
    .prepare(`INSERT INTO voice_agents
      (id, organization_id, name, use_case, status, welcome_message, system_prompt,
       primary_language, tools_json, extractions_json, calling_config_json)
      VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`)
    .bind(
      id,
      auth.session.organizationId,
      name,
      body.useCase?.trim() || 'sales',
      language === 'en-IN'
        ? 'Hello, is now a good time to talk?'
        : language === 'haryanvi'
          ? 'राम राम जी, दो मिनट बात हो सके है?'
          : 'नमस्ते, क्या अभी दो मिनट बात कर सकते हैं?',
      'Be concise and natural. Confirm intent before using any external tool.',
      language,
      JSON.stringify([
        'send_whatsapp',
        'create_payment_link',
        'schedule_follow_up',
        'transfer_to_human',
      ]),
      JSON.stringify([
        'language',
        'intent',
        'product',
        'amount',
        'next_action',
      ]),
      JSON.stringify({ trialMode: true, inbound: false, outbound: false }),
    )
    .run();
  await recordAudit(auth.session, 'agent.created', 'voice_agent', id, { name });
  return NextResponse.json({ id }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireCustomerPermission(request, 'agents.manage');
  if (auth.response) return auth.response;
  const body = (await request.json()) as {
    id?: string;
    name?: string;
    useCase?: string;
    welcomeMessage?: string;
    systemPrompt?: string;
    primaryLanguage?: string;
    voiceName?: string;
    intelligenceProfile?: string;
    temperature?: number;
    maxTokens?: number;
    endpointingMs?: number;
    interruptWords?: number;
    tools?: string[];
    extractions?: string[];
    callingConfig?: Record<string, unknown>;
    sendPolicy?: unknown;
  };
  if (
    !body.id ||
    !body.name?.trim() ||
    !body.welcomeMessage?.trim() ||
    !body.systemPrompt?.trim()
  ) {
    return NextResponse.json(
      { error: 'Agent, name, welcome message and prompt are required.' },
      { status: 400 },
    );
  }
  // Snapshot before the change, so the stored version is the configuration
  // being replaced — the thing somebody rolling back actually wants.
  await snapshotAgent({
    organizationId: auth.session.organizationId!,
    agentId: body.id,
    note: 'Before an edit',
    userId: auth.session.userId,
  });
  const result = await getRawDb()
    .prepare(`UPDATE voice_agents SET
      name = ?, use_case = ?, welcome_message = ?, system_prompt = ?, primary_language = ?,
      voice_name = ?, intelligence_profile = ?, temperature = ?, max_tokens = ?,
      endpointing_ms = ?, interrupt_words = ?, tools_json = ?, extractions_json = ?,
      calling_config_json = ?, send_policy_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?`)
    .bind(
      body.name.trim(),
      body.useCase?.trim() || 'sales',
      body.welcomeMessage.trim(),
      body.systemPrompt.trim(),
      body.primaryLanguage || 'hi-IN',
      body.voiceName || 'Vaani Tara',
      body.intelligenceProfile || 'Vaani Sense Balanced',
      Math.max(0, Math.min(100, Number(body.temperature ?? 20))),
      Math.max(50, Math.min(1000, Number(body.maxTokens ?? 250))),
      Math.max(100, Math.min(2000, Number(body.endpointingMs ?? 250))),
      Math.max(1, Math.min(10, Number(body.interruptWords ?? 2))),
      JSON.stringify(body.tools ?? []),
      JSON.stringify(body.extractions ?? []),
      JSON.stringify(body.callingConfig ?? {}),
      // Normalised, never stored as sent: this decides what an agent may put
      // in front of a stranger, and a policy assembled from whatever arrived
      // in the request body is not a control.
      JSON.stringify(normaliseSendPolicy(body.sendPolicy)),
      body.id,
      auth.session.organizationId,
    )
    .run();
  if (!result.meta.changes) {
    return NextResponse.json({ error: 'Agent not found.' }, { status: 404 });
  }
  await recordAudit(auth.session, 'agent.updated', 'voice_agent', body.id);
  return NextResponse.json({ updated: true });
}

/**
 * The agent lifecycle (Part 2.1): state changes, versions, rollback, clone.
 *
 * Separate from PATCH on purpose. PATCH changes what an agent says; this
 * changes whether it is allowed to say it to a customer, and the two want
 * different guards.
 */
export async function PUT(request: Request) {
  const auth = await requireCustomerPermission(request, 'agents.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const organizationId = auth.session.organizationId!;
  const db = getRawDb();
  const body = (await request.json()) as {
    action?: string;
    agentId?: string;
    status?: string;
    version?: number;
  };
  const agentId = String(body.agentId ?? '');

  const agent = await db
    .prepare(`SELECT id, name, status, system_prompt, welcome_message, primary_language,
        voice_name, voice_profile_id, tools_json
      FROM voice_agents WHERE id = ? AND organization_id = ? LIMIT 1`)
    .bind(agentId, organizationId)
    .first<{
      id: string;
      name: string;
      status: string;
      system_prompt: string | null;
      welcome_message: string | null;
      primary_language: string | null;
      voice_name: string | null;
      voice_profile_id: string | null;
      tools_json: string | null;
    }>();
  if (!agent)
    return NextResponse.json({ error: 'Agent not found.' }, { status: 404 });

  if (body.action === 'versions')
    return NextResponse.json({
      versions: await listVersions(organizationId, agentId),
      state: agent.status,
      readiness: publishReadiness({
        name: agent.name,
        systemPrompt: agent.system_prompt,
        welcomeMessage: agent.welcome_message,
        primaryLanguage: agent.primary_language,
        voiceName: agent.voice_name,
        voiceProfileId: agent.voice_profile_id,
        tools: safeTools(agent.tools_json),
      }),
      allowed: isAgentState(agent.status)
        ? allowedTransitions(agent.status)
        : ['draft'],
    });

  if (body.action === 'clone') {
    const cloned = await cloneAgent({ organizationId, agentId });
    if (!cloned.ok)
      return NextResponse.json({ error: cloned.reason }, { status: 400 });
    await recordAudit(
      auth.session,
      'agent.cloned',
      'voice_agent',
      cloned.agentId,
      {
        from: agentId,
      },
    );
    return NextResponse.json(cloned);
  }

  if (body.action === 'restore') {
    const result = await restoreVersion({
      organizationId,
      agentId,
      version: Number(body.version),
      userId: auth.session.userId,
    });
    if (result.ok)
      await recordAudit(
        auth.session,
        'agent.restored',
        'voice_agent',
        agentId,
        {
          version: body.version,
          changed: result.changed,
        },
      );
    return NextResponse.json(result);
  }

  if (body.action === 'set_state') {
    const from = isAgentState(agent.status) ? agent.status : 'draft';
    const to = body.status;
    if (!isAgentState(to))
      return NextResponse.json({ error: 'Unknown state.' }, { status: 400 });
    if (!canTransition(from, to))
      return NextResponse.json(
        {
          ok: false,
          reason: `An agent that is ${STATE_LABEL[from].toLowerCase()} cannot go straight to ${STATE_LABEL[to].toLowerCase()}.`,
        },
        { status: 200 },
      );

    // Going live is gated on readiness, not on a button being enabled. The
    // screen can be wrong or stale; this cannot.
    if (to === LIVE_STATE) {
      const readiness = publishReadiness({
        name: agent.name,
        systemPrompt: agent.system_prompt,
        welcomeMessage: agent.welcome_message,
        primaryLanguage: agent.primary_language,
        voiceName: agent.voice_name,
        voiceProfileId: agent.voice_profile_id,
        tools: safeTools(agent.tools_json),
      });
      if (!readiness.ready)
        return NextResponse.json({
          ok: false,
          reason: `This agent still needs ${readiness.missing.join(', ')}.`,
          missing: readiness.missing,
        });
      await snapshotAgent({
        organizationId,
        agentId,
        note: 'Published',
        userId: auth.session.userId,
      });
    }

    await db
      .prepare(
        `UPDATE voice_agents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`,
      )
      .bind(to, agentId, organizationId)
      .run();
    await recordAudit(auth.session, `agent.${to}`, 'voice_agent', agentId, {
      from,
    });
    return NextResponse.json({ ok: true, status: to });
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}

function safeTools(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry: unknown): entry is string => typeof entry === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

/**
 * Cleans a send policy before it is stored.
 *
 * Every field is clamped to something the runtime can act on. An
 * `allowedKinds` holding a typo, a `maxAssets` of 500 or an `allowSensitive`
 * of the string "false" would all be read back later by the tool as though
 * somebody had chosen them.
 */
function normaliseSendPolicy(raw: unknown): SendPolicy {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const kinds = Array.isArray(input.allowedKinds)
    ? input.allowedKinds.filter((entry: unknown): entry is MediaKind =>
        (MEDIA_KINDS as readonly string[]).includes(entry as string),
      )
    : DEFAULT_SEND_POLICY.allowedKinds;
  const max = Number(input.maxAssets);
  return {
    allowedKinds: [...new Set(kinds)],
    maxAssets: Number.isFinite(max)
      ? Math.max(1, Math.min(10, Math.round(max)))
      : DEFAULT_SEND_POLICY.maxAssets,
    // Only an actual `true` releases sensitive files. Anything else — a
    // string, a missing field, a typo — leaves them behind a person.
    allowSensitive: input.allowSensitive === true,
  };
}
