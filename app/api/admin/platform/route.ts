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
  const [authProviders, platformProviders, tickets, messages] =
    await Promise.all([
      db
        .prepare(
          'SELECT provider, display_name, button_visible, enabled, status, public_config_json, updated_at FROM auth_provider_settings ORDER BY display_name',
        )
        .all(),
      db
        .prepare(
          'SELECT id, public_name, category, required_credentials_json, status, health, usage_note, customer_visible, updated_at FROM platform_providers ORDER BY category, public_name',
        )
        .all(),
      db
        .prepare(`SELECT t.*, o.name AS organization_name, u.email AS creator_email FROM support_tickets t
      INNER JOIN organizations o ON o.id = t.organization_id LEFT JOIN app_users u ON u.id = t.created_by_user_id
      ORDER BY t.updated_at DESC`)
        .all(),
      db
        .prepare('SELECT * FROM support_ticket_messages ORDER BY created_at')
        .all(),
    ]);
  return NextResponse.json({
    authProviders: authProviders.results,
    platformProviders: platformProviders.results,
    providerReadiness: await providerReadiness(),
    tickets: tickets.results,
    ticketMessages: messages.results,
  });
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  await ensureSchema();
  const body = (await request.json()) as {
    action?: string;
    provider?: string;
    buttonVisible?: boolean;
    enabled?: boolean;
    id?: string;
    status?: string;
    health?: string;
    ticketId?: string;
    message?: string;
    planId?: string;
    name?: string;
    monthlyPrice?: number;
    includedCredits?: number;
    maxAgents?: number;
    maxNumbers?: number;
    concurrency?: number;
    credits?: number;
    price?: number;
    numberId?: string;
    rejectionReason?: string;
  };
  const db = getRawDb();
  if (body.action === 'auth_visibility') {
    const result = await db
      .prepare(
        `UPDATE auth_provider_settings SET button_visible = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE provider = ?`,
      )
      .bind(body.buttonVisible ? 1 : 0, auth.session.userId, body.provider)
      .run();
    if (!result.meta.changes)
      return NextResponse.json(
        { error: 'Auth provider not found.' },
        { status: 404 },
      );
    await recordAudit(
      auth.session,
      'auth_provider.visibility_updated',
      'auth_provider',
      body.provider,
      { buttonVisible: body.buttonVisible },
    );
    return NextResponse.json({ updated: true });
  }
  if (body.action === 'auth_enabled') {
    const configured =
      body.provider === 'google'
        ? Boolean(
            process.env.GOOGLE_CLIENT_ID &&
            process.env.GOOGLE_CLIENT_SECRET &&
            process.env.GOOGLE_REDIRECT_URI,
          )
        : false;
    if (body.enabled && !configured) {
      return NextResponse.json(
        {
          error: 'Configure the provider credentials before enabling sign-in.',
        },
        { status: 409 },
      );
    }
    const result = await db
      .prepare(`UPDATE auth_provider_settings SET enabled = ?, status = ?, updated_by = ?,
      updated_at = CURRENT_TIMESTAMP WHERE provider = ?`)
      .bind(
        body.enabled ? 1 : 0,
        body.enabled ? 'active' : 'admin_disabled',
        auth.session.userId,
        body.provider,
      )
      .run();
    if (!result.meta.changes)
      return NextResponse.json(
        { error: 'Auth provider not found.' },
        { status: 404 },
      );
    await recordAudit(
      auth.session,
      'auth_provider.enabled_updated',
      'auth_provider',
      body.provider,
      { enabled: body.enabled },
    );
    return NextResponse.json({ updated: true });
  }
  if (body.action === 'provider_status') {
    const result = await db
      .prepare(
        `UPDATE platform_providers SET status = ?, health = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .bind(body.status || 'required', body.health || 'not_connected', body.id)
      .run();
    if (!result.meta.changes)
      return NextResponse.json(
        { error: 'Platform provider not found.' },
        { status: 404 },
      );
    return NextResponse.json({ updated: true });
  }
  if (body.action === 'plan_update') {
    if (!body.planId || !body.name?.trim())
      return NextResponse.json(
        { error: 'Plan and name are required.' },
        { status: 400 },
      );
    const monthlyPrice = boundedInteger(body.monthlyPrice, 0, 100_000_000);
    const includedCredits = boundedInteger(
      body.includedCredits,
      0,
      100_000_000,
    );
    const maxAgents = boundedInteger(body.maxAgents, 1, 100_000);
    const maxNumbers = boundedInteger(body.maxNumbers, 1, 100_000);
    const concurrency = boundedInteger(body.concurrency, 1, 1_000_000);
    const status = body.status === 'inactive' ? 'inactive' : 'active';
    const result = await db
      .prepare(`UPDATE plans SET name = ?, monthly_price = ?, included_credits = ?,
      max_agents = ?, max_numbers = ?, concurrency = ?, status = ? WHERE id = ?`)
      .bind(
        body.name.trim().slice(0, 80),
        monthlyPrice,
        includedCredits,
        maxAgents,
        maxNumbers,
        concurrency,
        status,
        body.planId,
      )
      .run();
    if (!result.meta.changes)
      return NextResponse.json({ error: 'Plan not found.' }, { status: 404 });
    await recordAudit(
      auth.session,
      'billing.plan_updated',
      'plan',
      body.planId,
      { status, includedCredits, concurrency },
    );
    return NextResponse.json({ updated: true });
  }
  if (body.action === 'credit_package_create') {
    if (!body.name?.trim())
      return NextResponse.json(
        { error: 'Package name is required.' },
        { status: 400 },
      );
    const credits = boundedInteger(body.credits, 100, 100_000_000);
    const price = boundedInteger(body.price, 0, 100_000_000);
    const id = `credit_package_${crypto.randomUUID()}`;
    await db
      .prepare(
        `INSERT INTO credit_packages (id, name, credits, amount, status) VALUES (?, ?, ?, ?, 'active')`,
      )
      .bind(id, body.name.trim().slice(0, 80), credits, price)
      .run();
    await recordAudit(
      auth.session,
      'billing.credit_package_created',
      'credit_package',
      id,
      { credits, price },
    );
    return NextResponse.json({ created: true, id });
  }
  if (body.action === 'kyc_status') {
    if (!body.numberId || !['approved', 'rejected'].includes(body.status ?? ''))
      return NextResponse.json(
        { error: 'Number and review decision are required.' },
        { status: 400 },
      );
    const approved = body.status === 'approved';
    const review = await db
      .prepare(`SELECT n.id, n.status, n.onboarding_status,
      (SELECT count(*) FROM kyc_documents d WHERE d.phone_number_id = n.id AND d.status = 'submitted') AS submitted_documents
      FROM phone_numbers n WHERE n.id = ? LIMIT 1`)
      .bind(body.numberId)
      .first<{
        id: string;
        status: string;
        onboarding_status: string;
        submitted_documents: number;
      }>();
    if (!review)
      return NextResponse.json(
        { error: 'Number request not found.' },
        { status: 404 },
      );
    if (approved && Number(review.submitted_documents) < 1) {
      return NextResponse.json(
        {
          error:
            'At least one submitted KYC document is required before approval.',
        },
        { status: 409 },
      );
    }
    if (
      approved &&
      !['kyc_review', 'provider_review'].includes(review.status) &&
      !['kyc_review', 'provider_review'].includes(review.onboarding_status)
    ) {
      return NextResponse.json(
        {
          error:
            'Ownership and KYC review must be completed before activation.',
        },
        { status: 409 },
      );
    }
    const result = await db
      .prepare(
        `UPDATE phone_numbers SET kyc_status = ?, status = ?, onboarding_status = ? WHERE id = ?`,
      )
      .bind(
        body.status,
        approved ? 'active' : 'kyc_rejected',
        approved ? 'active' : 'changes_required',
        body.numberId,
      )
      .run();
    if (!result.meta.changes)
      return NextResponse.json(
        { error: 'Number request was not updated.' },
        { status: 409 },
      );
    await db
      .prepare(
        `UPDATE kyc_documents SET status = ?, rejection_reason = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE phone_number_id = ?`,
      )
      .bind(
        body.status,
        approved
          ? null
          : body.rejectionReason?.trim().slice(0, 300) ||
              'Please resubmit the requested business evidence.',
        auth.session.userId,
        body.numberId,
      )
      .run();
    await recordAudit(
      auth.session,
      `kyc.${body.status}`,
      'phone_number',
      body.numberId,
    );
    return NextResponse.json({ updated: true });
  }
  if (body.action === 'ticket_reply') {
    const ticket = await db
      .prepare('SELECT id FROM support_tickets WHERE id = ?')
      .bind(body.ticketId)
      .first<{ id: string }>();
    if (!ticket || !body.message?.trim())
      return NextResponse.json(
        { error: 'Ticket and reply are required.' },
        { status: 400 },
      );
    await db.batch([
      db
        .prepare(
          `INSERT INTO support_ticket_messages (id, ticket_id, sender_role, sender_name, message) VALUES (?, ?, 'admin', ?, ?)`,
        )
        .bind(
          `ticket_message_${crypto.randomUUID()}`,
          ticket.id,
          auth.session.name,
          body.message.trim().slice(0, 4000),
        ),
      db
        .prepare(
          `UPDATE support_tickets SET status = 'waiting_on_customer', assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        )
        .bind(auth.session.name, ticket.id),
    ]);
    return NextResponse.json({ replied: true });
  }
  if (body.action === 'ticket_status') {
    const allowed = [
      'open',
      'in_progress',
      'waiting_on_customer',
      'resolved',
      'closed',
    ];
    if (!allowed.includes(body.status ?? ''))
      return NextResponse.json(
        { error: 'Invalid ticket status.' },
        { status: 400 },
      );
    await db
      .prepare(
        `UPDATE support_tickets SET status = ?, assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .bind(body.status, auth.session.name, body.ticketId)
      .run();
    return NextResponse.json({ updated: true });
  }
  return NextResponse.json(
    { error: 'Unsupported platform action.' },
    { status: 400 },
  );
}

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return minimum;
  return Math.min(maximum, Math.max(minimum, parsed));
}
