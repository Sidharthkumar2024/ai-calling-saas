import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';
import { recordAudit } from '@/lib/demo-seed';
import { sha256 } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const body = (await request.json()) as { numberId?: string; code?: string };
  if (!body.numberId || !/^\d{6}$/.test(body.code ?? '')) {
    return NextResponse.json({ error: 'Number and 6-digit code are required.' }, { status: 400 });
  }

  const db = getRawDb();
  const verification = await db
    .prepare(
      `SELECT v.id, v.code_hash, v.attempt_count, v.expires_at
       FROM number_verifications v
       INNER JOIN phone_numbers n ON n.id = v.phone_number_id
       WHERE n.id = ? AND n.organization_id = ? AND v.verified_at IS NULL
       ORDER BY v.created_at DESC LIMIT 1`,
    )
    .bind(body.numberId, auth.session.organizationId)
    .first<{
      id: string;
      code_hash: string;
      attempt_count: number;
      expires_at: string;
    }>();
  if (!verification) {
    return NextResponse.json({ error: 'Active verification not found.' }, { status: 404 });
  }
  if (verification.attempt_count >= 5 || verification.expires_at <= new Date().toISOString()) {
    return NextResponse.json({ error: 'Verification expired. Start again.' }, { status: 410 });
  }

  const matches = (await sha256(body.code!)) === verification.code_hash;
  if (!matches) {
    await db
      .prepare('UPDATE number_verifications SET attempt_count = attempt_count + 1 WHERE id = ?')
      .bind(verification.id)
      .run();
    return NextResponse.json({ error: 'Verification code is incorrect.' }, { status: 400 });
  }

  await db.batch([
    db
      .prepare('UPDATE number_verifications SET verified_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(verification.id),
    db
      .prepare(
        `UPDATE phone_numbers SET status = 'kyc_required', kyc_status = 'not_submitted'
         WHERE id = ? AND organization_id = ?`,
      )
      .bind(body.numberId, auth.session.organizationId),
  ]);
  await recordAudit(auth.session, 'number.ownership_verified', 'phone_number', body.numberId);
  return NextResponse.json({
    ok: true,
    status: 'kyc_required',
    nextStep: 'Complete KYC and calling-purpose approval before activation.',
  });
}
