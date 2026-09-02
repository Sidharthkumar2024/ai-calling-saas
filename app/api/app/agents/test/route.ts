import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';
import { simulateAgentTurn } from '@/lib/agent-simulator';
import {
  generateVoiceAgentTurn,
  providerReadiness,
  ProviderConfigurationError,
} from '@/lib/provider-adapters';

export const dynamic = 'force-dynamic';
const TEST_TURN_COST = 10;

export async function POST(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const body = (await request.json()) as {
    action?: 'start' | 'message';
    agentId?: string;
    sessionId?: string;
    mode?: 'text' | 'browser_voice';
    message?: string;
  };
  const db = getRawDb();
  if (body.action === 'start') {
    if (!body.agentId || !['text', 'browser_voice'].includes(body.mode ?? '')) {
      return NextResponse.json(
        { error: 'Agent and no-call test mode are required.' },
        { status: 400 },
      );
    }
    const agent = await db
      .prepare(
        `SELECT id, welcome_message FROM voice_agents WHERE id = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(body.agentId, auth.session.organizationId)
      .first<{ id: string; welcome_message: string }>();
    if (!agent)
      return NextResponse.json({ error: 'Agent not found.' }, { status: 404 });
    // Turn manager: a duplicate start (reconnect, double tap, re-render) must
    // reuse the live session instead of opening a new one and replaying the
    // greeting. Reuse only while no caller turn has happened yet.
    const reusable = await db
      .prepare(`SELECT s.id FROM agent_test_sessions s
        WHERE s.organization_id = ? AND s.agent_id = ? AND s.mode = ?
          AND s.status = 'active'
          AND (strftime('%s','now') - strftime('%s', s.created_at)) < 120
          AND NOT EXISTS (
            SELECT 1 FROM agent_test_messages m
            WHERE m.session_id = s.id AND m.role = 'user'
          )
        ORDER BY s.created_at DESC LIMIT 1`)
      .bind(auth.session.organizationId, agent.id, body.mode)
      .first<{ id: string }>();
    if (reusable) {
      return NextResponse.json({
        sessionId: reusable.id,
        message: agent.welcome_message,
        creditsUsed: 0,
        greetingPlayed: true,
        reusedSession: true,
        turnId: 0,
      });
    }
    const sessionId = `test_${crypto.randomUUID()}`;
    await db.batch([
      db
        .prepare(`INSERT INTO agent_test_sessions
          (id, organization_id, agent_id, mode, status) VALUES (?, ?, ?, ?, 'active')`)
        .bind(sessionId, auth.session.organizationId, agent.id, body.mode),
      db
        .prepare(`INSERT INTO agent_test_messages
          (id, session_id, role, content, actions_json, latency_ms) VALUES (?, ?, 'assistant', ?, '[]', 0)`)
        .bind(
          `message_${crypto.randomUUID()}`,
          sessionId,
          agent.welcome_message,
        ),
    ]);
    return NextResponse.json({
      sessionId,
      message: agent.welcome_message,
      creditsUsed: 0,
      greetingPlayed: true,
      reusedSession: false,
      turnId: 0,
    });
  }

  if (body.action === 'message') {
    const turnStarted = Date.now();
    const message = body.message?.trim();
    if (!body.sessionId || !message || message.length > 1000) {
      return NextResponse.json(
        { error: 'Active session and message are required.' },
        { status: 400 },
      );
    }
    const session = await db
      .prepare(`SELECT s.id, s.agent_id, s.mode, a.name AS agent_name, a.use_case,
          a.primary_language, a.system_prompt, a.max_tokens,
          o.name AS business_name, w.balance
        FROM agent_test_sessions s
        INNER JOIN voice_agents a ON a.id = s.agent_id
        INNER JOIN organizations o ON o.id = s.organization_id
        INNER JOIN organization_wallets w ON w.organization_id = s.organization_id
        WHERE s.id = ? AND s.organization_id = ? AND s.status = 'active' LIMIT 1`)
      .bind(body.sessionId, auth.session.organizationId)
      .first<{
        id: string;
        agent_id: string;
        mode: string;
        agent_name: string;
        use_case: string;
        primary_language: string;
        system_prompt: string;
        max_tokens: number;
        business_name: string;
        balance: number;
      }>();
    if (!session)
      return NextResponse.json(
        { error: 'Test session not found.' },
        { status: 404 },
      );
    if (Number(session.balance) < TEST_TURN_COST) {
      return NextResponse.json(
        {
          error: 'Trial credits are finished. Add credits to continue testing.',
        },
        { status: 402 },
      );
    }
    // Turn manager: one committed transcript => exactly one response. A
    // duplicate event (double send, retry, socket reconnect) replays the stored
    // answer instead of charging credits and calling the model twice.
    const duplicate = await db
      .prepare(`SELECT
          (SELECT a.content FROM agent_test_messages a
             WHERE a.session_id = u.session_id AND a.role = 'assistant'
               AND a.created_at >= u.created_at
             ORDER BY a.created_at ASC LIMIT 1) AS assistant_content,
          (SELECT a.actions_json FROM agent_test_messages a
             WHERE a.session_id = u.session_id AND a.role = 'assistant'
               AND a.created_at >= u.created_at
             ORDER BY a.created_at ASC LIMIT 1) AS actions_json
        FROM agent_test_messages u
        WHERE u.session_id = ? AND u.role = 'user' AND u.content = ?
          AND (strftime('%s','now') - strftime('%s', u.created_at)) < 10
        ORDER BY u.created_at DESC LIMIT 1`)
      .bind(session.id, message)
      .first<{ assistant_content: string | null; actions_json: string | null }>();
    const turnCount = await db
      .prepare(
        `SELECT COUNT(*) AS turns FROM agent_test_messages WHERE session_id = ? AND role = 'user'`,
      )
      .bind(session.id)
      .first<{ turns: number }>();
    const turnId = Number(turnCount?.turns ?? 0);
    if (duplicate?.assistant_content) {
      let repeatActions: unknown = [];
      try {
        repeatActions = JSON.parse(duplicate.actions_json || '[]');
      } catch {
        repeatActions = [];
      }
      return NextResponse.json({
        message: duplicate.assistant_content,
        actions: repeatActions,
        turnId,
        deduplicated: true,
        creditsRemaining: Number(session.balance),
      });
    }
    const history = await db
      .prepare(`SELECT role, content FROM agent_test_messages
      WHERE session_id = ? ORDER BY created_at DESC LIMIT 10`)
      .bind(session.id)
      .all<{ role: 'user' | 'assistant'; content: string }>();
    const orderedHistory = history.results.reverse();
    const simulated = simulateAgentTurn({
      message,
      useCase: session.use_case,
      language: session.primary_language,
      businessName: session.business_name,
      history: orderedHistory,
    });
    let responseText = simulated.response;
    let latencyMs = Math.max(simulated.latencyMs, Date.now() - turnStarted);
    let pipelineMode: 'connected' | 'fallback' | 'instant' = simulated.fastPath
      ? 'instant'
      : 'fallback';
    // Always prefer a connected reasoning provider so real questions get real
    // answers. The deterministic simulator is only a fallback for when no
    // provider is configured — it must never pre-empt the model.
    try {
      const live = await generateVoiceAgentTurn({
        organizationId: auth.session.organizationId!,
        agentName: session.agent_name,
        businessName: session.business_name,
        useCase: session.use_case,
        language: session.primary_language,
        systemPrompt: session.system_prompt,
        maxTokens: Number(session.max_tokens || 180),
        messages: [
          ...orderedHistory.map((item) => ({
            role: item.role,
            content: item.content,
          })),
          { role: 'user' as const, content: message },
        ],
      });
      responseText = live.text;
      latencyMs = live.latencyMs;
      pipelineMode = 'connected';
    } catch (error) {
      if (!(error instanceof ProviderConfigurationError)) {
        console.error(
          'Connected playground reasoning failed; using deterministic fallback.',
          error,
        );
      }
    }
    const nextBalance = Number(session.balance) - TEST_TURN_COST;
    const userMessageId = `message_${crypto.randomUUID()}`;
    const assistantMessageId = `message_${crypto.randomUUID()}`;
    const ledgerId = `credit_${crypto.randomUUID()}`;
    await db.batch([
      db
        .prepare(`INSERT INTO agent_test_messages
          (id, session_id, role, content, actions_json) VALUES (?, ?, 'user', ?, '[]')`)
        .bind(userMessageId, session.id, message),
      db
        .prepare(`INSERT INTO agent_test_messages
          (id, session_id, role, content, actions_json, latency_ms)
          VALUES (?, ?, 'assistant', ?, ?, ?)`)
        .bind(
          assistantMessageId,
          session.id,
          responseText,
          JSON.stringify(simulated.actions),
          latencyMs,
        ),
      db
        .prepare(`UPDATE agent_test_sessions SET credits_used = credits_used + ${TEST_TURN_COST},
          updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(session.id),
      db
        .prepare(`UPDATE organization_wallets SET balance = balance - ${TEST_TURN_COST},
          updated_at = CURRENT_TIMESTAMP WHERE organization_id = ? AND balance >= ${TEST_TURN_COST}`)
        .bind(auth.session.organizationId),
      db
        .prepare(`INSERT INTO credit_ledger
          (id, organization_id, type, amount, balance_after, reference_type, reference_id, description)
          VALUES (?, ?, 'trial_usage', -${TEST_TURN_COST}, ?, 'agent_test', ?, 'No-call agent playground turn')`)
        .bind(ledgerId, auth.session.organizationId, nextBalance, session.id),
    ]);
    // Whether a real TTS voice (Sarvam or ElevenLabs) is connected — so the
    // client can play server voice even when reasoning is in fallback mode.
    const readiness = await providerReadiness(auth.session.organizationId);
    const voiceConnected = readiness.some(
      (provider) =>
        (provider.adapter === 'sarvam' || provider.adapter === 'elevenlabs') &&
        provider.configured,
    );
    return NextResponse.json({
      message: responseText,
      actions: simulated.actions,
      extraction: simulated.extraction,
      latencyMs,
      pipelineMode,
      voiceConnected,
      turnId: turnId + 1,
      deduplicated: false,
      creditsRemaining: nextBalance,
    });
  }

  return NextResponse.json(
    { error: 'Unsupported test action.' },
    { status: 400 },
  );
}
