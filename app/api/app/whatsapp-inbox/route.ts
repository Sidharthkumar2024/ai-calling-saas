import { NextResponse } from 'next/server';
import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireAnyCustomerPermission } from '@/lib/customer-rbac';
import { recordAudit } from '@/lib/demo-seed';
import {
  sendWhatsAppFlow,
  sendWhatsAppTemplate,
  sendWhatsAppText,
  whatsAppConnected,
} from '@/lib/commerce';
import {
  fillTemplate,
  validateParams,
  type Template,
} from '@/lib/whatsapp-templates';
import { normalisePhone } from '@/lib/whatsapp-bot-rules';
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
  // Which of those agents is the person reading this. The screen needs it to
  // tell "I am handing my own conversation on" apart from "I am taking one off
  // a colleague" — only the second is worth a warning.
  const me = await getRawDb()
    .prepare(
      `SELECT id FROM support_agents WHERE organization_id = ? AND user_id = ? LIMIT 1`,
    )
    .bind(auth.session.organizationId, auth.session.userId)
    .first<{ id: string }>();
  // Only approved ones. A template still in review cannot be sent, and
  // offering it here would be offering a button that fails at Meta.
  const templates = await getRawDb()
    .prepare(`SELECT id, name, language, category, header, body, footer, status,
      provider_id, rejected_reason
      FROM whatsapp_templates
      WHERE organization_id = ? AND status = 'APPROVED'
      ORDER BY name`)
    .bind(auth.session.organizationId)
    .all<Template>();
  // Published forms only, for the same reason as templates: offering one that
  // cannot open is offering a button that fails at Meta.
  const flows = await getRawDb()
    .prepare(`SELECT id, name, cta_label FROM whatsapp_flows
      WHERE organization_id = ? AND status = 'PUBLISHED' AND provider_id IS NOT NULL
      ORDER BY name`)
    .bind(auth.session.organizationId)
    .all<{ id: string; name: string; cta_label: string }>();

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
    me: me?.id ?? null,
    templates: templates.results ?? [],
    flows: flows.results ?? [],
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
    templateId?: unknown;
    params?: unknown;
    flowId?: unknown;
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
      // A person taking the conversation ends the bot's, rather than leaving
      // its question parked. Otherwise the run waits through the whole human
      // exchange and then reads whatever the customer says next — "ok, thanks"
      // — as the answer to a question asked hours ago.
      await db
        .prepare(`UPDATE workflow_runs
          SET status = 'stopped', waiting_on = NULL, resume_node = NULL,
              completed_at = CURRENT_TIMESTAMP, error = ?
          WHERE organization_id = ? AND status = 'waiting' AND waiting_on = ?`)
        .bind(
          'Someone on the team took over this conversation, so the workflow stopped waiting for a reply.',
          organizationId,
          `whatsapp:${normalisePhone(phone)}`,
        )
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

  /**
   * Sending an approved template.
   *
   * This is the answer to a closed reply window rather than a way around it:
   * outside 24 hours WhatsApp accepts nothing else, and until now the inbox
   * stated the reason and stopped there.
   */
  if (body?.action === 'send_template') {
    const db = getRawDb();
    const organizationId = auth.session.organizationId!;
    if (!/^\+?[1-9]\d{6,14}$/.test(phone))
      return NextResponse.json(
        { error: 'A conversation is required.' },
        { status: 400 },
      );
    const template = await db
      .prepare(`SELECT id, name, language, category, header, body, footer,
        status, provider_id, rejected_reason
        FROM whatsapp_templates
        WHERE id = ? AND organization_id = ?`)
      .bind(
        typeof body.templateId === 'string' ? body.templateId : '',
        organizationId,
      )
      .first<Template>();
    if (!template)
      return NextResponse.json(
        { error: 'That template is not in this workspace.' },
        { status: 404 },
      );
    // Checked here as well as on screen: the screen's copy of the status can
    // be a minute old, and Meta pauses a template without warning anyone.
    if (template.status !== 'APPROVED')
      return NextResponse.json(
        { error: 'Only an approved template can be sent.' },
        { status: 409 },
      );
    const params = Array.isArray(body.params)
      ? (body.params as unknown[]).map((value) =>
          typeof value === 'string' ? value.trim() : '',
        )
      : [];
    const problems = validateParams(template.body, params);
    if (problems.length)
      return NextResponse.json({ error: problems.join(' ') }, { status: 400 });
    if (!(await whatsAppConnected(organizationId)))
      return NextResponse.json(
        {
          error:
            'Connect and verify this workspace\u2019s WhatsApp number in Integrations before sending.',
        },
        { status: 409 },
      );
    let result;
    try {
      result = await sendWhatsAppTemplate({
        organizationId,
        destination: phone,
        name: template.name,
        language: template.language,
        params: params.slice(0, 20),
      });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Meta did not accept the template.',
        },
        { status: 502 },
      );
    }
    if (result.status !== 'sent')
      return NextResponse.json(
        {
          error:
            'The template was not sent. Reconnect WhatsApp before trying again.',
        },
        { status: 409 },
      );
    // Stored filled in, because what belongs in the transcript is what the
    // customer read — not the template with its slots still showing.
    await db
      .prepare(`INSERT INTO whatsapp_messages
        (id, organization_id, phone_number_id, wa_message_id, direction,
         sender_phone, message_type, body, media_id)
        VALUES (?, ?, 'outbound', ?, 'outbound', ?, 'template', ?, NULL)`)
      .bind(
        `wam_${crypto.randomUUID()}`,
        organizationId,
        result.providerReference,
        phone,
        fillTemplate(template.body, params).slice(0, 4000),
      )
      .run();
    await recordAudit(
      auth.session,
      'whatsapp.template_sent',
      'whatsapp',
      phone,
      { template: template.name, language: template.language },
    );
    return NextResponse.json({ ok: true, status: result.status });
  }

  /**
   * Sending a form the customer fills in inside WhatsApp.
   *
   * Like a typed reply, this only works inside the 24-hour window — a Flow is
   * an interactive message, not a template — so the same rule is checked here.
   * A row is written before the send with the token Meta will echo, which is
   * how the answers find their way back to the person who was asked.
   */
  if (body?.action === 'send_flow') {
    const db = getRawDb();
    const organizationId = auth.session.organizationId!;
    if (!/^\+?[1-9]\d{6,14}$/.test(phone))
      return NextResponse.json(
        { error: 'A conversation is required.' },
        { status: 400 },
      );
    const flow = await db
      .prepare(`SELECT id, name, cta_label, screens_json, status, provider_id
        FROM whatsapp_flows WHERE id = ? AND organization_id = ?`)
      .bind(typeof body.flowId === 'string' ? body.flowId : '', organizationId)
      .first<{
        id: string;
        name: string;
        cta_label: string;
        screens_json: string;
        status: string;
        provider_id: string | null;
      }>();
    if (!flow)
      return NextResponse.json(
        { error: 'That form is not in this workspace.' },
        { status: 404 },
      );
    if (flow.status !== 'PUBLISHED' || !flow.provider_id)
      return NextResponse.json(
        { error: 'Only a published form can be sent.' },
        { status: 409 },
      );
    let firstScreen = '';
    try {
      const screens = JSON.parse(flow.screens_json) as Array<{ id?: string }>;
      firstScreen = String(screens?.[0]?.id ?? '');
    } catch {
      firstScreen = '';
    }
    if (!firstScreen)
      return NextResponse.json(
        { error: 'This form has no screen to open.' },
        { status: 409 },
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
    if (!(await whatsAppConnected(organizationId)))
      return NextResponse.json(
        {
          error:
            'Connect and verify this workspace\u2019s WhatsApp number in Integrations before sending.',
        },
        { status: 409 },
      );

    const message =
      typeof body.text === 'string' && body.text.trim()
        ? body.text.trim().slice(0, 1024)
        : `Please fill in this short form: ${flow.name}`;
    const flowToken = `wft_${crypto.randomUUID()}`;
    // Written before the send. If the send fails the row is removed; if the
    // process dies between the two, an unanswered row is a smaller problem
    // than an answer arriving with no row to match it to.
    await db
      .prepare(`INSERT INTO whatsapp_flow_responses
        (id, organization_id, flow_id, flow_token, phone, status)
        VALUES (?, ?, ?, ?, ?, 'sent')`)
      .bind(
        `wfr_${crypto.randomUUID()}`,
        organizationId,
        flow.id,
        flowToken,
        phone,
      )
      .run();
    let result;
    try {
      result = await sendWhatsAppFlow({
        organizationId,
        destination: phone,
        flowProviderId: flow.provider_id,
        flowToken,
        screenId: firstScreen,
        ctaLabel: flow.cta_label,
        body: message,
      });
    } catch (error) {
      await db
        .prepare(
          `DELETE FROM whatsapp_flow_responses WHERE organization_id = ? AND flow_token = ?`,
        )
        .bind(organizationId, flowToken)
        .run();
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Meta did not accept the form.',
        },
        { status: 502 },
      );
    }
    if (result.status !== 'sent') {
      await db
        .prepare(
          `DELETE FROM whatsapp_flow_responses WHERE organization_id = ? AND flow_token = ?`,
        )
        .bind(organizationId, flowToken)
        .run();
      return NextResponse.json(
        { error: 'The form was not sent. Reconnect WhatsApp and try again.' },
        { status: 409 },
      );
    }
    await db
      .prepare(`INSERT INTO whatsapp_messages
        (id, organization_id, phone_number_id, wa_message_id, direction,
         sender_phone, message_type, body, media_id)
        VALUES (?, ?, 'outbound', ?, 'outbound', ?, 'interactive', ?, NULL)`)
      .bind(
        `wam_${crypto.randomUUID()}`,
        organizationId,
        result.providerReference,
        phone,
        `${message}\n[form: ${flow.name}]`,
      )
      .run();
    await recordAudit(
      auth.session,
      'whatsapp.flow_sent_to',
      'whatsapp',
      phone,
      {
        flow: flow.name,
      },
    );
    return NextResponse.json({ ok: true, status: result.status });
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
