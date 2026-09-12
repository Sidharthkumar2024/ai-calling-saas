import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireAdminCapability } from '@/lib/admin-rbac';
import { recordAudit } from '@/lib/demo-seed';
import { enforceRateLimit, requestFingerprint } from '@/lib/rate-limit';
import { sha256 } from '@/lib/security';
import {
  MAX_PIN_ATTEMPTS,
  SESSION_TTL_MS,
  normalisePin,
  pinMessage,
  pinState,
  project,
  sessionState,
  type PinRow,
} from '@/lib/support-access';

export const dynamic = 'force-dynamic';

/**
 * Support Executive portal (§30).
 *
 * Nothing here reads a customer's data without an active session, and a session
 * exists only because that customer generated a PIN and read it out. The
 * `impersonation` this replaces did not exist at all — the word appeared once
 * in the repository, in a roadmap sentence.
 */
export async function GET(request: Request) {
  const auth = await requireAdminCapability(request, 'support.access');
  if (auth.response) return auth.response;
  await ensureSchema();
  const db = getRawDb();
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session');

  if (!sessionId) {
    // The queue: what a support executive sees *without* opening anything.
    // Tenant, plan and a diagnostic code are enough to answer most tickets, and
    // none of it needs a customer to grant access.
    const [tickets, sessions] = await Promise.all([
      db
        .prepare(
          `SELECT t.id, t.subject, t.status, t.priority, t.diagnostic_code,
             t.created_at, t.updated_at, o.id AS organization_id, o.name AS organization_name,
             o.status AS organization_status,
             (SELECT p.name FROM subscriptions s
                INNER JOIN plans p ON p.id = s.plan_id
                WHERE s.organization_id = o.id ORDER BY s.created_at DESC LIMIT 1) AS plan_name,
             (SELECT count(*) FROM background_jobs j
                WHERE j.organization_id = o.id AND j.status = 'dead_letter') AS failed_jobs
           FROM support_tickets t
           INNER JOIN organizations o ON o.id = t.organization_id
           ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
             t.updated_at DESC
           LIMIT 100`,
        )
        .all(),
      db
        .prepare(
          `SELECT s.id, s.organization_id, o.name AS organization_name, s.executive_email,
             s.reason, s.view_count, s.expires_at, s.ended_at, s.created_at
           FROM support_sessions s
           INNER JOIN organizations o ON o.id = s.organization_id
           ORDER BY s.created_at DESC LIMIT 25`,
        )
        .all(),
    ]);
    return NextResponse.json({
      tickets: tickets.results ?? [],
      sessions: (sessions.results ?? []).map((row) => ({
        ...row,
        state: sessionState(
          row as { expires_at: string; ended_at: string | null },
        ),
      })),
      adminRole: auth.adminRole,
    });
  }

  const session = await db
    .prepare(
      `SELECT id, organization_id, executive_user_id, expires_at, ended_at
       FROM support_sessions WHERE id = ? LIMIT 1`,
    )
    .bind(sessionId)
    .first<{
      id: string;
      organization_id: string;
      executive_user_id: string;
      expires_at: string;
      ended_at: string | null;
    }>();
  const state = sessionState(session);
  if (state !== 'active')
    return NextResponse.json(
      {
        error:
          state === 'expired'
            ? 'This support session has expired. Ask the customer for a new PIN.'
            : 'This support session is closed.',
        state,
      },
      { status: 403 },
    );
  // A session belongs to the executive who opened it. Sharing a session id
  // would be a way to use somebody else's grant under your own name.
  if (session!.executive_user_id !== auth.session.userId)
    return NextResponse.json(
      { error: 'This session belongs to another support executive.' },
      { status: 403 },
    );

  const organizationId = session!.organization_id;
  const [workspace, subscription, wallet, diagnostics, errors, tickets, calls] =
    await Promise.all([
      db
        .prepare(
          `SELECT id, name, slug, status, created_at, coalesce(currency,'INR') AS currency
           FROM organizations WHERE id = ? LIMIT 1`,
        )
        .bind(organizationId)
        .first<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT p.name AS plan_name, p.code AS plan_code, s.status, s.current_period_end
           FROM subscriptions s INNER JOIN plans p ON p.id = s.plan_id
           WHERE s.organization_id = ? ORDER BY s.created_at DESC LIMIT 1`,
        )
        .bind(organizationId)
        .first<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT balance, low_balance_threshold FROM organization_wallets WHERE organization_id = ? LIMIT 1`,
        )
        .bind(organizationId)
        .first<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT support_code, readiness, quality_band, rtt_ms, browser, created_at
           FROM device_test_runs WHERE organization_id = ?
           ORDER BY created_at DESC LIMIT 5`,
        )
        .bind(organizationId)
        .all<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT type, status, last_error, created_at FROM background_jobs
           WHERE organization_id = ? AND last_error IS NOT NULL
           ORDER BY created_at DESC LIMIT 10`,
        )
        .bind(organizationId)
        .all<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT id, subject, status, priority, created_at, updated_at
           FROM support_tickets WHERE organization_id = ?
           ORDER BY updated_at DESC LIMIT 10`,
        )
        .bind(organizationId)
        .all<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT id, status, outcome, duration_seconds, started_at FROM call_records
           WHERE organization_id = ? ORDER BY started_at DESC LIMIT 10`,
        )
        .bind(organizationId)
        .all<Record<string, unknown>>(),
    ]);

  // Every read is counted and audited. A "quick look" that turns into an hour
  // of browsing should be visible afterwards, to the customer as much as to us.
  await db
    .prepare(
      `UPDATE support_sessions SET view_count = view_count + 1 WHERE id = ?`,
    )
    .bind(sessionId)
    .run();
  await recordAudit(
    auth.session,
    'support.view_read',
    'support_session',
    sessionId,
    { organizationId },
  );

  // Projected through the allow-list, never returned raw.
  return NextResponse.json({
    session: { id: sessionId, expiresAt: session!.expires_at },
    workspace: workspace ? project('workspace', workspace) : null,
    subscription: subscription ? project('subscription', subscription) : null,
    wallet: wallet ? project('wallet', wallet) : null,
    diagnostics: (diagnostics.results ?? []).map((row) =>
      project('diagnostics', row),
    ),
    recentErrors: (errors.results ?? []).map((row) => project('errors', row)),
    tickets: (tickets.results ?? []).map((row) => project('tickets', row)),
    calls: (calls.results ?? []).map((row) => project('calls', row)),
  });
}

export async function POST(request: Request) {
  const auth = await requireAdminCapability(request, 'support.access');
  if (auth.response) return auth.response;
  await ensureSchema();
  const db = getRawDb();
  const body = (await request.json()) as {
    action?: string;
    organizationId?: string;
    pin?: string;
    reason?: string;
    ticketId?: string;
    sessionId?: string;
  };

  if (body.action === 'open_session') {
    // Rate limited per executive, because the thing being stopped is guessing
    // eight characters rather than one wrong entry.
    const limit = await enforceRateLimit({
      namespace: 'support-pin',
      identifier: `${auth.session.userId}:${requestFingerprint(request)}`,
      limit: 10,
      windowSeconds: 600,
    });
    if (!limit.allowed)
      return NextResponse.json(
        { error: 'Too many PIN attempts. Wait ten minutes.' },
        { status: 429 },
      );

    const organizationId = (body.organizationId ?? '').trim();
    const reason = (body.reason ?? '').trim().slice(0, 200);
    if (!organizationId || reason.length < 8)
      return NextResponse.json(
        {
          error:
            'A workspace and a reason are required. The reason is shown to the customer.',
        },
        { status: 400 },
      );

    const hash = await sha256(normalisePin(body.pin));
    const row = await db
      .prepare(
        `SELECT id, expires_at, used_at, revoked_at, attempts FROM support_pins
         WHERE organization_id = ? AND pin_hash = ? LIMIT 1`,
      )
      .bind(organizationId, hash)
      .first<PinRow & { id: string }>();

    if (!row) {
      // A wrong PIN increments the attempt counter on whatever live PIN that
      // workspace has, so guessing burns the real one's budget rather than
      // being free.
      await db
        .prepare(
          `UPDATE support_pins SET attempts = attempts + 1
           WHERE organization_id = ? AND used_at IS NULL AND revoked_at IS NULL`,
        )
        .bind(organizationId)
        .run();
      await recordAudit(
        auth.session,
        'support.pin_rejected',
        'organization',
        organizationId,
        { reason: 'no_match' },
      );
      // How many tries are left, in the sentence rather than in a field
      // beside it.
      //
      // The increment above lands on whatever live PIN the workspace has, on
      // purpose: guessing burns the real one's budget rather than being free.
      // The person typing was told only "That PIN is not valid", so a support
      // engineer who mistyped twice had spent two of the customer's five
      // without knowing, and the fifth locks the PIN and sends them back to
      // the customer for a new one. The response used to carry
      // `attemptsAllowed`, a constant nobody read.
      const live = await db
        .prepare(
          `SELECT attempts FROM support_pins
           WHERE organization_id = ? AND used_at IS NULL AND revoked_at IS NULL
           ORDER BY created_at DESC LIMIT 1`,
        )
        .bind(organizationId)
        .first<{ attempts: number }>();
      const remaining = live
        ? Math.max(0, MAX_PIN_ATTEMPTS - Number(live.attempts ?? 0))
        : null;
      return NextResponse.json(
        {
          error:
            remaining === null
              ? 'That PIN is not valid, and this workspace has no PIN waiting to be used. Ask them to issue one.'
              : remaining === 0
                ? `That PIN is not valid, and this workspace's PIN is now locked after ${MAX_PIN_ATTEMPTS} wrong tries. Ask them to issue a new one.`
                : `That PIN is not valid. ${remaining} ${remaining === 1 ? 'try' : 'tries'} left before this workspace's PIN locks and they have to issue a new one.`,
        },
        { status: 403 },
      );
    }

    const state = pinState(row);
    if (state !== 'valid') {
      await recordAudit(
        auth.session,
        'support.pin_rejected',
        'support_pin',
        row.id,
        { state },
      );
      return NextResponse.json(
        { error: pinMessage(state), state },
        { status: 403 },
      );
    }

    const sessionId = `supportsession_${crypto.randomUUID()}`;
    await db.batch([
      // Marking the PIN used in the same batch is what makes it single-use:
      // two executives racing the same PIN cannot both get a session.
      db
        .prepare(
          `UPDATE support_pins SET used_at = CURRENT_TIMESTAMP WHERE id = ? AND used_at IS NULL`,
        )
        .bind(row.id),
      db
        .prepare(
          `INSERT INTO support_sessions
            (id, organization_id, pin_id, executive_user_id, executive_email,
             ticket_id, reason, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          sessionId,
          organizationId,
          row.id,
          auth.session.userId,
          auth.session.email ?? null,
          body.ticketId ?? null,
          reason,
          new Date(Date.now() + SESSION_TTL_MS).toISOString(),
        ),
    ]);
    await recordAudit(
      auth.session,
      'support.session_opened',
      'support_session',
      sessionId,
      { organizationId, reason },
    );
    return NextResponse.json(
      {
        sessionId,
        expiresInMinutes: Math.round(SESSION_TTL_MS / 60_000),
        organizationId,
      },
      { status: 201 },
    );
  }

  if (body.action === 'end_session') {
    const result = await db
      .prepare(
        `UPDATE support_sessions SET ended_at = CURRENT_TIMESTAMP,
           ended_reason = 'closed_by_executive'
         WHERE id = ? AND executive_user_id = ? AND ended_at IS NULL`,
      )
      .bind(body.sessionId ?? '', auth.session.userId)
      .run();
    if (!result.meta.changes)
      return NextResponse.json(
        { error: 'No open session of yours matches that id.' },
        { status: 404 },
      );
    await recordAudit(
      auth.session,
      'support.session_closed',
      'support_session',
      body.sessionId ?? '',
    );
    return NextResponse.json({ ended: true });
  }

  return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
}
