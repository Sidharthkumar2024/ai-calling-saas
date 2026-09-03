import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import { recordAudit } from '@/lib/demo-seed';
import { completeCall, ensurePlaygroundCallRecord } from '@/lib/call-telemetry';
import { mintDialerToken, DIALER_TOKEN_TTL_SECONDS } from '@/lib/dialer-token';
import { normalisePhone } from '@/lib/spreadsheet';

export const dynamic = 'force-dynamic';

/**
 * Browser dialer (§2, §9).
 *
 * Opens a call the agent's own tab carries the audio for. The tab never gets
 * the gateway secret — it gets a token bound to this one call, valid for two
 * minutes, which the gateway verifies with the secret it already holds.
 */
export async function GET(request: Request) {
  const auth = await requireCustomerPermission(request, 'calls.monitor');
  if (auth.response) return auth.response;
  const db = getRawDb();
  const organizationId = auth.session.organizationId;

  const [agents, numbers, recent] = await Promise.all([
    db
      .prepare(`SELECT id, name, primary_language FROM voice_agents
        WHERE organization_id = ? AND status != 'archived' ORDER BY name`)
      .bind(organizationId)
      .all(),
    db
      .prepare(`SELECT id, phone_number, status FROM phone_numbers
        WHERE organization_id = ? ORDER BY created_at DESC LIMIT 50`)
      .bind(organizationId)
      .all(),
    db
      .prepare(`SELECT c.id, c.to_number, c.customer_name, c.status, c.outcome,
          c.duration_seconds, c.started_at, a.name AS agent_name
        FROM call_records c LEFT JOIN voice_agents a ON a.id = c.agent_id
        WHERE c.organization_id = ? AND c.channel = 'browser'
        ORDER BY c.started_at DESC LIMIT 10`)
      .bind(organizationId)
      .all(),
  ]);

  return NextResponse.json({
    agents: agents.results ?? [],
    numbers: numbers.results ?? [],
    recent: recent.results ?? [],
    gatewayConfigured: Boolean(
      process.env.MEDIA_GATEWAY_SECRET && process.env.MEDIA_GATEWAY_WS_URL,
    ),
    tokenTtlSeconds: DIALER_TOKEN_TTL_SECONDS,
  });
}

export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'calls.monitor');
  if (auth.response) return auth.response;
  const body = (await request.json()) as {
    action?: string;
    agentId?: string;
    callId?: string;
    destination?: string;
    countryCode?: string;
    fromNumberId?: string;
  };
  const secret = process.env.MEDIA_GATEWAY_SECRET;
  const gatewayUrl = process.env.MEDIA_GATEWAY_WS_URL;
  const db = getRawDb();
  const organizationId = auth.session.organizationId!;

  if (body.action === 'end') {
    const callId = (body.callId ?? '').trim();
    const owned = await db
      .prepare(
        `SELECT id FROM call_records WHERE id = ? AND organization_id = ? AND channel = 'browser' LIMIT 1`,
      )
      .bind(callId, organizationId)
      .first<{ id: string }>();
    if (!owned)
      return NextResponse.json({ error: 'Call not found.' }, { status: 404 });
    const result = await completeCall({
      organizationId,
      callId,
      outcome: 'completed',
      disconnectReason: 'ended_by_agent',
    });
    return NextResponse.json({ ended: true, ...result });
  }

  if (body.action !== 'start')
    return NextResponse.json(
      { error: 'Unsupported dialer action.' },
      { status: 400 },
    );

  if (!secret || !gatewayUrl)
    return NextResponse.json(
      {
        error:
          'The browser dialer needs a media gateway. Set MEDIA_GATEWAY_SECRET and MEDIA_GATEWAY_WS_URL, and run services/media-gateway.',
      },
      { status: 503 },
    );

  const agentId = (body.agentId ?? '').trim();
  const agent = agentId
    ? await db
        .prepare(
          `SELECT id, name, primary_language FROM voice_agents WHERE id = ? AND organization_id = ? LIMIT 1`,
        )
        .bind(agentId, organizationId)
        .first<{ id: string; name: string; primary_language: string }>()
    : null;
  if (!agent)
    return NextResponse.json(
      { error: 'Choose an AI agent to talk to.' },
      { status: 400 },
    );

  // A destination is optional: an agent testing their own setup is talking to
  // the AI, not to a customer. When one is given it must be a real number.
  let destination: string | null = null;
  if ((body.destination ?? '').trim()) {
    const { phone, reason } = normalisePhone(
      body.destination!,
      (body.countryCode ?? '91').replace(/\D/g, '') || '91',
    );
    if (!phone)
      return NextResponse.json(
        { error: `That number is not valid (${reason}).` },
        { status: 400 },
      );
    destination = phone;
  }

  let fromNumber = 'browser';
  if ((body.fromNumberId ?? '').trim()) {
    const number = await db
      .prepare(
        `SELECT phone_number FROM phone_numbers WHERE id = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(body.fromNumberId, organizationId)
      .first<{ phone_number: string }>();
    if (!number)
      return NextResponse.json(
        { error: 'That caller ID does not belong to this workspace.' },
        { status: 404 },
      );
    fromNumber = number.phone_number;
  }

  await ensureSchema();
  const wallet = await db
    .prepare(
      `SELECT balance FROM organization_wallets WHERE organization_id = ? LIMIT 1`,
    )
    .bind(organizationId)
    .first<{ balance: number }>();
  if (Number(wallet?.balance ?? 0) < 10)
    return NextResponse.json(
      { error: 'At least 10 credits are required to start a call.' },
      { status: 402 },
    );

  // Reuse the telemetry writer so a browser call produces the same turns,
  // transcript, summary and QA review as any other conversation.
  const sessionId = `browser_${crypto.randomUUID()}`;
  const callId = await ensurePlaygroundCallRecord({
    organizationId,
    agentId: agent.id,
    sessionId,
    agentName: agent.name,
    language: agent.primary_language,
  });
  await db
    .prepare(`UPDATE call_records SET channel = 'browser', direction = 'outbound',
      from_number = ?, to_number = ? WHERE id = ?`)
    .bind(fromNumber, destination ?? 'ai_agent', callId)
    .run();

  const token = await mintDialerToken({ callId, secret });
  await recordAudit(auth.session, 'dialer.call_started', 'call_record', callId, {
    agentId: agent.id,
    destination,
  });
  return NextResponse.json({
    callId,
    token,
    gatewayUrl,
    expiresInSeconds: DIALER_TOKEN_TTL_SECONDS,
    agent: { id: agent.id, name: agent.name, language: agent.primary_language },
    destination,
    // Said plainly: this leg carries the agent's own audio. Bridging a real
    // customer onto it needs the carrier, which is separate.
    note: destination
      ? 'Your microphone is connected to the AI agent. Bridging the customer leg needs a carrier.'
      : 'Your microphone is connected to the AI agent.',
  });
}
