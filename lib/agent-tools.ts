import { getRawDb } from '@/db/index';
import { DEFAULT_REFUND_POLICY } from '@/lib/action-policy';
import {
  createApprovalRequest,
  createCallbackRequest,
  initiateWarmTransfer,
  recordRefundRequest,
} from '@/lib/handoff-service';
import {
  getRecord,
  listObjects,
  searchRecords,
  type ObjectDefinition,
} from '@/lib/object-store';
import type { Filter } from '@/lib/object-engine';
import { createOrder } from '@/lib/order-service';
import { filterToolDefinitions } from '@/lib/agent-tool-catalog';
import { toolOutcomeKind } from '@/lib/activity-timeline';
import {
  assetsOfRecord,
  buildSendSet,
  DEFAULT_SEND_POLICY,
  describeSend,
  type MediaKind,
  type SendPolicy,
} from '@/lib/whatsapp-media';
import { createRazorpayPaymentLink, whatsAppConnected } from '@/lib/commerce';
import { queueConfirmation } from '@/lib/appointment-service';
import { DEFAULT_TIMEZONE, describeSlot, todayIn } from '@/lib/appointments';
import { createDocumentRequest } from '@/lib/document-request-service';

/**
 * The tool definitions to hand the model for one agent.
 *
 * This is the function that makes `tools_json` mean something. Before it, the
 * picker in the agent studio wrote a list, the list was stored, and
 * `generateVoiceAgentTurn` passed `VAANI_AGENT_TOOLS` — all of them — on every
 * turn regardless. A workspace that switched an action off still had an agent
 * that would take payments.
 */
export function toolsForAgent(raw: unknown): Array<Record<string, unknown>> {
  return filterToolDefinitions(VAANI_AGENT_TOOLS, raw);
}

export {
  MANDATORY_TOOL_NAMES,
  SELECTABLE_TOOLS,
  TOOL_ALIASES,
  filterToolDefinitions,
  resolveToolSelection,
  type ToolSelection,
} from '@/lib/agent-tool-catalog';

export type ToolContext = {
  organizationId: string;
  agentId?: string | null;
  sessionId?: string | null;
  turnId?: number | null;
};

export type ToolOutcome = {
  ok: boolean;
  // Everything else is tool-specific data handed straight back to the model.
  [key: string]: unknown;
};

/**
 * Business tools the voice agent may call. Every write returns an explicit
 * ok flag — the agent is instructed never to announce success without one.
 */
export const VAANI_AGENT_TOOLS: Array<Record<string, unknown>> = [
  {
    name: 'lookup_customer',
    description:
      'Look up an existing customer or lead by phone number. Use before assuming who the caller is. Returns ok:false when not found.',
    input_schema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Phone number, any format.' },
      },
      required: ['phone'],
    },
  },
  {
    name: 'create_lead',
    description:
      'Save a new lead with their requirement. Use after the caller shares what they want.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        phone: { type: 'string' },
        requirement: {
          type: 'string',
          description: 'What the caller is looking for, in their own words.',
        },
        email: { type: 'string' },
      },
      required: ['name', 'phone', 'requirement'],
    },
  },
  {
    name: 'get_available_slots',
    description:
      'Get real free appointment slots. Always call this before offering a time — never invent availability.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' },
        service: { type: 'string' },
      },
    },
  },
  {
    name: 'book_appointment',
    description:
      'Book a slot returned by get_available_slots, only after the caller confirms the exact time.',
    input_schema: {
      type: 'object',
      properties: {
        slot_start: {
          type: 'string',
          description: 'Exact slot_start value from get_available_slots.',
        },
        customer_name: { type: 'string' },
        customer_phone: { type: 'string' },
        service: { type: 'string' },
        mode: { type: 'string', enum: ['in_person', 'video', 'phone'] },
      },
      required: ['slot_start', 'customer_name', 'customer_phone'],
    },
  },
  {
    name: 'create_payment_link',
    description:
      'Create a payment link. Confirm the amount and the delivery channel with the caller first.',
    input_schema: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Amount in rupees.' },
        customer_phone: { type: 'string' },
        customer_name: { type: 'string' },
        description: { type: 'string' },
        delivery: { type: 'string', enum: ['whatsapp', 'email'] },
      },
      required: ['amount', 'delivery'],
    },
  },
  {
    name: 'send_whatsapp',
    description:
      'Queue a WhatsApp message. Ask whether the calling number is on WhatsApp before using this.',
    input_schema: {
      type: 'object',
      properties: {
        phone: { type: 'string' },
        message: { type: 'string' },
        scheduled_for: {
          type: 'string',
          description: 'Optional ISO time to send later.',
        },
      },
      required: ['phone', 'message'],
    },
  },
  {
    name: 'request_document',
    description:
      'Ask the caller to send a document (PAN card, Aadhaar, a signed form, a photo) by creating a real upload link and messaging it to them over WhatsApp. Use this instead of describing where to send it \u2014 you cannot see their email and there is no other address. The result tells you whether the link was actually sent; if sent is false, never tell the caller to check their phone.',
    input_schema: {
      type: 'object',
      properties: {
        phone: { type: 'string' },
        document: {
          type: 'string',
          description:
            'What is being asked for, in the caller\u2019s own words where possible: "PAN card", "address proof".',
        },
      },
      required: ['phone', 'document'],
    },
  },
  {
    name: 'send_listing_media',
    description:
      'Send images, a brochure or other media for listings the caller asked about, over WhatsApp. Use after confirming the number. Some files may be held back for a person to release — say so honestly rather than claiming everything was sent.',
    input_schema: {
      type: 'object',
      properties: {
        phone: { type: 'string' },
        record_ids: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Ids of records the caller asked about, from search_catalog.',
        },
        note: {
          type: 'string',
          description: 'One line to send with the files.',
        },
      },
      required: ['phone', 'record_ids'],
    },
  },
  {
    name: 'transfer_to_human',
    description:
      'Hand the conversation to a human with a short summary. Call this immediately when the caller asks for a person, manager or supervisor — do not interrogate them first. Also use it on repeated misunderstanding or for decisions you are not allowed to make. The result tells you whether a human actually took it; if transferred is false, never say you are connecting them.',
    input_schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Why a human is needed, in one short line.',
        },
        summary: {
          type: 'string',
          description:
            'What the human needs to know before picking up: who the caller is and what they want.',
        },
        // Declared so the model can actually drive queue routing. These were
        // read by the handler but missing from the schema, which meant every
        // transfer arrived with no skill and could not reach a skill queue.
        skill: {
          type: 'string',
          description:
            'Skill the case needs, e.g. sales, support, billing, escalation. Omit if unsure.',
        },
        language: {
          type: 'string',
          description:
            'Language the caller is speaking, as a code such as hi-IN, pa-IN or en-IN.',
        },
      },
      required: ['reason'],
    },
  },
  {
    name: 'request_refund',
    description:
      'Start a refund. You do NOT decide refunds — this runs the business policy engine, which either auto-approves a small eligible refund, raises a manager approval card, or routes to a human. Never tell the caller a refund is done; only that it is submitted or sent for approval.',
    input_schema: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Refund amount in rupees.' },
        order_reference: {
          type: 'string',
          description: 'Order / payment reference the caller gave.',
        },
        reason: {
          type: 'string',
          description: 'Why the caller wants a refund, in their words.',
        },
        customer_phone: { type: 'string' },
        case_summary: {
          type: 'string',
          description: 'Two-line summary for the human approver.',
        },
      },
      required: ['amount', 'reason'],
    },
  },
  {
    name: 'create_callback',
    description:
      'Offer a callback. Use this when no human is available instead of claiming the caller is being connected.',
    input_schema: {
      type: 'object',
      properties: {
        customer_phone: { type: 'string' },
        customer_name: { type: 'string' },
        reason: { type: 'string' },
        requested_window: {
          type: 'string',
          description: 'When the caller wants the callback.',
        },
      },
      required: ['customer_phone'],
    },
  },
  {
    name: 'search_catalog',
    description:
      "Search the workspace's own inventory — properties, products, services, whatever this business sells. Use this before quoting anything. Never describe an item that this tool did not return.",
    input_schema: {
      type: 'object',
      properties: {
        object: {
          type: 'string',
          description:
            "Which catalogue to search, e.g. 'unit', 'product', 'service'. Omit to search the workspace's main one.",
        },
        query: {
          type: 'string',
          description: 'Free text the caller used, e.g. "3BHK in Baner".',
        },
        filters: {
          type: 'array',
          description:
            'Narrow by a field, e.g. price under 5000000 or unit_type equals 3BHK.',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              operator: {
                type: 'string',
                enum: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'contains', 'in'],
              },
              value: {},
            },
            required: ['field', 'operator', 'value'],
          },
        },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_catalog_item',
    description:
      'Read one catalogue item in full, by the id a search returned. Use this when the caller asks for details.',
    input_schema: {
      type: 'object',
      properties: {
        object: { type: 'string' },
        record_id: { type: 'string' },
      },
      required: ['record_id'],
    },
  },
  {
    name: 'check_availability',
    description:
      'Check how many units of a catalogue item are left before promising it. Never say something is in stock without calling this.',
    input_schema: {
      type: 'object',
      properties: {
        object: { type: 'string' },
        record_id: { type: 'string' },
      },
      required: ['record_id'],
    },
  },
  {
    name: 'place_order',
    description:
      'Place an order for catalogue items the caller agreed to buy, and get a payment link for it. Prices come from the catalogue, never from you. Tell the caller the link is on its way — never that the order is confirmed, which only the payment provider can decide.',
    input_schema: {
      type: 'object',
      properties: {
        customer_phone: { type: 'string' },
        customer_name: { type: 'string' },
        customer_email: {
          type: 'string',
          description: 'Needed when the calling number has no WhatsApp.',
        },
        items: {
          type: 'array',
          description: 'Catalogue items, by the id a search returned.',
          items: {
            type: 'object',
            properties: {
              record_id: { type: 'string' },
              quantity: { type: 'number' },
            },
            required: ['record_id'],
          },
        },
        delivery: { type: 'string', enum: ['whatsapp', 'email'] },
      },
      required: ['customer_phone', 'items'],
    },
  },
  {
    name: 'schedule_follow_up',
    description:
      'Schedule a follow-up contact at a specific time. Use this when the caller asks to be contacted later, or when the next step only makes sense after a delay. Say it is scheduled, never that it has happened.',
    input_schema: {
      type: 'object',
      properties: {
        customer_phone: { type: 'string' },
        customer_name: { type: 'string' },
        channel: {
          type: 'string',
          enum: ['call', 'whatsapp'],
          description: 'How the follow-up should reach the customer.',
        },
        run_at: {
          type: 'string',
          description:
            'When to follow up, as an ISO 8601 timestamp. Must be in the future.',
        },
        note: {
          type: 'string',
          description: 'What the follow-up is about, in one sentence.',
        },
      },
      required: ['customer_phone', 'run_at'],
    },
  },
  {
    name: 'end_call',
    description: 'Close the conversation with an outcome.',
    input_schema: {
      type: 'object',
      properties: {
        disposition: {
          type: 'string',
          enum: [
            'resolved',
            'booked',
            'lead_captured',
            'not_interested',
            'callback_requested',
            'transferred',
          ],
        },
        summary: { type: 'string' },
      },
      required: ['disposition'],
    },
  },
];

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function digits(value: unknown) {
  const text =
    typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return text.replace(/\D/g, '');
}

function str(input: Record<string, unknown>, key: string) {
  return typeof input[key] === 'string' ? (input[key] as string).trim() : '';
}

const BUSINESS_HOURS = [10, 11, 12, 13, 14, 15, 16, 17];

async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const db = getRawDb();

  if (name === 'lookup_customer') {
    const phone = digits(input.phone);
    if (phone.length < 6) return { ok: false, reason: 'invalid_phone' };
    const row = await db
      .prepare(`SELECT id, name, phone, email, product_interest, status, score, intent
        FROM leads WHERE organization_id = ? AND replace(replace(phone,'+',''),' ','') LIKE ?
        ORDER BY updated_at DESC LIMIT 1`)
      .bind(ctx.organizationId, `%${phone.slice(-10)}%`)
      .first<Record<string, unknown>>();
    if (!row) return { ok: false, reason: 'not_found' };
    return { ok: true, customer: row };
  }

  if (name === 'create_lead') {
    const name_ = str(input, 'name');
    const phone = digits(input.phone);
    const requirement = str(input, 'requirement');
    if (!name_ || phone.length < 6 || !requirement)
      return { ok: false, reason: 'name, phone and requirement are required' };
    const leadId = id('lead');
    await db
      .prepare(`INSERT INTO leads
        (id, organization_id, name, phone, email, product_interest, notes, status, score, intent)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'new', 60, 'voice_agent')`)
      .bind(
        leadId,
        ctx.organizationId,
        name_,
        phone,
        str(input, 'email') || null,
        requirement.slice(0, 180),
        requirement,
      )
      .run();
    return { ok: true, lead_id: leadId };
  }

  if (name === 'get_available_slots') {
    // `toISOString()` is UTC. Between midnight and 05:30 IST that is
    // yesterday's date, so "today" used to mean the previous day for five and
    // a half hours every night — and every slot it offered came back
    // `slot_in_the_past`.
    const date = /^\d{4}-\d{2}-\d{2}$/.test(str(input, 'date'))
      ? str(input, 'date')
      : todayIn(DEFAULT_TIMEZONE);
    const taken = await db
      .prepare(`SELECT slot_start FROM appointments
        WHERE organization_id = ? AND status != 'cancelled' AND slot_start LIKE ?`)
      .bind(ctx.organizationId, `${date}%`)
      .all<{ slot_start: string }>();
    const busy = new Set((taken.results ?? []).map((row) => row.slot_start));
    const slots = BUSINESS_HOURS.map(
      (hour) => `${date}T${String(hour).padStart(2, '0')}:00`,
    ).filter((slot) => !busy.has(slot));
    return { ok: true, date, available_slots: slots.slice(0, 6) };
  }

  if (name === 'book_appointment') {
    const slot = str(input, 'slot_start');
    const customer = str(input, 'customer_name');
    const phone = digits(input.customer_phone);
    if (!slot || !customer || phone.length < 6)
      return {
        ok: false,
        reason: 'slot_start, customer_name and phone required',
      };
    // Never accept an invented time. The slot must be a real bookable slot in
    // the exact shape get_available_slots returns.
    const shape = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):00$/.exec(slot);
    if (!shape)
      return {
        ok: false,
        reason: 'invalid_slot_format',
        expected: 'YYYY-MM-DDTHH:00 exactly as returned by get_available_slots',
      };
    if (!BUSINESS_HOURS.includes(Number(shape[4])))
      return {
        ok: false,
        reason: 'outside_business_hours',
        business_hours: `${BUSINESS_HOURS[0]}:00-${BUSINESS_HOURS[BUSINESS_HOURS.length - 1]}:00`,
      };
    const today = todayIn(DEFAULT_TIMEZONE);
    if (slot.slice(0, 10) < today)
      return { ok: false, reason: 'slot_in_the_past', today };
    // Idempotency: the same caller + slot can only ever book once.
    const key = `${ctx.organizationId}:${slot}:${phone}`;
    const existing = await db
      .prepare(`SELECT id FROM appointments WHERE idempotency_key = ? LIMIT 1`)
      .bind(key)
      .first<{ id: string }>();
    if (existing)
      return {
        ok: true,
        appointment_id: existing.id,
        slot_start: slot,
        already_booked: true,
      };
    const clash = await db
      .prepare(`SELECT id FROM appointments
        WHERE organization_id = ? AND slot_start = ? AND status != 'cancelled' LIMIT 1`)
      .bind(ctx.organizationId, slot)
      .first<{ id: string }>();
    if (clash) return { ok: false, reason: 'slot_taken', slot_start: slot };
    const appointmentId = id('appt');
    await db
      .prepare(`INSERT INTO appointments
        (id, organization_id, agent_id, customer_name, customer_phone, service, slot_start, mode, status, idempotency_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'booked', ?)`)
      .bind(
        appointmentId,
        ctx.organizationId,
        ctx.agentId ?? null,
        customer,
        phone,
        str(input, 'service') || null,
        slot,
        str(input, 'mode') || 'in_person',
        key,
      )
      .run();
    // The row used to be the end of it. Nothing reached the customer, nothing
    // reminded them, and the model was free to promise a confirmation that
    // was never coming.
    const confirmation = await queueConfirmation({
      organizationId: ctx.organizationId,
      appointmentId,
      customerName: customer,
      customerPhone: phone,
      slot,
      service: str(input, 'service'),
      mode: str(input, 'mode') || 'in_person',
    });
    return {
      ok: true,
      appointment_id: appointmentId,
      slot_start: slot,
      slot_local: describeSlot(slot, DEFAULT_TIMEZONE),
      confirmation_sent: confirmation.sent,
      say: confirmation.sent
        ? `Read the time back as ${describeSlot(slot, DEFAULT_TIMEZONE)} and say a confirmation is on its way over WhatsApp, not that it has arrived.`
        : 'The booking is made, but no confirmation message can be sent. Read the date and time back clearly and do not say anything is on its way to their phone.',
    };
  }

  if (name === 'create_payment_link') {
    const amount = Number(input.amount);
    const delivery = str(input, 'delivery');
    if (!Number.isFinite(amount) || amount <= 0)
      return { ok: false, reason: 'invalid_amount' };
    if (!['whatsapp', 'email'].includes(delivery))
      return { ok: false, reason: 'delivery must be whatsapp or email' };

    // A link nobody can be sent is not a link. This used to be allowed
    // through and then died on the table's NOT NULL constraint, so the tool
    // reported a database error to the model instead of the plain fact that
    // it had no number to send to.
    const phone = digits(input.customer_phone);
    const email = str(input, 'customer_email');
    if (delivery === 'whatsapp' && phone.length < 6)
      return {
        ok: false,
        reason: 'customer_phone is required to send over WhatsApp',
      };
    if (delivery === 'email' && !email.includes('@'))
      return {
        ok: false,
        reason: 'customer_email is required to send over email',
      };

    const linkId = id('paylink');
    const reference = id('ref');
    // Every other writer of this column stores paise, and the whole UI divides
    // by 100 to display it. This tool's schema asks the model for rupees, so
    // the conversion happens here — writing rupees into a paise column showed
    // a ₹5,000 link to the customer as ₹50.
    const paise = Math.round(amount * 100);
    const description = str(input, 'description') || 'Voice agent payment';
    // The caller's name is often not known on a cold call. The number is how a
    // voice call identifies somebody, so it stands in — better than inventing
    // a "Customer" who does not exist.
    const customerName = str(input, 'customer_name') || phone || email;

    let link: {
      provider: string;
      externalId: string | null;
      shortUrl: string;
      payload: unknown;
    };
    try {
      link = await createRazorpayPaymentLink({
        organizationId: ctx.organizationId,
        referenceId: reference,
        amount: paise,
        currency: 'INR',
        description,
        customerName,
        customerPhone: phone,
        customerEmail: email || null,
      });
    } catch (error) {
      return {
        ok: false,
        reason:
          error instanceof Error
            ? error.message
            : 'payment_provider_unavailable',
      };
    }

    await db
      .prepare(`INSERT INTO payment_links
        (id, organization_id, agent_id, reference_id, customer_name, customer_phone,
         customer_email, amount, currency, description, delivery_mode, provider,
         external_payment_link_id, short_url, status, provider_payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, 'created', ?)`)
      .bind(
        linkId,
        ctx.organizationId,
        ctx.agentId ?? null,
        reference,
        customerName,
        phone,
        email || null,
        paise,
        description,
        delivery,
        link.provider,
        link.externalId,
        link.shortUrl,
        JSON.stringify(link.payload).slice(0, 4000),
      )
      .run();
    // The link used to be created and then nothing was queued: `delivery_mode`
    // said 'whatsapp' and no message ever existed, so the caller was told a
    // link was on its way to a number nothing was ever sent to.
    const deliverable =
      delivery === 'email' || (await whatsAppConnected(ctx.organizationId));
    if (deliverable)
      await db
        .prepare(`INSERT INTO outbound_messages
          (id, organization_id, payment_link_id, channel, destination, message_body, status)
          VALUES (?, ?, ?, ?, ?, ?, 'queued')`)
        .bind(
          id('msg'),
          ctx.organizationId,
          linkId,
          delivery,
          delivery === 'email' ? email : phone,
          `${description} — ₹${amount.toLocaleString('en-IN')}. Pay here: ${link.shortUrl}`,
        )
        .run();

    return {
      ok: true,
      payment_link_id: linkId,
      reference_id: reference,
      amount_rupees: amount,
      short_url: link.shortUrl,
      delivery,
      queued_for_delivery: deliverable,
      // Said plainly, and differently in each case, because the model repeats
      // this to a person waiting for a link.
      say: !deliverable
        ? 'The link exists but this workspace has no WhatsApp connection, so nothing was sent. Read the amount out and say a colleague will send the link.'
        : link.provider === 'razorpay_sandbox'
          ? 'Created against a test payment account, so do not tell the caller a real payment link is on its way.'
          : 'Tell the caller the link is on its way, not that it has arrived.',
    };
  }

  if (name === 'send_whatsapp') {
    const phone = digits(input.phone);
    const messageBody = str(input, 'message');
    if (phone.length < 6 || !messageBody)
      return { ok: false, reason: 'phone and message required' };
    // Said before the row is written, not after. This used to return
    // `{ok: true, status: 'queued'}` whatever the workspace had connected —
    // the model then told the caller the message was on its way, and with no
    // WhatsApp connection it never was.
    if (!(await whatsAppConnected(ctx.organizationId)))
      return {
        ok: false,
        reason: 'whatsapp_not_connected',
        say: 'Do not tell the caller anything was sent. This workspace has no WhatsApp connection, so offer to read it out or have a colleague follow up.',
      };
    const messageId = id('msg');
    await db
      .prepare(`INSERT INTO outbound_messages
        (id, organization_id, channel, destination, message_body, status, scheduled_for)
        VALUES (?, ?, 'whatsapp', ?, ?, 'queued', ?)`)
      .bind(
        messageId,
        ctx.organizationId,
        phone,
        messageBody.slice(0, 900),
        str(input, 'scheduled_for') || null,
      )
      .run();
    return {
      ok: true,
      message_id: messageId,
      status: 'queued',
      // "Queued" is the truth. Delivery happens in a job moments later, and
      // the model must not upgrade that to "delivered".
      say: 'Tell the caller it is on its way, not that it has arrived — you cannot see their phone.',
    };
  }

  if (name === 'request_document') {
    const phone = digits(input.phone);
    const document = str(input, 'document');
    if (phone.length < 6 || !document)
      return { ok: false, reason: 'phone and document required' };
    // Order matters. A request row created before the connection is checked
    // would leave the workspace waiting on a link that was never sent \u2014 the
    // same shape of defect this tool exists to remove.
    if (!(await whatsAppConnected(ctx.organizationId)))
      return {
        ok: false,
        reason: 'whatsapp_not_connected',
        say: 'Do not tell the caller to check their phone. This workspace has no WhatsApp connection, so say a colleague will arrange how to receive the document.',
      };
    const request = await createDocumentRequest({
      organizationId: ctx.organizationId,
      document,
      contactPhone: phone,
      source: 'call',
      requestedBy: ctx.sessionId ?? null,
    });
    if (!request.ok)
      return {
        ok: false,
        reason: request.reason,
        detail: request.detail,
        say: 'No upload link could be created, so say a colleague will follow up about how to send the document. Do not tell the caller a link is on its way.',
      };
    const messageId = id('msg');
    await db
      .prepare(`INSERT INTO outbound_messages
        (id, organization_id, channel, destination, message_body, status)
        VALUES (?, ?, 'whatsapp', ?, ?, 'queued')`)
      .bind(messageId, ctx.organizationId, phone, request.message)
      .run();
    return {
      ok: true,
      sent: true,
      document_request_id: request.id,
      message_id: messageId,
      expires_at: request.expiresAt,
      say: 'Tell the caller a link is on its way over WhatsApp and that it works for the next few days. Do not read the link out \u2014 it is long.',
    };
  }

  if (name === 'send_listing_media') {
    const phone = digits(input.phone);
    if (phone.length < 6) return { ok: false, reason: 'phone required' };
    if (!(await whatsAppConnected(ctx.organizationId)))
      return {
        ok: false,
        reason: 'whatsapp_not_connected',
        say: 'Do not promise any files. This workspace has no WhatsApp connection yet.',
      };
    const recordIds = Array.isArray(input.record_ids)
      ? input.record_ids
          .map((entry: unknown) => str({ v: entry }, 'v'))
          .filter(Boolean)
      : [];
    if (recordIds.length === 0)
      return { ok: false, reason: 'no records named' };

    // Only published records, and only from this workspace. An agent asked to
    // "send those options" must not be able to reach a draft nobody approved
    // or a record belonging to somebody else.
    const placeholders = recordIds
      .slice(0, 10)
      .map(() => '?')
      .join(', ');
    const rows = await db
      .prepare(`SELECT id, title, values_json FROM records
        WHERE organization_id = ? AND status = 'published' AND id IN (${placeholders})`)
      .bind(ctx.organizationId, ...recordIds.slice(0, 10))
      .all<{ id: string; title: string; values_json: string }>();
    if ((rows.results ?? []).length === 0)
      return { ok: false, reason: 'no_published_records_matched' };

    const requested = (rows.results ?? []).flatMap((row) =>
      assetsOfRecord(row.id, row.title, row.values_json),
    );
    const policy = await agentSendPolicy(ctx.organizationId, ctx.agentId);
    const set = buildSendSet({ requested, policy });

    const sendId = id('wasend');
    await db
      .prepare(`INSERT INTO whatsapp_sends
        (id, organization_id, session_id, agent_id, destination, sent_json, withheld_json, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        sendId,
        ctx.organizationId,
        ctx.sessionId ?? null,
        ctx.agentId ?? null,
        phone,
        JSON.stringify(
          set.sending.map((asset) => ({ id: asset.id, label: asset.label })),
        ),
        JSON.stringify(
          // The label goes in too. Whoever releases this later is deciding
          // whether to send a file to a customer, and "Skyline 3BHK — floor
          // plan" is that decision; the asset id is machine noise.
          set.withheld.map((entry) => ({
            id: entry.asset.id,
            label: entry.asset.label,
            reason: entry.reason,
          })),
        ),
        set.sending.length > 0 ? 'queued' : 'nothing_to_send',
      )
      .run();

    if (set.sending.length > 0) {
      const note = str(input, 'note');
      await db
        .prepare(`INSERT INTO outbound_messages
          (id, organization_id, channel, destination, message_body, status)
          VALUES (?, ?, 'whatsapp', ?, ?, 'queued')`)
        .bind(
          id('msg'),
          ctx.organizationId,
          phone,
          `${note ? `${note}\n` : ''}${set.sending.map((asset) => `${asset.label}: ${asset.url}`).join('\n')}`.slice(
            0,
            900,
          ),
        )
        .run();
    }

    return {
      ok: set.sending.length > 0,
      send_id: sendId,
      sent: set.sending.map((asset) => asset.label),
      withheld: set.withheld.map((entry) => ({
        item: entry.asset.label,
        reason: entry.reason,
      })),
      needs_approval: set.needsApproval,
      // The sentence the model is meant to work from, so a partial send is
      // never announced to the caller as a complete one.
      say: describeSend(set),
    };
  }

  if (name === 'transfer_to_human') {
    const reason = str(input, 'reason');
    if (!reason) return { ok: false, reason: 'reason required' };
    const transfer = await initiateWarmTransfer({
      organizationId: ctx.organizationId,
      agentId: ctx.agentId,
      sessionId: ctx.sessionId,
      reason,
      summary: str(input, 'summary') || null,
      skill: str(input, 'skill') || null,
      language: str(input, 'language') || null,
    });
    return { ...transfer };
  }

  if (name === 'request_refund') {
    const amount = Number(input.amount);
    const reason = str(input, 'reason');
    if (!Number.isFinite(amount) || amount <= 0)
      return { ok: false, reason: 'invalid_amount' };
    if (!reason) return { ok: false, reason: 'reason required' };
    const orderReference = str(input, 'order_reference');
    const phone = digits(input.customer_phone);

    // Deterministic eligibility from real records — not model reasoning.
    const conditions: string[] = [];
    const failed: string[] = [];
    if (orderReference) {
      const priorRefund = await db
        .prepare(`SELECT id FROM refunds WHERE organization_id = ? AND order_reference = ?
          AND status != 'failed' LIMIT 1`)
        .bind(ctx.organizationId, orderReference)
        .first<{ id: string }>();
      if (priorRefund) conditions.push('duplicate_refund');
      const payment = await db
        .prepare(`SELECT id, status, amount FROM payment_links
          WHERE organization_id = ? AND (reference_id = ? OR id = ?) LIMIT 1`)
        .bind(ctx.organizationId, orderReference, orderReference)
        .first<{ id: string; status: string; amount: number }>();
      if (!payment) failed.push('payment_record_not_found');
      else if (Number(payment.amount) < Math.round(amount))
        failed.push('amount_exceeds_payment');
    } else {
      failed.push('order_reference_missing');
    }

    const idempotencyKey = `refund:${ctx.organizationId}:${orderReference || phone || ctx.sessionId}:${Math.round(amount)}`;
    const card = await createApprovalRequest({
      organizationId: ctx.organizationId,
      sessionId: ctx.sessionId,
      action: 'refund',
      amount,
      reason,
      caseSummary: str(input, 'case_summary') || null,
      evidence: { order_reference: orderReference, customer_phone: phone },
      policy: DEFAULT_REFUND_POLICY,
      eligibility: { passed: failed.length === 0, failed },
      conditions,
      idempotencyKey: `approval:${idempotencyKey}`,
    });

    if (card.decision === 'auto_execute') {
      const refund = await recordRefundRequest({
        organizationId: ctx.organizationId,
        approvalId: card.approvalId,
        sessionId: ctx.sessionId,
        orderReference: orderReference || null,
        customerPhone: phone || null,
        amount,
        reason,
        policyVersion: card.policyVersion,
        authorisedBy: 'policy:auto_execute',
        idempotencyKey,
      });
      return {
        ok: true,
        decision: 'auto_execute',
        risk_level: card.riskLevel,
        policy_version: card.policyVersion,
        refund_id: refund.refundId,
        status: refund.status,
        confirmed: false,
        say_to_customer:
          'The refund request is submitted and you will get a confirmation once the payment provider processes it. Do not say it is already refunded.',
      };
    }

    if (card.decision === 'manager_approval') {
      return {
        ok: true,
        decision: 'manager_approval',
        risk_level: card.riskLevel,
        policy_reasons: card.reasons,
        approval_id: card.approvalId,
        status: card.status,
        confirmed: false,
        say_to_customer:
          'This refund needs a manager approval. Tell the caller it has been sent for approval and they will hear back — do not promise the outcome.',
      };
    }

    // human_only / blocked
    const transfer = await initiateWarmTransfer({
      organizationId: ctx.organizationId,
      agentId: ctx.agentId,
      sessionId: ctx.sessionId,
      reason: `refund_${card.decision}: ${reason}`,
      summary: str(input, 'case_summary') || reason,
      skill: 'refund',
      minRole: 'manager',
    });
    return {
      ok: true,
      decision: card.decision,
      risk_level: card.riskLevel,
      policy_reasons: card.reasons,
      approval_id: card.approvalId,
      transfer,
      confirmed: false,
      say_to_customer: transfer.transferred
        ? 'Tell the caller you are connecting them to a specialist now.'
        : 'No human is available. Offer a callback with create_callback — do not say they are being connected.',
    };
  }

  if (name === 'create_callback') {
    const phone = digits(input.customer_phone);
    if (phone.length < 6) return { ok: false, reason: 'invalid_phone' };
    return createCallbackRequest({
      organizationId: ctx.organizationId,
      sessionId: ctx.sessionId,
      customerName: str(input, 'customer_name') || null,
      customerPhone: phone,
      reason: str(input, 'reason') || null,
      requestedWindow: str(input, 'requested_window') || null,
    });
  }

  if (
    name === 'search_catalog' ||
    name === 'get_catalog_item' ||
    name === 'check_availability'
  ) {
    // §7-9: the agent reads the workspace's real inventory. Before this, the
    // "inventory" a preset told the model to answer from did not exist, so it
    // had nothing to consult and answered from the prompt.
    const objects = await listObjects(ctx.organizationId);
    if (!objects.length)
      return {
        ok: false,
        reason: 'no_catalog_configured',
        say_to_customer:
          'I do not have the catalogue in front of me, so let me have a colleague send you the details.',
      };
    const requested = str(input, 'object');
    const object =
      objects.find(
        (entry) => entry.key === requested || entry.id === requested,
      ) ??
      // No object named: the one with the most records is the catalogue this
      // workspace actually sells from.
      (await busiestObject(ctx.organizationId, objects));
    if (!object)
      return {
        ok: false,
        reason: 'unknown_object',
        available: objects.map((o) => o.key),
      };

    if (name === 'search_catalog') {
      const filters = Array.isArray(input.filters)
        ? (input.filters as Array<Record<string, unknown>>)
            .filter((entry) => entry && typeof entry === 'object')
            .map((entry) => ({
              field: typeof entry.field === 'string' ? entry.field : '',
              operator: (typeof entry.operator === 'string'
                ? entry.operator
                : 'eq') as Filter['operator'],
              value: entry.value,
            }))
        : [];
      const result = await searchRecords({
        organizationId: ctx.organizationId,
        object,
        filters,
        text: str(input, 'query') || null,
        limit: Math.max(1, Math.min(10, Number(input.limit) || 5)),
        // Only what the workspace has published. A draft is something nobody
        // has stood behind, and quoting it on a call would be quoting nobody.
        publishedOnly: true,
      });
      return {
        ok: true,
        object: object.key,
        matches: result.records.map((record) => ({
          id: record.id,
          title: record.title,
          detail: record.summary,
        })),
        total: result.total,
        // Reported, so the model does not present a narrower answer than it
        // actually asked for as if it had been narrowed.
        ...(result.skippedFilters.length
          ? { filters_not_applied: result.skippedFilters }
          : {}),
      };
    }

    const record = await getRecord(
      ctx.organizationId,
      object,
      str(input, 'record_id'),
    );
    if (!record) return { ok: false, reason: 'not_found' };

    if (name === 'get_catalog_item')
      return {
        ok: true,
        object: object.key,
        item: { id: record.id, title: record.title, ...record.values },
      };

    const inventoryField = object.fields.find(
      (field) => field.type === 'inventory',
    );
    if (!inventoryField)
      return {
        ok: false,
        reason: 'no_inventory_field',
        say_to_customer:
          'I cannot confirm availability from here — let me get that checked and come back to you.',
      };
    const available = Number(record.values[inventoryField.key] ?? 0);
    return {
      ok: true,
      object: object.key,
      record_id: record.id,
      available,
      in_stock: available > 0,
    };
  }

  if (name === 'place_order') {
    const phone = digits(input.customer_phone);
    if (phone.length < 6) return { ok: false, reason: 'invalid_phone' };
    const rawItems = Array.isArray(input.items) ? input.items : [];
    const items = rawItems
      .filter(
        (entry): entry is Record<string, unknown> =>
          !!entry && typeof entry === 'object',
      )
      .map((entry) => ({
        recordId: typeof entry.record_id === 'string' ? entry.record_id : '',
        quantity: Number(entry.quantity ?? 1),
      }))
      .filter((entry) => entry.recordId);
    if (!items.length) return { ok: false, reason: 'no_items' };
    const delivery = ['whatsapp', 'email'].includes(str(input, 'delivery'))
      ? str(input, 'delivery')
      : 'whatsapp';

    const order = await createOrder({
      organizationId: ctx.organizationId,
      items,
      customerName: str(input, 'customer_name') || null,
      customerPhone: phone,
      customerEmail: str(input, 'customer_email') || null,
      sessionId: ctx.sessionId ?? null,
      // The same caller asking twice in one conversation gets one order, not
      // two payment links for the same basket.
      idempotencyKey: `order:${ctx.organizationId}:${ctx.sessionId ?? phone}:${items
        .map((entry) => `${entry.recordId}x${entry.quantity}`)
        .sort()
        .join('|')}`,
    });
    if (!order.ok)
      return { ok: false, reason: 'order_rejected', problems: order.errors };

    // The payment link is created against the order's own total, so the amount
    // is the catalogue's, not the model's.
    const linkId = id('paylink');
    const reference = id('ref');
    const orderDescription = order.lines
      .map((line) => `${line.quantity}× ${line.title}`)
      .join(', ')
      .slice(0, 300);
    // Same three columns the standalone payment link tool used to omit:
    // customer_name and short_url are NOT NULL, so this insert failed too.
    const orderCustomer = str(input, 'customer_name') || phone;
    const orderLink = await createRazorpayPaymentLink({
      organizationId: ctx.organizationId,
      referenceId: reference,
      amount: Math.round(order.total),
      currency: 'INR',
      description: orderDescription,
      customerName: orderCustomer,
      customerPhone: phone,
    });
    await db
      .prepare(`INSERT INTO payment_links
        (id, organization_id, agent_id, reference_id, customer_name, customer_phone,
         amount, currency, description, delivery_mode, provider,
         external_payment_link_id, short_url, status, provider_payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, 'created', ?)`)
      .bind(
        linkId,
        ctx.organizationId,
        ctx.agentId ?? null,
        reference,
        orderCustomer,
        phone,
        Math.round(order.total),
        orderDescription,
        delivery,
        orderLink.provider,
        orderLink.externalId,
        orderLink.shortUrl,
        JSON.stringify(orderLink.payload).slice(0, 4000),
      )
      .run();
    await db
      .prepare(`UPDATE orders SET payment_link_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND organization_id = ?`)
      .bind(linkId, order.orderId, ctx.organizationId)
      .run();
    // Queued for the same reason: an order's payment link that nothing sends
    // is an order nobody can pay for.
    const orderDeliverable =
      delivery === 'email' || (await whatsAppConnected(ctx.organizationId));
    if (orderDeliverable)
      await db
        .prepare(`INSERT INTO outbound_messages
          (id, organization_id, payment_link_id, channel, destination, message_body, status)
          VALUES (?, ?, ?, ?, ?, ?, 'queued')`)
        .bind(
          id('msg'),
          ctx.organizationId,
          linkId,
          delivery,
          phone,
          `${orderDescription} — ₹${(Math.round(order.total) / 100).toLocaleString('en-IN')}. Pay here: ${orderLink.shortUrl}`,
        )
        .run();

    return {
      ok: true,
      order_id: order.orderId,
      payment_link_id: linkId,
      reference_id: reference,
      total: order.total,
      currency: order.currency,
      items: order.lines,
      // §22: the order is not confirmed and the download is not open. The model
      // is handed the sentence rather than left to compose one.
      status: order.status,
      queued_for_delivery: orderDeliverable,
      say_to_customer: orderDeliverable
        ? order.sayToCustomer
        : `${order.sayToCustomer} This workspace has no WhatsApp connection, so the payment link was not sent — say a colleague will send it rather than that it is on its way.`,
      ...(order.hasDigital
        ? {
            digital_delivery:
              'unlocks only after the payment provider confirms',
          }
        : {}),
    };
  }

  if (name === 'schedule_follow_up') {
    // Advertised in every agent's tool list since the beginning and never
    // implemented, so a model that decided to schedule a follow-up called a
    // tool that did not exist. It runs on the same `scheduled_actions` queue
    // that already carries payment links.
    const phone = digits(input.customer_phone);
    if (phone.length < 6) return { ok: false, reason: 'invalid_phone' };
    const runAtRaw = str(input, 'run_at');
    const runAt = Date.parse(runAtRaw);
    if (!Number.isFinite(runAt)) return { ok: false, reason: 'invalid_run_at' };
    // A follow-up in the past would fire immediately and look like a bug to the
    // customer; more than a year out is a model mistake, not an intention.
    const now = Date.now();
    if (runAt <= now + 60_000)
      return { ok: false, reason: 'run_at_must_be_at_least_a_minute_ahead' };
    if (runAt > now + 365 * 24 * 3600_000)
      return { ok: false, reason: 'run_at_too_far_ahead' };
    const channel = str(input, 'channel') === 'whatsapp' ? 'whatsapp' : 'call';
    // Attach to the lead when there is one, so the follow-up shows up on the
    // customer's timeline rather than floating free.
    const lead = await db
      .prepare(
        `SELECT id FROM leads WHERE organization_id = ?
           AND replace(replace(phone,'+',''),' ','') LIKE ?
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .bind(ctx.organizationId, `%${phone.slice(-10)}%`)
      .first<{ id: string }>();
    const actionId = id('action');
    await db
      .prepare(`INSERT INTO scheduled_actions
        (id, organization_id, lead_id, agent_id, type, payload_json, status, run_at)
        VALUES (?, ?, ?, ?, 'follow_up', ?, 'pending', ?)`)
      .bind(
        actionId,
        ctx.organizationId,
        lead?.id ?? null,
        ctx.agentId ?? null,
        JSON.stringify({
          customerPhone: phone,
          customerName: str(input, 'customer_name') || null,
          channel,
          note: str(input, 'note').slice(0, 300) || null,
        }),
        new Date(runAt).toISOString(),
      )
      .run();
    return {
      ok: true,
      scheduled: true,
      actionId,
      channel,
      runAt: new Date(runAt).toISOString(),
      note: 'Follow-up scheduled. Tell the caller when it will happen — not that it already has.',
    };
  }

  if (name === 'end_call') {
    const disposition = str(input, 'disposition') || 'resolved';
    if (ctx.sessionId) {
      await db
        .prepare(`UPDATE agent_test_sessions SET status = 'completed',
          updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`)
        .bind(ctx.sessionId, ctx.organizationId)
        .run();
    }
    return { ok: true, disposition };
  }

  return { ok: false, reason: `unknown_tool:${name}` };
}

/** Execute a tool and log the call (input, result, latency) for observability. */
export async function executeAgentTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const started = Date.now();
  let outcome: ToolOutcome;
  try {
    outcome = await runTool(name, input, ctx);
  } catch (error) {
    outcome = {
      ok: false,
      reason: error instanceof Error ? error.message : 'tool_failed',
    };
  }
  const latencyMs = Date.now() - started;
  try {
    await getRawDb()
      .prepare(`INSERT INTO agent_tool_calls
        (id, organization_id, session_id, turn_id, tool_name, input_json, result_json, ok, error_message, latency_ms, outcome_kind)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        id('toolcall'),
        ctx.organizationId,
        ctx.sessionId ?? null,
        ctx.turnId ?? null,
        name,
        JSON.stringify(input).slice(0, 4000),
        JSON.stringify(outcome).slice(0, 4000),
        outcome.ok ? 1 : 0,
        outcome.ok
          ? null
          : (typeof outcome.reason === 'string'
              ? outcome.reason
              : 'failed'
            ).slice(0, 300),
        latencyMs,
        // Separate from `ok`, which is the tool's answer to the model and must
        // keep saying "no such customer". This is what the tool *did*, so a
        // negative answer is not counted as a broken tool.
        toolOutcomeKind(
          outcome.ok,
          typeof outcome.reason === 'string' ? outcome.reason : null,
        ),
      )
      .run();
  } catch {
    /* logging must never break the turn */
  }
  return outcome;
}

/**
 * The catalogue a workspace actually sells from, when the model did not name
 * one. Most workspaces have a single object with records in it; picking the
 * fullest is a better guess than picking the first alphabetically.
 */
async function busiestObject(
  organizationId: string,
  objects: ObjectDefinition[],
): Promise<ObjectDefinition | null> {
  if (objects.length === 1) return objects[0];
  const counts = await getRawDb()
    .prepare(
      `SELECT object_id, count(*) AS total FROM records
       WHERE organization_id = ? AND status = 'published'
       GROUP BY object_id ORDER BY total DESC LIMIT 1`,
    )
    .bind(organizationId)
    .first<{ object_id: string }>();
  return (
    objects.find((entry) => entry.id === counts?.object_id) ??
    objects[0] ??
    null
  );
}

/**
 * The media attached to one record.
 *
 * Records carry arbitrary custom fields, so the assets are whatever the
 * workspace put in its own image/brochure/video fields — not a fixed shape
 * invented here.
 */
/** What this agent is allowed to release on its own (Part 3.1). */
async function agentSendPolicy(
  organizationId: string,
  agentId?: string | null,
): Promise<SendPolicy> {
  if (!agentId) return DEFAULT_SEND_POLICY;
  try {
    const row = await getRawDb()
      .prepare(
        `SELECT send_policy_json FROM voice_agents WHERE id = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(agentId, organizationId)
      .first<{ send_policy_json: string | null }>();
    if (!row?.send_policy_json) return DEFAULT_SEND_POLICY;
    const parsed = JSON.parse(row.send_policy_json) as Partial<SendPolicy>;
    return {
      allowedKinds: Array.isArray(parsed.allowedKinds)
        ? (parsed.allowedKinds as MediaKind[])
        : DEFAULT_SEND_POLICY.allowedKinds,
      maxAssets:
        typeof parsed.maxAssets === 'number' && parsed.maxAssets > 0
          ? Math.min(10, Math.round(parsed.maxAssets))
          : DEFAULT_SEND_POLICY.maxAssets,
      allowSensitive: parsed.allowSensitive === true,
    };
  } catch {
    // An unreadable policy is the restrictive one, not a free pass.
    return DEFAULT_SEND_POLICY;
  }
}
