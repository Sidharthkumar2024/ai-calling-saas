import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { ingestLead, normalizeLeadInput } from '@/lib/lead-engine';
import { enforceRateLimit, requestFingerprint } from '@/lib/rate-limit';
import { originAllowed } from '@/lib/web-widget';

export const dynamic = 'force-dynamic';

/**
 * Lead capture and callback requests from the widget (§8).
 *
 * Separate from the session endpoint on purpose. This is the path a visitor
 * takes when the voice assistant could not start — out of credits, past its
 * cap, microphone refused — so it must keep working in exactly the cases the
 * other one refuses. A widget that offers "leave your number" and then fails
 * for the same reason the call did has offered nothing.
 *
 * It still checks the origin. A callback request creates a lead the workspace
 * will ring, so an open version of this is a way to make somebody's agent
 * dial a stranger.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ publicKey: string }> },
) {
  await ensureSchema();
  const { publicKey } = await params;
  const origin = request.headers.get('origin');
  const db = getRawDb();

  const widget = await db
    .prepare(`SELECT id, organization_id, allowed_origins_json, status
      FROM web_widgets WHERE public_key = ? LIMIT 1`)
    .bind(publicKey)
    .first<{
      id: string;
      organization_id: string;
      allowed_origins_json: string;
      status: string;
    }>();
  if (!widget || widget.status !== 'active')
    return cors(
      origin,
      { ok: false, message: 'This widget is not available.' },
      404,
    );
  if (!originAllowed(origin, safeList(widget.allowed_origins_json)))
    return cors(
      origin,
      { ok: false, message: 'This widget is not available.' },
      403,
    );

  const limit = await enforceRateLimit({
    namespace: 'widget-lead',
    identifier: requestFingerprint(request, publicKey),
    limit: 5,
    windowSeconds: 60 * 60,
  });
  if (!limit.allowed)
    return cors(
      origin,
      { ok: false, message: 'Thanks — we already have your request.' },
      429,
    );

  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  let lead: { id: string };
  try {
    lead = await ingestLead(
      widget.organization_id,
      normalizeLeadInput({
        ...body,
        sourceType: 'website_form',
        campaignName: 'Web voice widget',
        externalLeadId: `widget-${crypto.randomUUID()}`,
      }),
    );
  } catch (error) {
    // A missing or malformed number is the visitor's own mistake, and saying
    // so plainly is the entire point of offering the fallback.
    return cors(
      origin,
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : 'Please check the number and try again.',
      },
      400,
    );
  }

  await db
    .prepare(`INSERT INTO web_widget_sessions
      (id, widget_id, organization_id, lead_id, mode, origin, outcome, page_url)
      VALUES (?, ?, ?, ?, 'callback', ?, 'lead_captured', ?)`)
    .bind(
      `wws_${crypto.randomUUID()}`,
      widget.id,
      widget.organization_id,
      lead.id,
      origin,
      pageUrlOf(body.pageUrl),
    )
    .run();

  return cors(origin, {
    ok: true,
    // Says what will happen, not that it already has. Nobody has called yet.
    message: 'Thanks — we have your number and someone will call you back.',
  });
}

export async function OPTIONS(request: Request) {
  return cors(request.headers.get('origin'), null, 204);
}

function cors(origin: string | null, payload: unknown, status = 200) {
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
