import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import {
  requireAnyCustomerPermission,
  requireCustomerPermission,
} from '@/lib/customer-rbac';
import { recordAudit } from '@/lib/demo-seed';

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
  return NextResponse.json({
    tickets: tickets.results,
    messages: messages.results,
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
  };
  const db = getRawDb();
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

  const subject = body.subject?.trim().slice(0, 140);
  if (!subject)
    return NextResponse.json(
      { error: 'Subject is required.' },
      { status: 400 },
    );
  const ticketId = `ticket_${crypto.randomUUID()}`;
  await db.batch([
    db
      .prepare(`INSERT INTO support_tickets (id, organization_id, created_by_user_id, subject, category, priority, status)
      VALUES (?, ?, ?, ?, ?, ?, 'open')`)
      .bind(
        ticketId,
        auth.session.organizationId,
        auth.session.userId,
        subject,
        body.category || 'technical',
        ['low', 'normal', 'high', 'urgent'].includes(body.priority ?? '')
          ? body.priority
          : 'normal',
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
