import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';
import { recordAudit } from '@/lib/demo-seed';
import { requireCustomerPermission } from '@/lib/customer-rbac';

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
  const result = await getRawDb()
    .prepare(`UPDATE voice_agents SET
      name = ?, use_case = ?, welcome_message = ?, system_prompt = ?, primary_language = ?,
      voice_name = ?, intelligence_profile = ?, temperature = ?, max_tokens = ?,
      endpointing_ms = ?, interrupt_words = ?, tools_json = ?, extractions_json = ?,
      calling_config_json = ?, updated_at = CURRENT_TIMESTAMP
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
