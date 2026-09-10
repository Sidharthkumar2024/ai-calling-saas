import { getRawDb } from '@/db/index';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import {
  buildVoiceAgentInstructions,
  workspaceEnabledLanguages,
  createOpenAIRealtimeCall,
  ProviderConfigurationError,
  RealtimeRejectedError,
} from '@/lib/provider-adapters';
import {
  realtimeDigest,
  reserveRealtime,
  refundRealtime,
  heartbeatRealtime,
  markRealtimeAccepted,
  HEARTBEAT_SECONDS,
} from '@/lib/realtime-reservations';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'agents.manage');
  if (auth.response) return auth.response;
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const db0 = getRawDb();
  const org0 = auth.session.organizationId!;

  // A live session reporting itself. Its beats are the only evidence this
  // server can have of how long it ran: the negotiation is browser-to-provider
  // and nothing here sees it end, so without them a session cost ten credits
  // whether it lasted ten seconds or an hour.
  if (body?.action === 'heartbeat') {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(sessionId))
      return Response.json(
        { error: 'Session id is required.' },
        { status: 400 },
      );
    const alive = await heartbeatRealtime(db0, sessionId, org0);
    return Response.json({
      alive,
      // Told rather than assumed: a tab that has been closed server-side
      // should stop beating instead of talking to a session that is gone.
      nextInSeconds: HEARTBEAT_SECONDS,
    });
  }

  const key = request.headers.get('idempotency-key') ?? body?.requestKey ?? '';
  if (
    !body ||
    typeof body.agentId !== 'string' ||
    typeof body.sdp !== 'string' ||
    !body.sdp.startsWith('v=') ||
    body.sdp.length > 64000 ||
    typeof key !== 'string' ||
    !/^[a-zA-Z0-9_-]{16,100}$/.test(key)
  )
    return Response.json(
      {
        error:
          'Agent, valid SDP and a request key (16–100 letters, digits, _ or -) are required.',
        fallback: false,
      },
      { status: 400 },
    );
  const db = getRawDb();
  const org = auth.session.organizationId!;
  const agent = await db
    .prepare(
      `SELECT a.id, a.name, a.use_case, a.primary_language, a.system_prompt, a.max_tokens, o.name AS business_name FROM voice_agents a JOIN organizations o ON o.id = a.organization_id WHERE a.id = ? AND a.organization_id = ? AND a.status != 'archived' LIMIT 1`,
    )
    .bind(body.agentId, org)
    .first<{
      id: string;
      name: string;
      use_case: string;
      primary_language: string;
      system_prompt: string;
      max_tokens: number;
      business_name: string;
    }>();
  if (!agent)
    return Response.json(
      { error: 'Agent not found.', fallback: false },
      { status: 404 },
    );
  const instructions = buildVoiceAgentInstructions({
    agentName: agent.name,
    businessName: agent.business_name,
    useCase: agent.use_case,
    language: agent.primary_language,
    systemPrompt: agent.system_prompt,
    enabledLanguages: await workspaceEnabledLanguages(org),
  });
  const id = 'rt_' + (await realtimeDigest(org + ':' + key));
  const requestHash = await realtimeDigest(
    JSON.stringify([agent.id, body.sdp]),
  );
  const reservation = await reserveRealtime(db, {
    id,
    organizationId: org,
    agentId: agent.id,
    requestHash,
  });
  if (reservation.mismatch)
    return Response.json(
      { error: 'This key was used for a different offer.', fallback: false },
      { status: 409 },
    );
  if (reservation.status === 'insufficient')
    return Response.json(
      { error: 'Add credits to start a voice session.', fallback: false },
      { status: 402 },
    );
  if (reservation.replay)
    return Response.json(
      {
        error:
          'This session request was already processed. Check its status before starting another.',
        sessionId: id,
        status: reservation.status,
        fallback: false,
      },
      { status: 409 },
    );
  // The cap this workspace is already at. Nothing was debited for this row —
  // the wallet update in the reservation batch only fires for a `reserved`
  // one — so carrying on to the provider would have run a free session and
  // put the workspace over its own limit at the same time.
  if (reservation.status === 'at_capacity')
    return Response.json(
      {
        error:
          'This workspace already has the most voice sessions it can run at once. End one and try again.',
        sessionId: id,
        status: reservation.status,
        fallback: false,
      },
      { status: 429 },
    );
  let acceptedReference: string | null = null;
  let accepted = false;
  try {
    const realtime = await createOpenAIRealtimeCall({
      organizationId: org,
      sdp: body.sdp,
      instructions,
      maxOutputTokens: Number(agent.max_tokens || 180),
    });
    accepted = true;
    acceptedReference = realtime.location;
    // The reservation stays `reserved` — see markRealtimeAccepted. The test
    // session beside it is what the studio screen shows, and that one really
    // is active now.
    await markRealtimeAccepted(db, {
      id,
      providerReference: realtime.location,
      errorCode: realtime.usageRecorded
        ? null
        : 'usage_reconciliation_required',
    });
    await db
      .prepare(
        `UPDATE agent_test_sessions SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .bind(id)
      .run();
    const wallet = await db
      .prepare(
        'SELECT balance FROM organization_wallets WHERE organization_id = ?',
      )
      .bind(org)
      .first<{ balance: number }>();
    return new Response(realtime.answerSdp, {
      headers: {
        'content-type': 'application/sdp',
        'cache-control': 'no-store',
        'x-vaani-session-id': id,
        'x-vaani-credits-remaining': String(wallet?.balance ?? 0),
        'x-vaani-realtime-model': realtime.model,
        'x-vaani-negotiation-ms': String(realtime.latencyMs),
        'x-vaani-billing-unit': 'realtime_session_v1',
      },
    });
  } catch (error) {
    if (
      error instanceof ProviderConfigurationError ||
      error instanceof RealtimeRejectedError
    ) {
      await refundRealtime(
        db,
        id,
        error instanceof ProviderConfigurationError
          ? 'not_configured'
          : 'provider_rejected',
      );
      return Response.json(
        {
          error:
            'Realtime is unavailable. The reservation was released; the standard voice playground can be used.',
          fallback: true,
        },
        { status: 409 },
      );
    }
    // A timeout, 5xx or post-acceptance DB error does not prove non-acceptance.
    await db
      .prepare(
        `UPDATE realtime_reservations SET status = 'reconciliation_required', provider_reference = ?, error_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .bind(
        acceptedReference,
        accepted ? 'accepted_local_write_failed' : 'acceptance_uncertain',
        id,
      )
      .run()
      .catch(() => {});
    return Response.json(
      {
        error:
          'Connection status is uncertain. 10 credits remain reserved for review. Contact support with this session ID before retrying.',
        sessionId: id,
        fallback: false,
      },
      { status: 502 },
    );
  }
}
