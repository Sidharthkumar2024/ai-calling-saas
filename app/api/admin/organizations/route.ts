import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { hashPassword } from '@/lib/security';
import { adminCapabilities, requireAdminCapability } from '@/lib/admin-rbac';
import { recordAudit } from '@/lib/demo-seed';

export const dynamic = 'force-dynamic';

/**
 * Tenant lifecycle (blueprint §2 "Tenant Management").
 *
 * There was no admin API to create or suspend an organization at all — the
 * portal's "Invite customer" button had no handler and was removed. Suspending
 * is what an operator actually needs for non-payment or abuse, and it must be
 * reversible and audited.
 */
export async function GET(request: Request) {
  const auth = await requireAdminCapability(request, 'tenants.read');
  if (auth.response) return auth.response;
  const rows = await getRawDb()
    .prepare(`SELECT o.id, o.slug, o.name, o.status, o.suspended_at,
        o.suspension_reason, o.created_at,
        p.name AS plan_name, p.code AS plan_code,
        w.balance,
        (SELECT count(*) FROM app_users u WHERE u.organization_id = o.id) AS users,
        (SELECT count(*) FROM voice_agents a WHERE a.organization_id = o.id) AS agents,
        (SELECT count(*) FROM phone_numbers n WHERE n.organization_id = o.id) AS numbers,
        (SELECT count(*) FROM call_records c WHERE c.organization_id = o.id
           AND c.started_at >= datetime('now','-30 days')) AS calls_30d
      FROM organizations o
      LEFT JOIN subscriptions s ON s.organization_id = o.id
      LEFT JOIN plans p ON p.id = s.plan_id
      LEFT JOIN organization_wallets w ON w.organization_id = o.id
      ORDER BY o.created_at DESC LIMIT 200`)
    .all();
  return NextResponse.json({
    organizations: rows.results ?? [],
    adminRole: auth.adminRole,
    capabilities: adminCapabilities(auth.adminRole ?? 'analyst'),
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const action = typeof body.action === 'string' ? body.action : '';
  const capability =
    action === 'suspend' || action === 'reactivate'
      ? 'tenants.suspend'
      : 'tenants.manage';
  const auth = await requireAdminCapability(request, capability);
  if (auth.response) return auth.response;
  const db = getRawDb();
  const text = (key: string, max = 120) =>
    typeof body[key] === 'string'
      ? (body[key] as string).trim().slice(0, max)
      : '';

  if (action === 'create') {
    const name = text('name', 80);
    const ownerEmail = text('ownerEmail', 160).toLowerCase();
    const ownerName = text('ownerName', 80) || 'Workspace owner';
    const planCode = text('planCode', 40);
    if (!name || !ownerEmail)
      return NextResponse.json(
        { error: 'Workspace name and owner email are required.' },
        { status: 400 },
      );
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail))
      return NextResponse.json(
        { error: 'Owner email is not valid.' },
        { status: 400 },
      );
    const existingUser = await db
      .prepare(`SELECT id FROM app_users WHERE lower(email) = ? LIMIT 1`)
      .bind(ownerEmail)
      .first<{ id: string }>();
    if (existingUser)
      return NextResponse.json(
        { error: 'That email already has an account.' },
        { status: 409 },
      );
    const plan = planCode
      ? await db
          .prepare(
            `SELECT id, name FROM plans WHERE code = ? AND status = 'active' LIMIT 1`,
          )
          .bind(planCode)
          .first<{ id: string; name: string }>()
      : await db
          .prepare(
            `SELECT id, name FROM plans WHERE status = 'active' ORDER BY monthly_price LIMIT 1`,
          )
          .first<{ id: string; name: string }>();
    if (!plan)
      return NextResponse.json(
        { error: 'No active plan is available to assign.' },
        { status: 409 },
      );

    const slugBase =
      text('slug', 40)
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, '-') ||
      name
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, '-')
        .slice(0, 40);
    let slug = slugBase.replace(/^-+|-+$/g, '') || 'workspace';
    const clash = await db
      .prepare(`SELECT id FROM organizations WHERE slug = ? LIMIT 1`)
      .bind(slug)
      .first<{ id: string }>();
    if (clash) slug = `${slug}-${crypto.randomUUID().slice(0, 6)}`;

    // A temporary password the operator must hand over out of band; the owner
    // is expected to reset it. No credential is ever echoed back in a list.
    const temporaryPassword = `Vaani-${crypto.randomUUID().slice(0, 12)}`;
    const organizationId = `org_${crypto.randomUUID()}`;
    const ownerId = `user_${crypto.randomUUID()}`;
    await db.batch([
      db
        .prepare(
          `INSERT INTO organizations (id, slug, name, status) VALUES (?, ?, ?, 'active')`,
        )
        .bind(organizationId, slug, name),
      db
        .prepare(`INSERT INTO app_users
          (id, organization_id, name, email, password_hash, role, status)
          VALUES (?, ?, ?, ?, ?, 'customer_owner', 'active')`)
        .bind(
          ownerId,
          organizationId,
          ownerName,
          ownerEmail,
          await hashPassword(temporaryPassword),
        ),
      db
        .prepare(`INSERT INTO organization_members
          (id, organization_id, user_id, email, role)
          VALUES (?, ?, ?, ?, 'owner')`)
        .bind(
          `member_${crypto.randomUUID()}`,
          organizationId,
          ownerId,
          ownerEmail,
        ),
      db
        .prepare(`INSERT INTO organization_wallets
          (organization_id, balance, low_balance_threshold) VALUES (?, 0, 500)`)
        .bind(organizationId),
      db
        .prepare(`INSERT INTO subscriptions
          (id, organization_id, plan_id, status) VALUES (?, ?, ?, 'trialing')`)
        .bind(`sub_${crypto.randomUUID()}`, organizationId, plan.id),
      db
        .prepare(`INSERT INTO organization_settings
          (organization_id, timezone, default_language, enabled_languages_json)
          VALUES (?, 'Asia/Kolkata', 'hinglish', '["hinglish","hi-IN","en-IN"]')`)
        .bind(organizationId),
    ]);
    await recordAudit(
      auth.session,
      'organization.created',
      'organization',
      organizationId,
      { slug, plan: plan.name },
    );
    return NextResponse.json(
      {
        organizationId,
        slug,
        plan: plan.name,
        ownerEmail,
        temporaryPassword,
        note: 'Hand the temporary password over out of band. The owner should change it on first sign-in.',
      },
      { status: 201 },
    );
  }

  if (action === 'suspend' || action === 'reactivate') {
    const organizationId = text('organizationId', 80);
    const reason = text('reason', 240);
    if (action === 'suspend' && !reason)
      return NextResponse.json(
        { error: 'A suspension reason is required for the audit trail.' },
        { status: 400 },
      );
    const organization = await db
      .prepare(
        `SELECT id, name, status FROM organizations WHERE id = ? LIMIT 1`,
      )
      .bind(organizationId)
      .first<{ id: string; name: string; status: string }>();
    if (!organization)
      return NextResponse.json(
        { error: 'Organization not found.' },
        { status: 404 },
      );
    const suspending = action === 'suspend';
    await db
      .prepare(`UPDATE organizations
        SET status = ?, suspended_at = ?, suspension_reason = ?
        WHERE id = ?`)
      .bind(
        suspending ? 'suspended' : 'active',
        suspending ? new Date().toISOString() : null,
        suspending ? reason : null,
        organizationId,
      )
      .run();
    // Suspension must stop work in flight, not just hide the workspace.
    if (suspending) {
      await db
        .prepare(
          `UPDATE campaigns SET status = 'paused' WHERE organization_id = ? AND status = 'running'`,
        )
        .bind(organizationId)
        .run();
      await db
        .prepare(
          `UPDATE background_jobs SET status = 'cancelled' WHERE organization_id = ? AND status = 'queued'`,
        )
        .bind(organizationId)
        .run();
    }
    await recordAudit(
      auth.session,
      suspending ? 'organization.suspended' : 'organization.reactivated',
      'organization',
      organizationId,
      { reason: reason || null, previousStatus: organization.status },
    );
    return NextResponse.json({
      organizationId,
      status: suspending ? 'suspended' : 'active',
      campaignsPaused: suspending,
    });
  }

  if (action === 'set_admin_role') {
    const elevated = await requireAdminCapability(request, 'security.manage');
    if (elevated.response) return elevated.response;
    const userId = text('userId', 80);
    const role = text('role', 40);
    if (!['super_admin', 'operations', 'finance', 'analyst'].includes(role))
      return NextResponse.json(
        { error: 'Unsupported admin role.' },
        { status: 400 },
      );
    if (userId === auth.session.userId && role !== 'super_admin')
      return NextResponse.json(
        {
          error:
            'You cannot remove your own super_admin role — another super admin must do it.',
        },
        { status: 409 },
      );
    const result = await db
      .prepare(
        `UPDATE app_users SET admin_role = ? WHERE id = ? AND role = 'platform_admin'`,
      )
      .bind(role, userId)
      .run();
    if (!result.meta.changes)
      return NextResponse.json(
        { error: 'Platform admin not found.' },
        { status: 404 },
      );
    await recordAudit(auth.session, 'admin_role.changed', 'app_user', userId, {
      role,
    });
    return NextResponse.json({ userId, role });
  }

  return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
}
