import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';
import { recordAudit } from '@/lib/demo-seed';
import { sha256 } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  await ensureSchema();
  const db = getRawDb();
  const organizationId = auth.session.organizationId!;
  const [consents, suppressions, kyc] = await Promise.all([
    db
      .prepare(`SELECT id, lead_id, phone, purpose, lawful_basis, status, captured_at, expires_at, revoked_at
      FROM consent_records WHERE organization_id = ? ORDER BY captured_at DESC LIMIT 100`)
      .bind(organizationId)
      .all(),
    db
      .prepare(`SELECT id, scope, reason, source, expires_at, created_at FROM suppression_entries
      WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100`)
      .bind(organizationId)
      .all(),
    db
      .prepare(`SELECT id, phone_number_id, document_type, status, rejection_reason, reviewed_at, created_at
      FROM kyc_documents WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100`)
      .bind(organizationId)
      .all(),
  ]);
  return NextResponse.json({
    consents: consents.results,
    suppressions: suppressions.results,
    kycDocuments: kyc.results,
  });
}

export async function POST(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  await ensureSchema();
  const organizationId = auth.session.organizationId!;
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data'))
    return uploadKyc(request, auth.session);
  const body = (await request.json()) as {
    action?: string;
    phone?: string;
    purpose?: string;
    leadId?: string;
    consentId?: string;
    reason?: string;
    expiresAt?: string;
  };
  const phone = body.phone?.trim().replaceAll(' ', '') || '';
  const db = getRawDb();
  if (body.action === 'grant_consent') {
    if (!/^\+[1-9]\d{7,14}$/.test(phone))
      return NextResponse.json(
        { error: 'A valid E.164 phone is required.' },
        { status: 400 },
      );
    const id = `consent_${crypto.randomUUID()}`;
    await db
      .prepare(`INSERT INTO consent_records
      (id, organization_id, lead_id, phone, purpose, lawful_basis, status, proof_json, expires_at)
      VALUES (?, ?, ?, ?, ?, 'explicit_consent', 'granted', ?, ?)`)
      .bind(
        id,
        organizationId,
        body.leadId || null,
        phone,
        body.purpose?.slice(0, 80) || 'outbound_calling',
        JSON.stringify({
          capturedBy: auth.session.userId,
          channel: 'dashboard',
          ipEvidence: request.headers.get('cf-connecting-ip')
            ? 'captured'
            : 'local',
        }),
        body.expiresAt || null,
      )
      .run();
    await recordAudit(auth.session, 'consent.granted', 'consent', id, {
      phone: `••••${phone.slice(-4)}`,
    });
    return NextResponse.json({ id }, { status: 201 });
  }
  if (body.action === 'revoke_consent') {
    const result = await db
      .prepare(`UPDATE consent_records SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?`)
      .bind(body.consentId, organizationId)
      .run();
    if (!result.meta.changes)
      return NextResponse.json(
        { error: 'Consent record was not found.' },
        { status: 404 },
      );
    return NextResponse.json({ revoked: true });
  }
  if (body.action === 'suppress') {
    if (!/^\+[1-9]\d{7,14}$/.test(phone))
      return NextResponse.json(
        { error: 'A valid E.164 phone is required.' },
        { status: 400 },
      );
    const id = `suppress_${crypto.randomUUID()}`;
    await db
      .prepare(`INSERT INTO suppression_entries
      (id, organization_id, phone_hash, scope, reason, source, expires_at)
      VALUES (?, ?, ?, 'organization', ?, 'customer_request', ?)
      ON CONFLICT(organization_id, scope, phone_hash) DO UPDATE SET reason=excluded.reason,
      expires_at=excluded.expires_at, created_at=CURRENT_TIMESTAMP`)
      .bind(
        id,
        organizationId,
        await sha256(phone),
        body.reason?.slice(0, 160) || 'Do not call request',
        body.expiresAt || null,
      )
      .run();
    await db
      .prepare(`UPDATE consent_records SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP
      WHERE organization_id = ? AND phone = ? AND status = 'granted'`)
      .bind(organizationId, phone)
      .run();
    return NextResponse.json({ id }, { status: 201 });
  }
  return NextResponse.json(
    { error: 'Unsupported compliance action.' },
    { status: 400 },
  );
}

async function uploadKyc(
  request: Request,
  session: Awaited<
    ReturnType<typeof import('@/lib/app-auth').getSessionFromHeaders>
  > & {},
) {
  if (!env.RECORDINGS)
    return NextResponse.json(
      { error: 'Secure document storage is not bound.' },
      { status: 503 },
    );
  const form = await request.formData();
  const file = form.get('file');
  const documentTypeValue = form.get('documentType');
  const phoneNumberValue = form.get('phoneNumberId');
  const documentType = (
    typeof documentTypeValue === 'string'
      ? documentTypeValue
      : 'business_registration'
  ).slice(0, 80);
  const phoneNumberId =
    typeof phoneNumberValue === 'string' && phoneNumberValue
      ? phoneNumberValue
      : null;
  if (!(file instanceof File) || file.size < 1 || file.size > 8 * 1024 * 1024)
    return NextResponse.json(
      { error: 'Upload a PDF/JPEG/PNG file up to 8 MB.' },
      { status: 400 },
    );
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type))
    return NextResponse.json(
      { error: 'Only PDF, JPEG and PNG files are accepted.' },
      { status: 400 },
    );
  const organizationId = session.organizationId!;
  const id = `kyc_${crypto.randomUUID()}`;
  const checksum = await fileChecksum(await file.arrayBuffer());
  const key = `secure/kyc/${organizationId}/${id}/${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  await env.RECORDINGS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { organizationId, documentType },
  });
  const db = getRawDb();
  const statements = [
    db
      .prepare(`INSERT INTO kyc_documents
    (id, organization_id, phone_number_id, document_type, storage_key, checksum, status)
    VALUES (?, ?, ?, ?, ?, ?, 'submitted')`)
      .bind(id, organizationId, phoneNumberId, documentType, key, checksum),
  ];
  if (phoneNumberId) {
    statements.push(
      db
        .prepare(`UPDATE phone_numbers SET kyc_status = 'submitted', status = 'kyc_review',
      onboarding_status = 'provider_review' WHERE id = ? AND organization_id = ?`)
        .bind(phoneNumberId, organizationId),
    );
  }
  await db.batch(statements);
  return NextResponse.json({ id, status: 'submitted' }, { status: 201 });
}

async function fileChecksum(value: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', value);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
