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
    mode?: string;
    transport?: unknown;
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
      // The dialer knows the call ended, not what it achieved.
      outcome: 'unknown',
      disconnectReason: 'ended_by_agent',
    });
    // §6: the tab reports what its own socket carried. Every field is bounded
    // here rather than trusted — these numbers end up in support reports, and
    // a tab can send anything.
    const stats = recordTransport(body.transport);
    if (stats) {
      await db
        .prepare(
          `INSERT INTO call_transport_stats (
            id, organization_id, call_id, leg_role, transport, band, score,
            frames_sent, frames_received, send_kbps, receive_kbps,
            pacing_jitter_ms, worst_gap_ms, underruns, longest_silence_ms,
            socket_rtt_ms, socket_jitter_ms, primary_issue, warnings_json
          ) VALUES (?, ?, ?, 'agent', 'websocket', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          organizationId,
          callId,
          stats.band,
          stats.score,
          stats.framesSent,
          stats.framesReceived,
          stats.sendKbps,
          stats.receiveKbps,
          stats.pacingJitterMs,
          stats.worstGapMs,
          stats.underruns,
          stats.longestSilenceMs,
          stats.socketRttMs,
          stats.socketJitterMs,
          stats.primaryIssue,
          JSON.stringify(stats.warnings),
        )
        .run();
    }
    return NextResponse.json({ ended: true, ...result });
  }

  if (body.action === 'monitor') {
    // §12: a supervisor joins a live call to listen, whisper to the agent, or
    // join outright. The mode is signed into the token, so the browser cannot
    // promote itself from listening to speaking.
    const elevated = await requireCustomerPermission(request, 'calls.monitor');
    if (elevated.response) return elevated.response;
    if (!secret || !gatewayUrl)
      return NextResponse.json(
        {
          error:
            'Monitoring needs a media gateway. Set MEDIA_GATEWAY_SECRET and MEDIA_GATEWAY_WS_URL.',
        },
        { status: 503 },
      );
    const mode = ['listen', 'whisper', 'duplex'].includes(String(body.mode))
      ? (body.mode as 'listen' | 'whisper' | 'duplex')
      : 'listen';
    const callId = (body.callId ?? '').trim();
    const call = await db
      .prepare(`SELECT id, status, channel FROM call_records
        WHERE id = ? AND organization_id = ? LIMIT 1`)
      .bind(callId, organizationId)
      .first<{ id: string; status: string; channel: string }>();
    if (!call)
      return NextResponse.json({ error: 'Call not found.' }, { status: 404 });
    if (call.status !== 'in_progress')
      return NextResponse.json(
        {
          error: 'That call is not live, so there is nothing to listen to.',
          status: call.status,
        },
        { status: 409 },
      );
    const token = await mintDialerToken({
      callId,
      secret,
      role: 'supervisor',
      mode,
    });
    // Monitoring another person's conversation is always audited.
    await recordAudit(
      auth.session,
      `call.supervisor_${mode}`,
      'call_record',
      callId,
      { mode },
    );
    return NextResponse.json({
      callId,
      token,
      gatewayUrl,
      mode,
      expiresInSeconds: DIALER_TOKEN_TTL_SECONDS,
      note:
        mode === 'listen'
          ? 'You are silent on this call; nobody can hear you.'
          : mode === 'whisper'
            ? 'Only the agent hears you. The customer does not.'
            : 'Everyone on the call can hear you.',
    });
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
  await recordAudit(
    auth.session,
    'dialer.call_started',
    'call_record',
    callId,
    {
      agentId: agent.id,
      destination,
    },
  );
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

const BANDS = ['excellent', 'good', 'fair', 'poor'];

/**
 * Clamps a browser-reported transport summary into storable numbers. Returns
 * null when the payload carries nothing measurable, so a call without stats
 * stores no row rather than a row of zeros that reads like a silent call.
 */
function recordTransport(input: unknown) {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  // Only real strings are accepted: `String(someObject)` would store
  // "[object Object]" in a field support reads.
  const str = (value: unknown, max: number) =>
    typeof value === 'string' ? value.slice(0, max) : '';
  const int = (value: unknown, max: number) => {
    const number = Math.trunc(Number(value));
    return Number.isFinite(number) ? Math.max(0, Math.min(max, number)) : 0;
  };
  const real = (value: unknown, max: number) => {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.round(Math.max(0, Math.min(max, number)) * 10) / 10
      : 0;
  };
  const framesSent = int(raw.framesSent, 5_000_000);
  const framesReceived = int(raw.framesReceived, 5_000_000);
  if (!framesSent && !framesReceived) return null;
  const warnings = Array.isArray(raw.warnings)
    ? raw.warnings
        .filter(
          (entry): entry is Record<string, unknown> =>
            !!entry && typeof entry === 'object',
        )
        .slice(0, 8)
        .map((entry) => ({
          code: str(entry.code, 40),
          message: str(entry.message, 240),
        }))
        .filter((entry) => entry.code || entry.message)
    : [];
  return {
    band: BANDS.includes(str(raw.band, 20)) ? str(raw.band, 20) : null,
    score: int(raw.score, 100),
    framesSent,
    framesReceived,
    sendKbps: real(raw.sendKbps, 100_000),
    receiveKbps: real(raw.receiveKbps, 100_000),
    pacingJitterMs: real(raw.pacingJitterMs, 600_000),
    worstGapMs: int(raw.worstGapMs, 600_000),
    underruns: int(raw.underruns, 100_000),
    longestSilenceMs: int(raw.longestSilenceMs, 86_400_000),
    socketRttMs: int(raw.socketRttMs, 600_000),
    socketJitterMs: int(raw.socketJitterMs, 600_000),
    primaryIssue: str(raw.primaryIssue, 40) || null,
    warnings,
  };
}
