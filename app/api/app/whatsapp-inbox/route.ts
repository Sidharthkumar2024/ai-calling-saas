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
  const body = (await request.json()) as { phone?: string; text?: string };
  const phone = String(body.phone ?? '').trim();
  const text = String(body.text ?? '').trim();
  if (!phone || !text)
    return NextResponse.json(
      { error: 'A number and a message are both required.' },
      { status: 400 },
    );

  const db = getRawDb();
  const organizationId = auth.session.organizationId!;
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
  const window = replyWindow(conversation);
  if (!window.open)
    return NextResponse.json({ error: window.reason }, { status: 409 });

  const result = await sendWhatsAppText({
    organizationId,
    destination: phone,
    body: text,
  });

  // Recorded either way, including a sandbox send, so the thread shows what
  // this workspace said even when no credentials are connected — and marked
  // with how it went rather than as an unqualified "sent".
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
