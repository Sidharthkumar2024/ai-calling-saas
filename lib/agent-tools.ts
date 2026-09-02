import { getRawDb } from '@/db/index';
import { DEFAULT_REFUND_POLICY } from '@/lib/action-policy';
import {
  createApprovalRequest,
  createCallbackRequest,
  initiateWarmTransfer,
  recordRefundRequest,
} from '@/lib/handoff-service';

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
    const date = /^\d{4}-\d{2}-\d{2}$/.test(str(input, 'date'))
      ? str(input, 'date')
      : new Date().toISOString().slice(0, 10);
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
    const today = new Date().toISOString().slice(0, 10);
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
    return { ok: true, appointment_id: appointmentId, slot_start: slot };
  }

  if (name === 'create_payment_link') {
    const amount = Number(input.amount);
    const delivery = str(input, 'delivery');
    if (!Number.isFinite(amount) || amount <= 0)
      return { ok: false, reason: 'invalid_amount' };
    if (!['whatsapp', 'email'].includes(delivery))
      return { ok: false, reason: 'delivery must be whatsapp or email' };
    const linkId = id('paylink');
    const reference = id('ref');
    await db
      .prepare(`INSERT INTO payment_links
        (id, organization_id, agent_id, reference_id, customer_name, customer_phone,
         amount, currency, description, delivery_mode, provider, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?, 'razorpay', 'created')`)
      .bind(
        linkId,
        ctx.organizationId,
        ctx.agentId ?? null,
        reference,
        str(input, 'customer_name') || null,
        digits(input.customer_phone) || null,
        Math.round(amount),
        str(input, 'description') || 'Voice agent payment',
        delivery,
      )
      .run();
    return {
      ok: true,
      payment_link_id: linkId,
      reference_id: reference,
      amount: Math.round(amount),
      delivery,
      note: 'Link record created. Delivery happens through the configured provider.',
    };
  }

  if (name === 'send_whatsapp') {
    const phone = digits(input.phone);
    const messageBody = str(input, 'message');
    if (phone.length < 6 || !messageBody)
      return { ok: false, reason: 'phone and message required' };
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
    return { ok: true, message_id: messageId, status: 'queued' };
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
        (id, organization_id, session_id, turn_id, tool_name, input_json, result_json, ok, error_message, latency_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
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
      )
      .run();
  } catch {
    /* logging must never break the turn */
  }
  return outcome;
}
