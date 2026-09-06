import { getRawDb } from '@/db/index';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import {
  buildVoiceAgentInstructions,
  workspaceEnabledLanguages,
  createOpenAIRealtimeCall,
  ProviderConfigurationError,
} from '@/lib/provider-adapters';

export const dynamic = 'force-dynamic';
const REALTIME_SESSION_COST = 10;

export async function POST(request: Request) {
  // A realtime session spends provider credits against the workspace.
  const auth = await requireCustomerPermission(request, 'agents.manage');
  if (auth.response) return auth.response;
  const body = (await request.json()) as { agentId?: string; sdp?: string };
  const sdp = body.sdp?.trim() || '';
  if (!body.agentId || !sdp.startsWith('v=') || sdp.length > 64_000) {
    return Response.json(
      { error: 'Agent and a valid WebRTC offer are required.' },
      { status: 400 },
    );
  }
  const db = getRawDb();
  const agent = await db
    .prepare(`SELECT a.id, a.name, a.use_case, a.primary_language, a.system_prompt,
        a.max_tokens, o.name AS business_name, w.balance
      FROM voice_agents a
      INNER JOIN organizations o ON o.id = a.organization_id
      INNER JOIN organization_wallets w ON w.organization_id = a.organization_id
      WHERE a.id = ? AND a.organization_id = ? LIMIT 1`)
    .bind(body.agentId, auth.session.organizationId)
    .first<{
      id: string;
      name: string;
      use_case: string;
      primary_language: string;
      system_prompt: string;
      max_tokens: number;
      business_name: string;
      balance: number;
    }>();
  if (!agent)
    return Response.json({ error: 'Agent not found.' }, { status: 404 });
  if (Number(agent.balance) < REALTIME_SESSION_COST) {
    return Response.json(
      { error: 'Trial credits are finished. Add credits to continue testing.' },
      { status: 402 },
    );
  }
  try {
    const realtime = await createOpenAIRealtimeCall({
      organizationId: auth.session.organizationId!,
      sdp,
      instructions: buildVoiceAgentInstructions({
        agentName: agent.name,
        businessName: agent.business_name,
        useCase: agent.use_case,
        language: agent.primary_language,
        systemPrompt: agent.system_prompt,
        enabledLanguages: await workspaceEnabledLanguages(
          auth.session.organizationId!,
        ),
      }),
      maxOutputTokens: Number(agent.max_tokens || 180),
    });
    const sessionId = `test_${crypto.randomUUID()}`;
    const nextBalance = Number(agent.balance) - REALTIME_SESSION_COST;
    await db.batch([
      db
        .prepare(`INSERT INTO agent_test_sessions
        (id, organization_id, agent_id, mode, status, credits_used)
        VALUES (?, ?, ?, 'realtime', 'active', ?)`)
        .bind(
          sessionId,
          auth.session.organizationId,
          agent.id,
          REALTIME_SESSION_COST,
        ),
      db
        .prepare(`UPDATE organization_wallets SET balance = balance - ?,
        updated_at = CURRENT_TIMESTAMP WHERE organization_id = ? AND balance >= ?`)
        .bind(
          REALTIME_SESSION_COST,
          auth.session.organizationId,
          REALTIME_SESSION_COST,
        ),
      db
        .prepare(`INSERT INTO credit_ledger
        (id, organization_id, type, amount, balance_after, reference_type, reference_id, description)
        VALUES (?, ?, 'trial_usage', ?, ?, 'agent_test', ?, 'Realtime browser voice session')`)
        .bind(
          `credit_${crypto.randomUUID()}`,
          auth.session.organizationId,
          -REALTIME_SESSION_COST,
          nextBalance,
          sessionId,
        ),
    ]);
    return new Response(realtime.answerSdp, {
      status: 200,
      headers: {
        'content-type': 'application/sdp',
        'cache-control': 'no-store',
        'x-vaani-session-id': sessionId,
        'x-vaani-credits-remaining': String(nextBalance),
        'x-vaani-realtime-model': realtime.model,
        'x-vaani-negotiation-ms': String(realtime.latencyMs),
      },
    });
  } catch (error) {
    if (error instanceof ProviderConfigurationError) {
      return Response.json(
        { error: error.message, fallback: true },
        { status: 409 },
      );
    }
    console.error('Realtime browser connection failed.', error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Realtime browser connection failed.',
        fallback: true,
      },
      { status: 502 },
    );
  }
}
