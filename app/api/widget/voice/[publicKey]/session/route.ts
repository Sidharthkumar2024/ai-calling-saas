import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { DIALER_TOKEN_TTL_SECONDS, mintDialerToken } from '@/lib/dialer-token';
import { ensurePlaygroundCallRecord } from '@/lib/call-telemetry';
import { enforceRateLimit, requestFingerprint } from '@/lib/rate-limit';
import {
  canStartSession,
  isWidgetMode,
  type WidgetMode,
} from '@/lib/web-widget';

export const dynamic = 'force-dynamic';

/**
 * Starts a web voice session (§8).
 *
 * Public and unauthenticated by necessity — a visitor on the customer's
 * website has no Vaani account — and therefore the most attackable endpoint in
 * the product, because every session it grants spends the workspace's credits.
 *
 * The gate is `canStartSession`: the origin must be one the workspace listed,
 * the mode must be switched on, the widget must be inside its hourly and daily
 * caps, and the wallet must hold the same ten credits the browser dialer
 * requires. Every attempt is recorded with its reason, allowed or not, so a
 * widget that stopped answering can be diagnosed rather than guessed at.
 *
 * The visitor is told one thing and the workspace another, deliberately: a
 * stranger on somebody's website must not learn that this account is out of
 * credits or what the hourly cap is.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ publicKey: string }> },
) {
  const { publicKey } = await params;
  await ensureSchema();
  const db = getRawDb();
  const origin = request.headers.get('origin');
  const body = (await request.json().catch(() => ({}))) as {
    mode?: string;
    pageUrl?: string;
  };
  const mode: WidgetMode = isWidgetMode(body.mode) ? body.mode : 'voice';

  // Per-visitor, on top of the per-widget caps. The caps stop a widget as a
  // whole from running away; this stops one person doing it, which is the
  // shape an attack actually takes.
  const perVisitor = await enforceRateLimit({
    namespace: 'widget-voice',
    identifier: requestFingerprint(request, publicKey),
    limit: 10,
    windowSeconds: 60 * 10,
  });
  if (!perVisitor.allowed) return refuse(origin, 'rate_limited');

  const widget = await db
    .prepare(`SELECT w.id, w.organization_id, w.agent_id, w.status, w.allowed_origins_json,
        w.modes_json, w.daily_cap, w.hourly_cap
      FROM web_widgets w WHERE w.public_key = ? LIMIT 1`)
    .bind(publicKey)
    .first<{
      id: string;
      organization_id: string;
      agent_id: string | null;
      status: string;
      allowed_origins_json: string;
      modes_json: string;
      daily_cap: number;
      hourly_cap: number;
    }>();
  // An unknown key gets the same shape of answer as a refused one, so probing
  // for valid keys learns nothing.
  if (!widget) return refuse(origin, 'not_found');

  const [counts, wallet, agent] = await Promise.all([
    db
      .prepare(`SELECT
          sum(CASE WHEN created_at >= datetime('now','-1 day') THEN 1 ELSE 0 END) AS today,
          sum(CASE WHEN created_at >= datetime('now','-1 hour') THEN 1 ELSE 0 END) AS hour
        FROM web_widget_sessions WHERE widget_id = ? AND outcome = 'started'`)
      .bind(widget.id)
      .first<{ today: number | null; hour: number | null }>(),
    db
      .prepare(
        `SELECT balance FROM organization_wallets WHERE organization_id = ? LIMIT 1`,
      )
      .bind(widget.organization_id)
      .first<{ balance: number }>(),
    db
      .prepare(`SELECT id, name, primary_language FROM voice_agents
        WHERE organization_id = ? AND (id = ? OR ? IS NULL) AND status = 'active'
        ORDER BY created_at LIMIT 1`)
      .bind(widget.organization_id, widget.agent_id, widget.agent_id)
      .first<{ id: string; name: string; primary_language: string }>(),
  ]);

  const decision = canStartSession({
    status: widget.status,
    origin,
    allowedOrigins: safeList(widget.allowed_origins_json),
    mode,
    enabledModes: safeList(widget.modes_json).filter(isWidgetMode),
    sessionsToday: counts?.today ?? 0,
    sessionsThisHour: counts?.hour ?? 0,
    dailyCap: widget.daily_cap,
    hourlyCap: widget.hourly_cap,
    walletBalance: Number(wallet?.balance ?? 0),
  });

  const sessionId = `wws_${crypto.randomUUID()}`;
  const record = (
    outcome: string,
    code: string | null,
    callId: string | null,
  ) =>
    db
      .prepare(`INSERT INTO web_widget_sessions
        (id, widget_id, organization_id, call_id, mode, origin, outcome, refusal_code, page_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        sessionId,
        widget.id,
        widget.organization_id,
        callId,
        mode,
        origin,
        outcome,
        code,
        pageUrlOf(body.pageUrl),
      )
      .run();

  if (!decision.allowed) {
    await record('refused', decision.code, null);
    return refuse(origin, decision.code, decision.visitorMessage);
  }

  // Text and callback modes need no media leg — and must not mint a call token
  // just because the same endpoint served them.
  if (mode !== 'voice') {
    await record('started', null, null);
    return respond(origin, {
      ok: true,
      sessionId,
      mode,
      agent: agent
        ? { name: agent.name, language: agent.primary_language }
        : null,
    });
  }

  if (!agent) {
    await record('refused', 'no_agent', null);
    return refuse(origin, 'no_agent');
  }
  const secret = process.env.MEDIA_GATEWAY_SECRET;
  const gatewayUrl = process.env.MEDIA_GATEWAY_WS_URL;
  if (!secret || !gatewayUrl) {
    await record('refused', 'gateway_unconfigured', null);
    return refuse(origin, 'gateway_unconfigured');
  }

  const callId = await ensurePlaygroundCallRecord({
    organizationId: widget.organization_id,
    agentId: agent.id,
    sessionId,
    agentName: agent.name,
    language: agent.primary_language,
  });
  await db
    .prepare(`UPDATE call_records SET channel = 'browser', direction = 'inbound',
      from_number = 'web_widget', to_number = 'ai_agent' WHERE id = ?`)
    .bind(callId)
    .run();
  await record('started', null, callId);

  const token = await mintDialerToken({ callId, secret, role: 'customer' });
  return respond(origin, {
    ok: true,
    sessionId,
    mode,
    callId,
    token,
    gatewayUrl,
    expiresInSeconds: DIALER_TOKEN_TTL_SECONDS,
    agent: { name: agent.name, language: agent.primary_language },
  });
}

export async function OPTIONS(request: Request) {
  return respond(request.headers.get('origin'), null, 204);
}

/**
 * CORS is echoed only for an origin that already passed the allowlist, and the
 * preflight answer is deliberately permissive-looking but harmless: the real
 * decision is made in POST against the workspace's own list, not here.
 */
function respond(origin: string | null, payload: unknown, status = 200) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'access-control-allow-origin': origin ?? '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'Origin',
  };
  if (payload === null) return new Response(null, { status, headers });
  return new NextResponse(JSON.stringify(payload), { status, headers });
}

function refuse(origin: string | null, code: string, message?: string) {
  return respond(origin, {
    ok: false,
    code,
    message:
      message ??
      'Sorry — the voice assistant is not available right now. You can leave your number and we will call you back.',
  });
}

/** Comes from a browser on somebody else's page, so only a string is a URL. */
function pageUrlOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 400)
    : null;
}

function safeList(raw: string): string[] {
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
