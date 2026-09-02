import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { sha256 } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  await ensureSchema();
  const token = new URL(request.url).searchParams.get('token') || '';
  if (!token.startsWith('invite_') || token.length < 24)
    return NextResponse.json(
      { error: 'Invitation is invalid.' },
      { status: 400 },
    );
  const invitation = await getRawDb()
    .prepare(`SELECT i.email, i.role, i.expires_at, o.name AS organization_name
    FROM team_invitations i INNER JOIN organizations o ON o.id = i.organization_id
    WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ? LIMIT 1`)
    .bind(await sha256(token), new Date().toISOString())
    .first<{
      email: string;
      role: string;
      expires_at: string;
      organization_name: string;
    }>();
  if (!invitation)
    return NextResponse.json(
      { error: 'Invitation is expired or already used.' },
      { status: 404 },
    );
  return NextResponse.json({
    email: invitation.email,
    role: invitation.role,
    organizationName: invitation.organization_name,
    expiresAt: invitation.expires_at,
  });
}
