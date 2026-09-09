import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import {
  requireAnyCustomerPermission,
  requireCustomerPermission,
} from '@/lib/customer-rbac';
import { recordAudit } from '@/lib/demo-seed';
import { supportCode } from '@/lib/call-quality';
import { sha256 } from '@/lib/security';
import { PIN_TTL_MS, generatePin, normalisePin } from '@/lib/support-access';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireAnyCustomerPermission(request, [
    'support.manage',
    'crm.manage',
  ]);
  if (auth.response) return auth.response;
  await ensureSchema();
  const db = getRawDb();
  const [tickets, messages] = await Promise.all([
    db
      .prepare(
        'SELECT * FROM support_tickets WHERE organization_id = ? ORDER BY updated_at DESC',
      )
      .bind(auth.session.organizationId)
      .all(),
    db
      .prepare(`SELECT m.* FROM support_ticket_messages m INNER JOIN support_tickets t ON t.id = m.ticket_id
      WHERE t.organization_id = ? ORDER BY m.created_at`)
      .bind(auth.session.organizationId)
      .all(),
  ]);
  // Who from support is inside this workspace, and why. A customer can issue a
  // one-time PIN that lets an executive in and can shut the door again; until
  // this, neither the door nor the person standing in it was visible anywhere.
  const [liveSessions, recentSessions, livePin] = await Promise.all([
    db
      .prepare(`SELECT id, executive_email, reason, view_count, expires_at, created_at
        FROM support_sessions
        WHERE organization_id = ? AND ended_at IS NULL AND expires_at > datetime('now')
        ORDER BY created_at DESC`)
      .bind(auth.session.organizationId)
      .all(),
    db
      .prepare(`SELECT id, executive_email, reason, view_count, created_at, ended_at, ended_reason
        FROM support_sessions
        WHERE organization_id = ? AND (ended_at IS NOT NULL OR expires_at <= datetime('now'))
        ORDER BY created_at DESC LIMIT 10`)
      .bind(auth.session.organizationId)
      .all(),
    // The PIN itself is never stored in a form anybody can read back, so this
    // says only that one is live and until when.
    db
      .prepare(`SELECT id, reason, expires_at, attempts, created_at FROM support_pins
        WHERE organization_id = ? AND used_at IS NULL AND revoked_at IS NULL
          AND expires_at > datetime('now')
        ORDER BY created_at DESC LIMIT 1`)
      .bind(auth.session.organizationId)
      .first(),
  ]);

  return NextResponse.json({
    tickets: tickets.results,
    messages: messages.results,
    supportAccess: {
      liveSessions: liveSessions.results ?? [],
      recentSessions: recentSessions.results ?? [],
      livePin: livePin ?? null,
    },
  });
}

export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'support.manage');
  if (auth.response) return auth.response;
  const body = (await request.json()) as {
    action?: string;
    subject?: string;
    category?: string;
    priority?: string;
    message?: string;
    ticketId?: string;
    reason?: string;
    pinId?: string;
  };
  const db = getRawDb();

  // §30: the customer grants support access, not the operator. A PIN is minted
  // here, inside the workspace, by somebody who works there — support has no
  // way to let itself in. Single-use, attempt-limited and short-lived, and only
  // the hash is kept.
  if (body.action === 'issue_support_pin') {
    const pin = generatePin();
    const pinId = `supportpin_${crypto.randomUUID()}`;
    // Any earlier PIN is revoked: two live PINs would mean two possible doors,
    // and the customer only believes they opened one.
    await db
      .prepare(
        `UPDATE support_pins SET revoked_at = CURRENT_TIMESTAMP
         WHERE organization_id = ? AND used_at IS NULL AND revoked_at IS NULL`,
      )
      .bind(auth.session.organizationId)
      .run();
    await db
      .prepare(
        `INSERT INTO support_pins (id, organization_id, pin_hash, issued_by, reason, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        pinId,
        auth.session.organizationId,
        await sha256(normalisePin(pin)),
        auth.session.userId,
        (body.reason ?? '').trim().slice(0, 200) || null,
        new Date(Date.now() + PIN_TTL_MS).toISOString(),
      )
      .run();
    await recordAudit(
      auth.session,
      'support.pin_issued',
      'support_pin',
      pinId,
      {
        reason: body.reason ?? null,
      },
    );
    return NextResponse.json({
      pin,
      pinId,
      expiresInMinutes: Math.round(PIN_TTL_MS / 60_000),
      note: 'Read this to the support executive. It works once, and only for the next 30 minutes.',
    });
  }

  if (body.action === 'revoke_support_access') {
    await db
      .prepare(
        `UPDATE support_pins SET revoked_at = CURRENT_TIMESTAMP
         WHERE organization_id = ? AND used_at IS NULL AND revoked_at IS NULL`,
      )
      .bind(auth.session.organizationId)
      .run();
    // Ending live sessions is the point: revoking a PIN that has already been
    // used would close a door that is standing open.
    const ended = await db
      .prepare(
        `UPDATE support_sessions SET ended_at = CURRENT_TIMESTAMP,
           ended_reason = 'revoked_by_customer'
         WHERE organization_id = ? AND ended_at IS NULL`,
      )
      .bind(auth.session.organizationId)
      .run();
    await recordAudit(
      auth.session,
      'support.access_revoked',
      'organization',
      auth.session.organizationId ?? '',
    );
    return NextResponse.json({
      revoked: true,
      sessionsEnded: ended.meta.changes ?? 0,
    });
  }

  const message = body.message?.trim().slice(0, 4000);
  if (!message)
    return NextResponse.json(
      { error: 'Message is required.' },
      { status: 400 },
    );

  if (body.action === 'reply') {
    const ticket = await db
      .prepare(
        'SELECT id FROM support_tickets WHERE id = ? AND organization_id = ?',
      )
      .bind(body.ticketId, auth.session.organizationId)
      .first<{ id: string }>();
    if (!ticket)
      return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
    await db.batch([
      db
        .prepare(
          `INSERT INTO support_ticket_messages (id, ticket_id, sender_role, sender_name, message) VALUES (?, ?, 'customer', ?, ?)`,
        )
        .bind(
          `ticket_message_${crypto.randomUUID()}`,
          ticket.id,
          auth.session.name,
          message,
        ),
      db
        .prepare(
          `UPDATE support_tickets SET status = 'customer_replied', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        )
        .bind(ticket.id),
    ]);
    return NextResponse.json({ replied: true });
  }

  // Named, rather than reached by falling off the end of the dispatch. Any
  // action this route did not recognise used to open a support ticket, which
  // is a quieter version of the CRM's bulk endpoint archiving leads by
  // accident — but still a row nobody asked for, on somebody's queue.
  if (body.action && body.action !== 'create')
    return NextResponse.json(
      { error: 'Unknown ticket action.' },
      { status: 400 },
    );

  const subject = body.subject?.trim().slice(0, 140);
  if (!subject)
    return NextResponse.json(
      { error: 'Subject is required.' },
      { status: 400 },
    );
  const ticketId = `ticket_${crypto.randomUUID()}`;
  await db.batch([
    db
      // §30: a short code the customer can read out, so a ticket is found
      // without anyone dictating a UUID. Same generator the device test uses.
      .prepare(`INSERT INTO support_tickets (id, organization_id, created_by_user_id, subject, category, priority, status, diagnostic_code)
      VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`)
      .bind(
        ticketId,
        auth.session.organizationId,
        auth.session.userId,
        subject,
        body.category || 'technical',
        ['low', 'normal', 'high', 'urgent'].includes(body.priority ?? '')
          ? body.priority
          : 'normal',
        supportCode(ticketId),
      ),
    db
      .prepare(
        `INSERT INTO support_ticket_messages (id, ticket_id, sender_role, sender_name, message) VALUES (?, ?, 'customer', ?, ?)`,
      )
      .bind(
        `ticket_message_${crypto.randomUUID()}`,
        ticketId,
        auth.session.name,
        message,
      ),
  ]);
  await recordAudit(
    auth.session,
    'support_ticket.created',
    'support_ticket',
    ticketId,
    { subject },
  );
  return NextResponse.json({ ticketId }, { status: 201 });
}
