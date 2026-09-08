import { NextResponse } from 'next/server';
import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireAnyCustomerPermission } from '@/lib/customer-rbac';
import { recordAudit } from '@/lib/demo-seed';
import { sendWhatsAppText, whatsAppConnected } from '@/lib/commerce';
import {
  PAGE_SIZE,
  replyWindow,
  toConversations,
  toPage,
  type InboxMessage,
} from '@/lib/whatsapp-inbox';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireAnyCustomerPermission(request, [
    'crm.manage',
    'support.manage',
  ]);
  if (auth.response) return auth.response;
  await ensureSchema();
  const url = new URL(request.url);
  const phone = (url.searchParams.get('phone') ?? '').trim();

  // One conversation, read further back. A cursor rather than an offset: rows
  // arrive while somebody reads, and an offset would show them a message twice
  // or skip one entirely.
  if (phone) {
    const before = url.searchParams.get('before');
    const page = await getRawDb()
      .prepare(`SELECT id, sender_phone, direction, message_type, body, media_id, created_at
        FROM whatsapp_messages
        WHERE organization_id = ? AND sender_phone = ?
          AND (? IS NULL OR created_at < ?)
        ORDER BY created_at DESC LIMIT ?`)
      .bind(auth.session.organizationId, phone, before, before, PAGE_SIZE + 1)
      .all<InboxMessage>();
    const result = toPage(page.results ?? []);
    return NextResponse.json({
      ...result,
      // Oldest first, the order they were said in.
      messages: [...result.messages].reverse(),
    });
  }

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
  const inbound = await getRawDb()
    .prepare(
      `SELECT sender_phone, MAX(created_at) AS last_at FROM whatsapp_messages WHERE organization_id = ? AND direction = 'inbound' GROUP BY sender_phone`,
    )
    .bind(auth.session.organizationId)
    .all<{ sender_phone: string; last_at: string }>();
  const inboundByPhone = new Map(
    (inbound.results ?? []).map((row) => [row.sender_phone, row.last_at]),
  );
  for (const conversation of conversations) {
    conversation.lastInboundAt = inboundByPhone.get(conversation.phone) ?? null;
    conversation.window = replyWindow(conversation);
  }
  const assigned = await getRawDb()
    .prepare(`SELECT a.phone, a.support_agent_id, a.assigned_at, s.name AS agent_name
      FROM whatsapp_assignments a
      LEFT JOIN support_agents s ON s.id = a.support_agent_id
      WHERE a.organization_id = ?`)
    .bind(auth.session.organizationId)
    .all<{
      phone: string;
      support_agent_id: string | null;
      assigned_at: string;
      agent_name: string | null;
    }>();
  const byPhone = new Map(
    (assigned.results ?? []).map((row) => [row.phone, row]),
  );
  const agents = await getRawDb()
    .prepare(
      `SELECT id, name FROM support_agents WHERE organization_id = ? ORDER BY name`,
    )
    .bind(auth.session.organizationId)
    .all<{ id: string; name: string }>();

  return NextResponse.json({
    conversations: conversations.map((conversation) => {
      const held = byPhone.get(conversation.phone);
      return {
        ...conversation,
        assignment: {
          phone: conversation.phone,
          agentId: held?.support_agent_id ?? null,
          agentName: held?.agent_name ?? null,
          assignedAt: held?.assigned_at ?? null,
        },
      };
    }),
    agents: agents.results ?? [],
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
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    phone?: unknown;
    text?: unknown;
    supportAgentId?: unknown;
  } | null;
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';

  if (body?.action === 'assign') {
    if (!/^\+?[1-9]\d{6,14}$/.test(phone))
      return NextResponse.json(
        { error: 'A conversation is required.' },
        { status: 400 },
      );
    const db = getRawDb();
    const organizationId = auth.session.organizationId!;
    const agentId =
      typeof body.supportAgentId === 'string' && body.supportAgentId.trim()
        ? body.supportAgentId.trim()
        : null;
    // Scoped, not trusted: an id from a browser must belong to this workspace
    // before it can own a customer's conversation.
    if (agentId) {
      const owned = await db
        .prepare(
          `SELECT id FROM support_agents WHERE id = ? AND organization_id = ? LIMIT 1`,
        )
        .bind(agentId, organizationId)
        .first<{ id: string }>();
      if (!owned)
        return NextResponse.json(
          { error: 'That person is not on this desk.' },
          { status: 404 },
        );
      await db
        .prepare(`INSERT INTO whatsapp_assignments
          (organization_id, phone, support_agent_id, assigned_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(organization_id, phone)
          DO UPDATE SET support_agent_id = excluded.support_agent_id,
                        assigned_at = CURRENT_TIMESTAMP`)
        .bind(organizationId, phone, agentId)
        .run();
    } else {
      await db
        .prepare(
          `DELETE FROM whatsapp_assignments WHERE organization_id = ? AND phone = ?`,
        )
        .bind(organizationId, phone)
        .run();
    }
    await recordAudit(
      auth.session,
      agentId ? 'whatsapp.assigned' : 'whatsapp.unassigned',
      'whatsapp',
      phone,
      { agentId },
    );
    return NextResponse.json({ ok: true, agentId });
  }

  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!/^\+?[1-9]\d{6,14}$/.test(phone) || !text || text.length > 4000)
    return NextResponse.json(
      {
        error:
          'Use a valid international number and a message of 1–4000 characters.',
      },
      { status: 400 },
    );

  const db = getRawDb();
  const organizationId = auth.session.organizationId!;
  if (!(await whatsAppConnected(organizationId)))
    return NextResponse.json(
      {
        error:
          'Connect and verify this workspace’s WhatsApp number in Integrations before sending.',
      },
      { status: 409 },
    );
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
  const inbound = await db
    .prepare(
      `SELECT MAX(created_at) AS last_at FROM whatsapp_messages WHERE organization_id = ? AND sender_phone = ? AND direction = 'inbound'`,
    )
    .bind(organizationId, phone)
    .first<{ last_at: string | null }>();
  const window = replyWindow({ lastInboundAt: inbound?.last_at ?? null });
  if (!window.open)
    return NextResponse.json({ error: window.reason }, { status: 409 });

  let result;
  try {
    result = await sendWhatsAppText({
      organizationId,
      destination: phone,
      body: text,
    });
  } catch {
    return NextResponse.json(
      {
        error:
          'Meta did not accept the reply. Check the connection and try again.',
      },
      { status: 502 },
    );
  }
  if (result.status !== 'sent')
    return NextResponse.json(
      {
        error:
          'The reply was not sent. Reconnect WhatsApp before trying again.',
      },
      { status: 409 },
    );

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
