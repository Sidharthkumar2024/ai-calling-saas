import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';
import {
  createRazorpayPaymentLink,
  sendEmailPaymentLink,
  sendWhatsAppPaymentLink,
} from '@/lib/commerce';
import { recordAudit } from '@/lib/demo-seed';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const db = getRawDb();
  const [paymentLinks, messages, actions, connections] = await Promise.all([
    db
      .prepare(`SELECT id, reference_id, customer_name, customer_phone, amount, currency,
          description, delivery_mode, scheduled_for, provider, short_url, status, paid_at, created_at
        FROM payment_links WHERE organization_id = ? ORDER BY created_at DESC LIMIT 50`)
      .bind(auth.session.organizationId)
      .all(),
    db
      .prepare(`SELECT id, payment_link_id, channel, destination, template_name, message_body,
          status, provider_reference, error_message, scheduled_for, sent_at, created_at
        FROM outbound_messages WHERE organization_id = ? ORDER BY created_at DESC LIMIT 50`)
      .bind(auth.session.organizationId)
      .all(),
    db
      .prepare(`SELECT id, type, status, run_at, attempt_count, last_error, completed_at, created_at
        FROM scheduled_actions WHERE organization_id = ? ORDER BY created_at DESC LIMIT 50`)
      .bind(auth.session.organizationId)
      .all(),
    db
      .prepare(`SELECT type, status FROM integration_connections
        WHERE organization_id = ? AND type IN ('razorpay', 'whatsapp_cloud', 'email_resend')`)
      .bind(auth.session.organizationId)
      .all(),
  ]);
  return NextResponse.json({
    paymentLinks: paymentLinks.results,
    messages: messages.results,
    scheduledActions: actions.results,
    connections: connections.results,
    mode: {
      razorpay: process.env.RAZORPAY_KEY_ID
        ? 'environment'
        : 'workspace_or_sandbox',
      whatsapp: process.env.WHATSAPP_ACCESS_TOKEN
        ? 'environment'
        : 'workspace_or_sandbox',
    },
  });
}

export async function POST(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const body = (await request.json()) as {
    action?: 'create_payment_link' | 'run_due';
    customerName?: string;
    customerPhone?: string;
    customerEmail?: string;
    amount?: number;
    description?: string;
    deliveryMode?: 'instant' | 'scheduled';
    scheduledFor?: string;
  };
  if (body.action === 'run_due') {
    return runDueActions(auth.session.organizationId!);
  }
  if (body.action !== 'create_payment_link') {
    return NextResponse.json(
      { error: 'Unsupported commerce action.' },
      { status: 400 },
    );
  }
  const customerName = body.customerName?.trim();
  const customerPhone = body.customerPhone?.replaceAll(' ', '').trim() || '';
  const customerEmail = body.customerEmail?.trim().toLowerCase() || '';
  const description = body.description?.trim();
  const amountPaise = Math.round(Number(body.amount ?? 0) * 100);
  const validPhone = /^\+?[1-9]\d{7,14}$/.test(customerPhone);
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail);
  if (!customerName || (!validPhone && !validEmail) || !description) {
    return NextResponse.json(
      {
        error:
          'Customer, description and either a valid WhatsApp number or email are required.',
      },
      { status: 400 },
    );
  }
  if (
    !Number.isSafeInteger(amountPaise) ||
    amountPaise < 100 ||
    amountPaise > 500_000_000
  ) {
    return NextResponse.json(
      { error: 'Amount must be between ₹1 and ₹50,00,000.' },
      { status: 400 },
    );
  }
  const deliveryMode =
    body.deliveryMode === 'scheduled' ? 'scheduled' : 'instant';
  const scheduledFor =
    deliveryMode === 'scheduled' ? parseFutureDate(body.scheduledFor) : null;
  if (deliveryMode === 'scheduled' && !scheduledFor) {
    return NextResponse.json(
      { error: 'Choose a valid future delivery time.' },
      { status: 400 },
    );
  }

  const organizationId = auth.session.organizationId!;
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
  const paymentLinkId = `payment_${suffix}`;
  const messageId = `message_${suffix}`;
  const referenceId = `VAI-${Date.now().toString(36).toUpperCase()}-${suffix.slice(0, 5).toUpperCase()}`;
  const created = await createRazorpayPaymentLink({
    organizationId,
    referenceId,
    amount: amountPaise,
    currency: 'INR',
    description,
    customerName,
    customerPhone,
    customerEmail: validEmail ? customerEmail : null,
  });
  const messageBody = `${customerName}, your secure payment link for ₹${(amountPaise / 100).toLocaleString('en-IN')} is ready: ${created.shortUrl}`;
  const db = getRawDb();
  const preferredChannel = validPhone ? 'whatsapp' : 'email';
  const preferredDestination =
    preferredChannel === 'whatsapp' ? customerPhone : customerEmail;

  if (deliveryMode === 'scheduled') {
    const actionId = `action_${suffix}`;
    await db.batch([
      db
        .prepare(`INSERT INTO payment_links
          (id, organization_id, reference_id, customer_name, customer_phone, customer_email,
           amount, currency, description, delivery_mode, scheduled_for, provider,
           external_payment_link_id, short_url, status, provider_payload_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'INR', ?, 'scheduled', ?, ?, ?, ?, 'scheduled', ?)`)
        .bind(
          paymentLinkId,
          organizationId,
          referenceId,
          customerName,
          customerPhone,
          validEmail ? customerEmail : null,
          amountPaise,
          description,
          scheduledFor,
          created.provider,
          created.externalId,
          created.shortUrl,
          JSON.stringify(created.payload),
        ),
      db
        .prepare(`INSERT INTO outbound_messages
          (id, organization_id, payment_link_id, channel, destination, template_name,
           message_body, status, scheduled_for)
          VALUES (?, ?, ?, ?, ?, 'vaani_payment_link', ?, 'scheduled', ?)`)
        .bind(
          messageId,
          organizationId,
          paymentLinkId,
          preferredChannel,
          preferredDestination,
          messageBody,
          scheduledFor,
        ),
      db
        .prepare(`INSERT INTO scheduled_actions
          (id, organization_id, type, payload_json, status, run_at)
          VALUES (?, ?, 'send_payment_link', ?, 'pending', ?)`)
        .bind(
          actionId,
          organizationId,
          JSON.stringify({
            paymentLinkId,
            messageId,
            channel: preferredChannel,
          }),
          scheduledFor,
        ),
    ]);
    await recordAudit(
      auth.session,
      'payment_link.scheduled',
      'payment_link',
      paymentLinkId,
      { referenceId, scheduledFor },
    );
    return NextResponse.json(
      {
        paymentLinkId,
        referenceId,
        shortUrl: created.shortUrl,
        status: 'scheduled',
        scheduledFor,
      },
      { status: 201 },
    );
  }

  let delivery: Awaited<ReturnType<typeof sendWhatsAppPaymentLink>>;
  let deliveredChannel = preferredChannel;
  let deliveredDestination = preferredDestination;
  try {
    delivery =
      preferredChannel === 'whatsapp'
        ? await sendWhatsAppPaymentLink({
            organizationId,
            destination: customerPhone,
            customerName,
            amount: amountPaise,
            shortUrl: created.shortUrl,
          })
        : await sendEmailPaymentLink({
            organizationId,
            destination: customerEmail,
            customerName,
            amount: amountPaise,
            shortUrl: created.shortUrl,
          });
    if (
      preferredChannel === 'whatsapp' &&
      delivery.status === 'sandbox_delivered' &&
      validEmail
    ) {
      delivery = await sendEmailPaymentLink({
        organizationId,
        destination: customerEmail,
        customerName,
        amount: amountPaise,
        shortUrl: created.shortUrl,
      });
      deliveredChannel = 'email';
      deliveredDestination = customerEmail;
    }
  } catch (error) {
    if (preferredChannel === 'whatsapp' && validEmail) {
      try {
        delivery = await sendEmailPaymentLink({
          organizationId,
          destination: customerEmail,
          customerName,
          amount: amountPaise,
          shortUrl: created.shortUrl,
        });
        deliveredChannel = 'email';
        deliveredDestination = customerEmail;
      } catch (fallbackError) {
        delivery = {
          status: 'failed',
          providerReference: '',
          payload: {
            error:
              fallbackError instanceof Error
                ? fallbackError.message
                : 'Delivery failed.',
          },
        };
      }
    } else {
      delivery = {
        status: 'failed',
        providerReference: '',
        payload: {
          error: error instanceof Error ? error.message : 'Delivery failed.',
        },
      };
    }
  }
  const paymentStatus =
    delivery.status === 'failed' ? 'delivery_failed' : 'sent';
  await db.batch([
    db
      .prepare(`INSERT INTO payment_links
        (id, organization_id, reference_id, customer_name, customer_phone, customer_email,
         amount, currency, description, delivery_mode, provider, external_payment_link_id,
         short_url, status, provider_payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'INR', ?, 'instant', ?, ?, ?, ?, ?)`)
      .bind(
        paymentLinkId,
        organizationId,
        referenceId,
        customerName,
        customerPhone,
        validEmail ? customerEmail : null,
        amountPaise,
        description,
        created.provider,
        created.externalId,
        created.shortUrl,
        paymentStatus,
        JSON.stringify(created.payload),
      ),
    db
      .prepare(`INSERT INTO outbound_messages
        (id, organization_id, payment_link_id, channel, destination, template_name,
         message_body, status, provider_reference, error_message, sent_at)
        VALUES (?, ?, ?, ?, ?, 'vaani_payment_link', ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
      .bind(
        messageId,
        organizationId,
        paymentLinkId,
        deliveredChannel,
        deliveredDestination,
        messageBody,
        delivery.status,
        delivery.providerReference || null,
        delivery.status === 'failed' ? JSON.stringify(delivery.payload) : null,
      ),
  ]);
  await recordAudit(
    auth.session,
    'payment_link.created',
    'payment_link',
    paymentLinkId,
    { referenceId, deliveryStatus: delivery.status },
  );
  return NextResponse.json(
    {
      paymentLinkId,
      referenceId,
      shortUrl: created.shortUrl,
      status: delivery.status,
      provider: created.provider,
    },
    { status: 201 },
  );
}

async function runDueActions(organizationId: string) {
  const db = getRawDb();
  const due = await db
    .prepare(`SELECT id, payload_json FROM scheduled_actions
      WHERE organization_id = ? AND status = 'pending' AND run_at <= ? ORDER BY run_at LIMIT 20`)
    .bind(organizationId, new Date().toISOString())
    .all<{ id: string; payload_json: string }>();
  let completed = 0;
  const failures: string[] = [];
  for (const action of due.results) {
    try {
      const payload = JSON.parse(action.payload_json) as {
        paymentLinkId?: string;
        messageId?: string;
        channel?: 'whatsapp' | 'email';
      };
      const payment = await db
        .prepare(`SELECT customer_name, customer_phone, customer_email, amount, short_url FROM payment_links
          WHERE id = ? AND organization_id = ? LIMIT 1`)
        .bind(payload.paymentLinkId, organizationId)
        .first<{
          customer_name: string;
          customer_phone: string;
          customer_email: string | null;
          amount: number;
          short_url: string;
        }>();
      if (!payment || !payload.messageId)
        throw new Error('Scheduled payment message is incomplete.');
      const delivery =
        payload.channel === 'email' && payment.customer_email
          ? await sendEmailPaymentLink({
              organizationId,
              destination: payment.customer_email,
              customerName: payment.customer_name,
              amount: payment.amount,
              shortUrl: payment.short_url,
            })
          : await sendWhatsAppPaymentLink({
              organizationId,
              destination: payment.customer_phone,
              customerName: payment.customer_name,
              amount: payment.amount,
              shortUrl: payment.short_url,
            });
      await db.batch([
        db
          .prepare(`UPDATE outbound_messages SET status = ?, provider_reference = ?,
          sent_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`)
          .bind(
            delivery.status,
            delivery.providerReference,
            payload.messageId,
            organizationId,
          ),
        db
          .prepare(`UPDATE scheduled_actions SET status = 'completed', attempt_count = attempt_count + 1,
          completed_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(action.id),
        db
          .prepare(
            `UPDATE payment_links SET status = 'sent' WHERE id = ? AND organization_id = ?`,
          )
          .bind(payload.paymentLinkId, organizationId),
      ]);
      completed += 1;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Scheduled delivery failed.';
      failures.push(message);
      await db
        .prepare(`UPDATE scheduled_actions SET status = CASE WHEN attempt_count + 1 >= max_attempts
        THEN 'failed' ELSE 'pending' END, attempt_count = attempt_count + 1, last_error = ? WHERE id = ?`)
        .bind(message.slice(0, 500), action.id)
        .run();
    }
  }
  return NextResponse.json({
    processed: due.results.length,
    completed,
    failures,
  });
}

function parseFutureDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) return null;
  return date.toISOString();
}
