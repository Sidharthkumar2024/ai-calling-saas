import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';
import { simulateAgentTurn } from '@/lib/agent-simulator';

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
      return NextResponse.json({ error: 'Agent and no-call test mode are required.' }, { status: 400 });
    }
    const agent = await db
      .prepare(`SELECT id, welcome_message FROM voice_agents WHERE id = ? AND organization_id = ? LIMIT 1`)
      .bind(body.agentId, auth.session.organizationId)
      .first<{ id: string; welcome_message: string }>();
    if (!agent) return NextResponse.json({ error: 'Agent not found.' }, { status: 404 });
    const sessionId = `test_${crypto.randomUUID()}`;
    await db.batch([
      db
        .prepare(`INSERT INTO agent_test_sessions
          (id, organization_id, agent_id, mode, status) VALUES (?, ?, ?, ?, 'active')`)
        .bind(sessionId, auth.session.organizationId, agent.id, body.mode),
      db
        .prepare(`INSERT INTO agent_test_messages
          (id, session_id, role, content, actions_json, latency_ms) VALUES (?, ?, 'assistant', ?, '[]', 0)`)
        .bind(`message_${crypto.randomUUID()}`, sessionId, agent.welcome_message),
    ]);
    return NextResponse.json({ sessionId, message: agent.welcome_message, creditsUsed: 0 });
  }

  if (body.action === 'message') {
    const message = body.message?.trim();
    if (!body.sessionId || !message || message.length > 1000) {
      return NextResponse.json({ error: 'Active session and message are required.' }, { status: 400 });
    }
    const session = await db
      .prepare(`SELECT s.id, s.agent_id, s.mode, a.use_case, a.primary_language,
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
        use_case: string;
        primary_language: string;
        business_name: string;
        balance: number;
      }>();
    if (!session) return NextResponse.json({ error: 'Test session not found.' }, { status: 404 });
    if (Number(session.balance) < TEST_TURN_COST) {
      return NextResponse.json({ error: 'Trial credits are finished. Add credits to continue testing.' }, { status: 402 });
    }
    const simulated = simulateAgentTurn({
      message,
      useCase: session.use_case,
      language: session.primary_language,
      businessName: session.business_name,
    });
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
          simulated.response,
          JSON.stringify(simulated.actions),
          simulated.latencyMs,
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
    return NextResponse.json({
      message: simulated.response,
      actions: simulated.actions,
      extraction: simulated.extraction,
      latencyMs: simulated.latencyMs,
      creditsRemaining: nextBalance,
    });
  }

  return NextResponse.json({ error: 'Unsupported test action.' }, { status: 400 });
}
