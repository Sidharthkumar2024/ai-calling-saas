import { NextResponse } from 'next/server';
import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireAnyCustomerPermission } from '@/lib/customer-rbac';
import { recordAudit } from '@/lib/demo-seed';
import { sendWhatsAppText, whatsAppConnected } from '@/lib/commerce';
import { replyWindow, toConversations } from '@/lib/whatsapp-inbox';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireAnyCustomerPermission(request, [
    'crm.manage',
    'support.manage',
  ]);
  if (auth.response) return auth.response;
  await ensureSchema();
  const rows = await getRawDb()
    .prepare(`SELECT id, sender_phone, direction, message_type, body, media_id, created_at
      FROM whatsapp_messages
      WHERE organization_id = ? ORDER BY created_at DESC LIMIT 200`)
    .bind(auth.session.organizationId)
    .all<{
      id: string;
      sender_phone: string;
      direction: string;
      message_type: string;
      body: string | null;
      media_id: string | null;
      created_at: string;
    }>();
  // Grouped here rather than in the screen so the reply window — the rule that
  // decides whether a text box should even be offered — is decided once, on the
  // same data the send is checked against.
  const conversations = toConversations(rows.results ?? []).map(
    (conversation) => ({
      ...conversation,
      window: replyWindow(conversation),
    }),
  );
  const inbound = await getRawDb().prepare(`SELECT sender_phone, MAX(created_at) AS last_at FROM whatsapp_messages WHERE organization_id = ? AND direction = 'inbound' GROUP BY sender_phone`).bind(auth.session.organizationId).all<{ sender_phone: string; last_at: string }>();
  const inboundByPhone = new Map((inbound.results ?? []).map(row => [row.sender_phone, row.last_at]));
  for (const conversation of conversations) {
    conversation.lastInboundAt = inboundByPhone.get(conversation.phone) ?? null;
    conversation.window = replyWindow(conversation);
  }
  return NextResponse.json({
    conversations,
    connected: await whatsAppConnected(auth.session.organizationId!),
  });
}

/**
 * Replying to a customer.
 *
 * The 24-hour window is checked here as well as on screen, because the screen's
 * copy of it is a courtesy and this is the rule: outside it WhatsApp accepts
 * only an approved template, and a plain send comes back as a Meta error whose
 * meaning never reaches the person who typed the message.
 */
export async function POST(request: Request) {
  const auth = await requireAnyCustomerPermission(request, [
    'crm.manage',
    'support.manage',
  ]);
  if (auth.response) return auth.response;
  await ensureSchema();
  const body = await request.json().catch(() => null) as { phone?: unknown; text?: unknown } | null;
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!/^\+?[1-9]\d{6,14}$/.test(phone) || !text || text.length > 4000)
    return NextResponse.json(
      { error: 'Use a valid international number and a message of 1–4000 characters.' },
      { status: 400 },
    );

  const db = getRawDb();
  const organizationId = auth.session.organizationId!;
  if (!await whatsAppConnected(organizationId))
    return NextResponse.json({ error: 'Connect and verify this workspace’s WhatsApp number in Integrations before sending.' }, { status: 409 });
  const history = await db
    .prepare(`SELECT id, sender_phone, direction, message_type, body, media_id, created_at
      FROM whatsapp_messages
      WHERE organization_id = ? AND sender_phone = ?
      ORDER BY created_at DESC LIMIT 50`)
    .bind(organizationId, phone)
    .all<{
      id: string;
      sender_phone: string;
      direction: string;
      message_type: string;
      body: string | null;
      media_id: string | null;
      created_at: string;
    }>();
  const [conversation] = toConversations(history.results ?? []);
  if (!conversation)
    return NextResponse.json(
      { error: 'No conversation with that number.' },
      { status: 404 },
    );
  const inbound = await db.prepare(`SELECT MAX(created_at) AS last_at FROM whatsapp_messages WHERE organization_id = ? AND sender_phone = ? AND direction = 'inbound'`).bind(organizationId, phone).first<{ last_at: string | null }>();
  const window = replyWindow({ lastInboundAt: inbound?.last_at ?? null });
  if (!window.open)
    return NextResponse.json({ error: window.reason }, { status: 409 });

  let result;
  try {
    result = await sendWhatsAppText({ organizationId, destination: phone, body: text });
  } catch {
    return NextResponse.json({ error: 'Meta did not accept the reply. Check the connection and try again.' }, { status: 502 });
  }
  if (result.status !== 'sent')
    return NextResponse.json({ error: 'The reply was not sent. Reconnect WhatsApp before trying again.' }, { status: 409 });

  // Record only accepted sends. Provider acceptance is not a delivery receipt.
  await db
    .prepare(`INSERT INTO whatsapp_messages
      (id, organization_id, phone_number_id, wa_message_id, direction,
       sender_phone, message_type, body, media_id)
      VALUES (?, ?, 'outbound', ?, 'outbound', ?, 'text', ?, NULL)`)
    .bind(
      `wam_${crypto.randomUUID()}`,
      organizationId,
      result.providerReference,
      phone,
      text.slice(0, 4000),
    )
    .run();
  await recordAudit(auth.session, 'whatsapp.replied', 'whatsapp', phone, {
    status: result.status,
  });
  return NextResponse.json({ ok: true, status: result.status });
}
