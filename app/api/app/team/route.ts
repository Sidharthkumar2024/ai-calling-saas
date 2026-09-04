import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { createOpaqueToken, sha256 } from '@/lib/security';
import { recordAudit } from '@/lib/demo-seed';
import { sendTransactionalEmail } from '@/lib/commerce';
import {
  canManageTargetRole,
  getCustomerAccess,
  publicRoleCatalog,
  requireCustomerPermission,
} from '@/lib/customer-rbac';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireCustomerPermission(request, 'team.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const db = getRawDb();
  const organizationId = auth.session.organizationId!;
  const [members, invitations] = await Promise.all([
    db
      .prepare(`SELECT m.id, m.user_id, m.email, m.role, m.created_at, u.name, u.status, u.last_login_at
      FROM organization_members m LEFT JOIN app_users u ON u.id = m.user_id
      WHERE m.organization_id = ? ORDER BY m.created_at`)
      .bind(organizationId)
      .all(),
    db
      .prepare(`SELECT id, email, role, expires_at, created_at FROM team_invitations
      WHERE organization_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC`)
      .bind(organizationId, new Date().toISOString())
      .all(),
  ]);
  const access = await getCustomerAccess(auth.session);
  return NextResponse.json({
    members: members.results,
    invitations: invitations.results,
    access,
    roleCatalog: publicRoleCatalog(),
  });
}

export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'team.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const body = (await request.json()) as { email?: string; role?: string };
  const email = body.email?.trim().toLowerCase() || '';
  const role = [
    'admin',
    'sales_manager',
    'agent',
    'support_agent',
    'analyst',
    'billing',
  ].includes(body.role || '')
    ? body.role!
    : 'agent';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return NextResponse.json(
      { error: 'A valid email is required.' },
      { status: 400 },
    );
  const db = getRawDb();
  const existing = await db
    .prepare(
      `SELECT id FROM organization_members WHERE organization_id = ? AND lower(email) = ?`,
    )
    .bind(auth.session.organizationId, email)
    .first();
  if (existing)
    return NextResponse.json(
      { error: 'This user is already a member.' },
      { status: 409 },
    );
  const token = createOpaqueToken('invite_');
  const id = `invite_${crypto.randomUUID()}`;
  await db
    .prepare(`INSERT INTO team_invitations
    (id, organization_id, email, role, token_hash, invited_by, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      id,
      auth.session.organizationId,
      email,
      role,
      await sha256(token),
      auth.session.userId,
      new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
    )
    .run();
  const invitationUrl = `${new URL(request.url).origin}/signup?invite=${encodeURIComponent(token)}`;
  // Actually send it. This used to report `email_pending` in production while
  // nothing ever delivered an invitation.
  let delivery: string;
  let deliveryDetail: string | null = null;
  try {
    const sent = await sendTransactionalEmail({
      organizationId: auth.session.organizationId!,
      to: email,
      subject: `You have been invited to ${auth.session.organizationName ?? 'a Vaani workspace'}`,
      html: `<p>Hello,</p><p>You have been invited to join <strong>${escapeHtml(
        auth.session.organizationName ?? 'a Vaani workspace',
      )}</strong> as <strong>${escapeHtml(role)}</strong>.</p><p><a href="${escapeHtml(
        invitationUrl,
      )}">Accept the invitation</a></p><p>This link expires in 7 days.</p>`,
    });
    delivery = sent.status === 'sent' ? 'sent' : 'not_sent';
    if (sent.status !== 'sent')
      deliveryDetail =
        'No transactional email provider is connected, so the invitation was not emailed. Share the link below instead.';
  } catch (error) {
    delivery = 'failed';
    deliveryDetail =
      error instanceof Error
        ? error.message
        : 'The email provider rejected the send.';
  }
  return NextResponse.json(
    {
      id,
      delivery,
      ...(deliveryDetail ? { deliveryDetail } : {}),
      // The link is returned whenever the email did not go out, so an admin is
      // never left with an invitation nobody can accept.
      ...(delivery === 'sent' ? {} : { invitationUrl }),
    },
    { status: 201 },
  );
}

export async function PATCH(request: Request) {
  const auth = await requireCustomerPermission(request, 'team.manage');
  if (auth.response) return auth.response;
  const body = (await request.json()) as {
    memberId?: string;
    role?: string;
    action?: string;
  };
  const db = getRawDb();
  if (
    body.action === 'role' &&
    body.memberId &&
    [
      'admin',
      'sales_manager',
      'agent',
      'support_agent',
      'analyst',
      'billing',
    ].includes(body.role || '')
  ) {
    // Check the TARGET's current role, not just the actor's permission: an
    // admin must not be able to demote another admin or the owner.
    const target = await db
      .prepare(
        `SELECT role, user_id FROM organization_members WHERE id = ? AND organization_id = ? AND user_id != ? LIMIT 1`,
      )
      .bind(body.memberId, auth.session.organizationId, auth.session.userId)
      .first<{ role: string; user_id: string }>();
    if (!target)
      return NextResponse.json(
        { error: 'Member was not found or cannot be changed.' },
        { status: 404 },
      );
    if (!canManageTargetRole(auth.access.role, target.role))
      return NextResponse.json(
        {
          error: `Your role cannot change a member with the ${target.role} role. Only the owner can.`,
        },
        { status: 403 },
      );
    await db
      .prepare(
        `UPDATE organization_members SET role = ? WHERE id = ? AND organization_id = ? AND user_id != ?`,
      )
      .bind(
        body.role,
        body.memberId,
        auth.session.organizationId,
        auth.session.userId,
      )
      .run();
    await recordAudit(
      auth.session,
      'team.role_changed',
      'organization_member',
      body.memberId,
      {
        from: target.role,
        to: body.role,
      },
    );
    return NextResponse.json({ updated: true });
  }
  if (body.action === 'remove' && body.memberId) {
    const member = await db
      .prepare(
        `SELECT user_id, role FROM organization_members WHERE id = ? AND organization_id = ? AND user_id != ?`,
      )
      .bind(body.memberId, auth.session.organizationId, auth.session.userId)
      .first<{ user_id: string; role: string }>();
    if (!member)
      return NextResponse.json(
        { error: 'Member was not found or cannot be removed.' },
        { status: 404 },
      );
    if (!canManageTargetRole(auth.access.role, member.role))
      return NextResponse.json(
        {
          error: `Your role cannot remove a member with the ${member.role} role. Only the owner can.`,
        },
        { status: 403 },
      );
    await db.batch([
      db
        .prepare('DELETE FROM organization_members WHERE id = ?')
        .bind(body.memberId),
      db
        .prepare("UPDATE app_users SET status = 'disabled' WHERE id = ?")
        .bind(member.user_id),
      db
        .prepare('DELETE FROM auth_sessions WHERE user_id = ?')
        .bind(member.user_id),
    ]);
    await recordAudit(
      auth.session,
      'team.member_removed',
      'organization_member',
      body.memberId,
      {
        role: member.role,
      },
    );
    return NextResponse.json({ removed: true });
  }
  return NextResponse.json(
    { error: 'Unsupported team action.' },
    { status: 400 },
  );
}

/** Invitation emails interpolate a workspace name and a role. */
function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
