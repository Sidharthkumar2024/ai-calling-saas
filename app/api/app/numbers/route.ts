import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';
import { recordAudit } from '@/lib/demo-seed';
import { sha256 } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const rows = await getRawDb()
    .prepare(
      `SELECT id, phone_number, country, number_type, acquisition_type,
         public_provider_name, assigned_agent_name, direction, kyc_status,
         status, monthly_rental, created_at
       FROM phone_numbers WHERE organization_id = ? ORDER BY created_at DESC`,
    )
    .bind(auth.session.organizationId)
    .all();
  return NextResponse.json({ numbers: rows.results });
}

export async function POST(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const body = (await request.json()) as {
    action?: 'rent' | 'connect';
    phoneNumber?: string;
    assignedAgentName?: string;
    direction?: 'inbound' | 'outbound' | 'inbound_outbound';
  };
  if (body.action !== 'rent' && body.action !== 'connect') {
    return NextResponse.json({ error: 'Choose rent or connect.' }, { status: 400 });
  }

  const db = getRawDb();
  const id = `number_${crypto.randomUUID()}`;
  const direction = body.direction ?? 'inbound_outbound';
  if (body.action === 'rent') {
    const suffix = String(1000 + crypto.getRandomValues(new Uint32Array(1))[0] % 9000);
    const phoneNumber = `+91124498${suffix}`;
    await db
      .prepare(
        `INSERT INTO phone_numbers
         (id, organization_id, phone_number, country, number_type,
          acquisition_type, public_provider_name, assigned_agent_name,
          direction, kyc_status, status, monthly_rental)
         VALUES (?, ?, ?, 'IN', 'local', 'platform_provided', 'Vaani Connect', ?, ?,
          'not_submitted', 'kyc_required', 49900)`,
      )
      .bind(
        id,
        auth.session.organizationId,
        phoneNumber,
        body.assignedAgentName?.trim() || null,
        direction,
      )
      .run();
    await recordAudit(auth.session, 'number.rental_requested', 'phone_number', id);
    return NextResponse.json(
      {
        number: { id, phoneNumber, status: 'kyc_required' },
        nextStep: 'Complete business KYC and calling-purpose review.',
      },
      { status: 201 },
    );
  }

  const normalized = body.phoneNumber?.replace(/[\s()-]/g, '') ?? '';
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    return NextResponse.json(
      { error: 'Enter a valid E.164 number, for example +919876543210.' },
      { status: 400 },
    );
  }
  const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
  const verificationId = `verification_${crypto.randomUUID()}`;
  await db.batch([
    db
      .prepare(
        `INSERT INTO phone_numbers
         (id, organization_id, phone_number, country, number_type,
          acquisition_type, public_provider_name, assigned_agent_name,
          direction, kyc_status, status, monthly_rental)
         VALUES (?, ?, ?, 'IN', 'existing', 'bring_your_own', 'Vaani Connect', ?, ?,
          'not_submitted', 'pending_verification', 0)`,
      )
      .bind(
        id,
        auth.session.organizationId,
        normalized,
        body.assignedAgentName?.trim() || null,
        direction,
      ),
    db
      .prepare(
        `INSERT INTO number_verifications
         (id, phone_number_id, code_hash, method, expires_at)
         VALUES (?, ?, ?, 'otp_or_test_call', ?)`,
      )
      .bind(
        verificationId,
        id,
        await sha256(code),
        new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      ),
  ]);
  await recordAudit(auth.session, 'number.connection_started', 'phone_number', id);
  return NextResponse.json(
    {
      number: { id, phoneNumber: normalized, status: 'pending_verification' },
      verificationId,
      demoCode: process.env.NODE_ENV !== 'production' ? code : undefined,
      nextStep:
        'Verify ownership, then complete KYC and run inbound/outbound test calls.',
    },
    { status: 201 },
  );
}
