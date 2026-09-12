import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';
import {
  KYC_DOCUMENT_LABEL,
  KYC_DOCUMENT_TYPES,
  kycProgress,
} from '@/lib/kyc-documents';
import { recordAudit } from '@/lib/demo-seed';
import { sha256 } from '@/lib/security';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import { checkPlanLimit } from '@/lib/plan-limits';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const rows = await getRawDb()
    .prepare(
      `SELECT id, phone_number, country, number_type, acquisition_type,
         public_provider_name, provider_code, connection_mode, provider_account_hint,
         business_use_case, estimated_monthly_minutes, onboarding_status,
         assigned_agent_name, direction, kyc_status, status, monthly_rental, created_at,
         (SELECT count(*) FROM kyc_documents d WHERE d.phone_number_id = phone_numbers.id
            AND d.organization_id = phone_numbers.organization_id) AS kyc_document_count
       FROM phone_numbers WHERE organization_id = ? ORDER BY created_at DESC`,
    )
    .bind(auth.session.organizationId)
    .all();

  // The documents themselves, not just how many there are. A bare count could
  // not say which paperwork had been accepted, which was still waiting, or
  // which had never been sent — so a number sat in "kyc_review" and the only
  // honest thing anyone could say was "some files exist".
  const documents = await getRawDb()
    .prepare(
      `SELECT id, phone_number_id, document_type, status, rejection_reason,
         reviewed_at, created_at
       FROM kyc_documents WHERE organization_id = ?
       ORDER BY created_at DESC`,
    )
    .bind(auth.session.organizationId)
    .all<{
      phone_number_id: string | null;
      document_type: string;
      status: string;
    }>();

  const byNumber = new Map<string, typeof documents.results>();
  for (const document of documents.results ?? []) {
    const key = document.phone_number_id ?? '';
    if (!byNumber.has(key)) byNumber.set(key, []);
    byNumber.get(key)!.push(document);
  }

  return NextResponse.json({
    numbers: (rows.results ?? []).map((number) => {
      const own = byNumber.get(String((number as { id: string }).id)) ?? [];
      return {
        ...number,
        documents: own,
        kycProgress: kycProgress(
          own,
          String(
            (number as { connection_mode?: string }).connection_mode ?? '',
          ),
        ),
      };
    }),
    documentTypes: KYC_DOCUMENT_TYPES.map((type) => ({
      type,
      label: KYC_DOCUMENT_LABEL[type],
    })),
  });
}

export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'telephony.manage');
  if (auth.response) return auth.response;
  const body = (await request.json()) as {
    action?: 'connect';
    phoneNumber?: string;
    assignedAgentName?: string;
    direction?: 'inbound' | 'outbound' | 'inbound_outbound';
    providerCode?: string;
    connectionMode?: 'managed_number' | 'native_import' | 'sip_trunk';
    providerAccountId?: string;
    businessUseCase?: string;
    estimatedMonthlyMinutes?: number;
  };
  // §15: the platform does not resell numbers — a workspace connects its own
  // Twilio/Exotel/Vobiz/SIP account. The old 'rent' action minted a plausible
  // Indian number (+91124498xxxx) that nobody owned and stored it as a real
  // workspace number, so a call to it went nowhere.
  if (body.action !== 'connect') {
    return NextResponse.json(
      {
        error:
          'Connect a number from your own telephony account. Vaani does not sell numbers.',
      },
      { status: 400 },
    );
  }

  const db = getRawDb();
  const id = `number_${crypto.randomUUID()}`;
  const direction = body.direction ?? 'inbound_outbound';
  const supportedProviders = new Set([
    'auto',
    'exotel',
    // The carrier Vaani itself resells. It was missing here, so a workspace on
    // a Vaani-supplied number could not say so and the number fell back to
    // 'auto' — which no adapter reads.
    'vobiz',
    'twilio',
    'sip',
    'plivo',
    'telnyx',
    'vonage',
    'bandwidth',
  ]);
  const providerCode = supportedProviders.has(body.providerCode ?? '')
    ? body.providerCode!
    : 'auto';
  const connectionMode = ['native_import', 'sip_trunk'].includes(
    body.connectionMode ?? '',
  )
    ? body.connectionMode!
    : 'native_import';
  const accountHint = body.providerAccountId?.trim()
    ? `••••${body.providerAccountId.trim().slice(-6)}`
    : null;
  const businessUseCase =
    body.businessUseCase?.trim().slice(0, 160) || 'sales_and_support';
  const estimatedMonthlyMinutes = Math.max(
    0,
    Math.min(10_000_000, Math.round(Number(body.estimatedMonthlyMinutes || 0))),
  );
  const normalized = body.phoneNumber?.replace(/[\s()-]/g, '') ?? '';
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    return NextResponse.json(
      { error: 'Enter a valid E.164 number, for example +919876543210.' },
      { status: 400 },
    );
  }
  // The plan's number limit used to be checked only on the rented path, which
  // no longer exists — a connected number occupies a workspace slot just the
  // same, so removing that branch must not remove the limit with it.
  const limit = await checkPlanLimit(auth.session.organizationId!, 'numbers');
  if (!limit.allowed)
    return NextResponse.json(
      {
        error: limit.message ?? 'Your plan number limit has been reached.',
        limit: limit.limit,
        used: limit.used,
      },
      { status: 409 },
    );
  const code = String(
    100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000),
  );
  const verificationId = `verification_${crypto.randomUUID()}`;
  await db.batch([
    db
      .prepare(
        `INSERT INTO phone_numbers
         (id, organization_id, phone_number, country, number_type,
          acquisition_type, public_provider_name, provider_code, connection_mode,
          provider_account_hint, business_use_case, estimated_monthly_minutes,
          onboarding_status, assigned_agent_name, direction, kyc_status, status, monthly_rental)
         VALUES (?, ?, ?, 'IN', 'existing', 'bring_your_own', 'Vaani Connect', ?, ?, ?, ?, ?,
          'ownership_verification', ?, ?, 'not_submitted', 'pending_verification', 0)`,
      )
      .bind(
        id,
        auth.session.organizationId,
        normalized,
        providerCode,
        connectionMode,
        accountHint,
        businessUseCase,
        estimatedMonthlyMinutes,
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
  await recordAudit(
    auth.session,
    'number.connection_started',
    'phone_number',
    id,
  );
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
