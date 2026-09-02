import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { authenticateApiKey } from '@/lib/api-key-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticateApiKey(request, 'credits:read');
  if (!auth) {
    return NextResponse.json(
      { error: 'Valid API key with credits:read is required.' },
      { status: 401 },
    );
  }
  const wallet = await getRawDb()
    .prepare(
      `SELECT balance, low_balance_threshold, updated_at
       FROM organization_wallets WHERE organization_id = ?`,
    )
    .bind(auth.organizationId)
    .first();
  return NextResponse.json({
    data: wallet ?? { balance: 0, low_balance_threshold: 0 },
  });
}
