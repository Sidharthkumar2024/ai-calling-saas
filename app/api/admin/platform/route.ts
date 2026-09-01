import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireAdmin } from '@/lib/api-session';
import { recordAudit } from '@/lib/demo-seed';
import { providerReadiness } from '@/lib/provider-adapters';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  await ensureSchema();
  const db = getRawDb();
  const [authProviders, platformProviders, tickets, messages] = await Promise.all([
    db.prepare('SELECT provider, display_name, button_visible, enabled, status, public_config_json, updated_at FROM auth_provider_settings ORDER BY display_name').all(),
    db.prepare('SELECT id, public_name, category, required_credentials_json, status, health, usage_note, customer_visible, updated_at FROM platform_providers ORDER BY category, public_name').all(),
    db.prepare(`SELECT t.*, o.name AS organization_name, u.email AS creator_email FROM support_tickets t
      INNER JOIN organizations o ON o.id = t.organization_id LEFT JOIN app_users u ON u.id = t.created_by_user_id
      ORDER BY t.updated_at DESC`).all(),
    db.prepare('SELECT * FROM support_ticket_messages ORDER BY created_at').all(),
  ]);
  return NextResponse.json({ authProviders: authProviders.results, platformProviders: platformProviders.results, providerReadiness: await providerReadiness(), tickets: tickets.results, ticketMessages: messages.results });
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const body = await request.json() as { action?: string; provider?: string; buttonVisible?: boolean; enabled?: boolean; id?: string; status?: string; health?: string; ticketId?: string; message?: string };
  const db = getRawDb();
  if (body.action === 'auth_visibility') {
    const result = await db.prepare(`UPDATE auth_provider_settings SET button_visible = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE provider = ?`).bind(body.buttonVisible ? 1 : 0, auth.session.userId, body.provider).run();
    if (!result.meta.changes) return NextResponse.json({ error: 'Auth provider not found.' }, { status: 404 });
    await recordAudit(auth.session, 'auth_provider.visibility_updated', 'auth_provider', body.provider, { buttonVisible: body.buttonVisible });
    return NextResponse.json({ updated: true });
  }
  if (body.action === 'auth_enabled') {
    const configured = body.provider === 'google'
      ? Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI)
      : false;
    if (body.enabled && !configured) {
      return NextResponse.json({ error: 'Configure the provider credentials before enabling sign-in.' }, { status: 409 });
    }
    const result = await db.prepare(`UPDATE auth_provider_settings SET enabled = ?, status = ?, updated_by = ?,
      updated_at = CURRENT_TIMESTAMP WHERE provider = ?`)
      .bind(body.enabled ? 1 : 0, body.enabled ? 'active' : 'admin_disabled', auth.session.userId, body.provider).run();
    if (!result.meta.changes) return NextResponse.json({ error: 'Auth provider not found.' }, { status: 404 });
    await recordAudit(auth.session, 'auth_provider.enabled_updated', 'auth_provider', body.provider, { enabled: body.enabled });
    return NextResponse.json({ updated: true });
  }
  if (body.action === 'provider_status') {
    const result = await db.prepare(`UPDATE platform_providers SET status = ?, health = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(body.status || 'required', body.health || 'not_connected', body.id).run();
    if (!result.meta.changes) return NextResponse.json({ error: 'Platform provider not found.' }, { status: 404 });
    return NextResponse.json({ updated: true });
  }
  if (body.action === 'ticket_reply') {
    const ticket = await db.prepare('SELECT id FROM support_tickets WHERE id = ?').bind(body.ticketId).first<{ id: string }>();
    if (!ticket || !body.message?.trim()) return NextResponse.json({ error: 'Ticket and reply are required.' }, { status: 400 });
    await db.batch([
      db.prepare(`INSERT INTO support_ticket_messages (id, ticket_id, sender_role, sender_name, message) VALUES (?, ?, 'admin', ?, ?)`).bind(`ticket_message_${crypto.randomUUID()}`, ticket.id, auth.session.name, body.message.trim().slice(0, 4000)),
      db.prepare(`UPDATE support_tickets SET status = 'waiting_on_customer', assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(auth.session.name, ticket.id),
    ]);
    return NextResponse.json({ replied: true });
  }
  if (body.action === 'ticket_status') {
    const allowed = ['open','in_progress','waiting_on_customer','resolved','closed'];
    if (!allowed.includes(body.status ?? '')) return NextResponse.json({ error: 'Invalid ticket status.' }, { status: 400 });
    await db.prepare(`UPDATE support_tickets SET status = ?, assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(body.status, auth.session.name, body.ticketId).run();
    return NextResponse.json({ updated: true });
  }
  return NextResponse.json({ error: 'Unsupported platform action.' }, { status: 400 });
}
