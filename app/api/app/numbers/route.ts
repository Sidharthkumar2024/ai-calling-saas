import { NextResponse } from 'next/server';
import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import { checkPlanLimit } from '@/lib/plan-limits';
import { recordAudit } from '@/lib/demo-seed';
import { NUMBER_PROVIDERS } from '@/lib/number-connection';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const rows = await getRawDb()
    .prepare(
      `SELECT id, phone_number, country, provider_code, connection_mode, assigned_agent_name, direction, status, onboarding_status FROM phone_numbers WHERE organization_id = ? ORDER BY created_at DESC`,
    )
    .bind(auth.session.organizationId)
    .all();
  return NextResponse.json({ numbers: rows.results ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'telephony.manage');
  if (auth.response) return auth.response;
  const body = (await request.json()) as {
    action?: string;
    phoneNumber?: string;
    providerCode?: string;
    direction?: string;
    connectionMode?: string;
  };
  const provider = NUMBER_PROVIDERS.find((p) => p.id === body.providerCode);
  const phone =
    typeof body.phoneNumber === 'string'
      ? body.phoneNumber.replace(/[\s()-]/g, '')
      : '';
  const direction = body.direction ?? 'inbound_outbound';
  if (
    body.action !== 'connect' ||
    !provider ||
    !/^\+[1-9]\d{7,14}$/.test(phone) ||
    !['inbound', 'outbound', 'inbound_outbound'].includes(direction)
  )
    return NextResponse.json(
      {
        error:
          'Choose a carrier, a valid call direction and an existing E.164 number such as +919876543210.',
      },
      { status: 400 },
    );
  const db = getRawDb();
  const duplicate = await db
    .prepare(
      'SELECT id FROM phone_numbers WHERE organization_id = ? AND phone_number = ? LIMIT 1',
    )
    .bind(auth.session.organizationId, phone)
    .first();
  if (duplicate)
    return NextResponse.json(
      {
        error:
          'This number is already in your customer account. Check its provider connection instead.',
      },
      { status: 409 },
    );
  const limit = await checkPlanLimit(auth.session.organizationId!, 'numbers');
  if (!limit.allowed)
    return NextResponse.json(
      {
        error:
          limit.message || 'Your plan connected-number limit has been reached.',
      },
      { status: 409 },
    );
  const id = `number_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO phone_numbers (id, organization_id, phone_number, country, number_type, acquisition_type, public_provider_name, provider_code, connection_mode, onboarding_status, direction, kyc_status, status, monthly_rental) VALUES (?, ?, ?, ?, 'existing', 'bring_your_own', ?, ?, ?, 'pending_connection', ?, 'provider_managed', 'pending_connection', 0)`,
    )
    .bind(
      id,
      auth.session.organizationId,
      phone,
      phone.startsWith('+91') ? 'IN' : '',
      provider.label,
      provider.id,
      provider.id === 'sip' ? 'sip_trunk' : 'native_import',
      direction,
    )
    .run();
  await recordAudit(
    auth.session,
    'number.connection_started',
    'phone_number',
    id,
  );
  return NextResponse.json(
    {
      number: { id, phoneNumber: phone, status: 'pending_connection' },
      nextStep:
        'Connection saved. Add your carrier credentials in Integrations, check provider ownership, then configure call routing. Your carrier handles number verification and rental.',
    },
    { status: 201 },
  );
}
