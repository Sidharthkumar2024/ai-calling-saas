import { NextResponse } from 'next/server';

import { customerUsageRates } from '@/lib/customer-usage-pricing';
import { requireCustomer } from '@/lib/api-session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const rates = await customerUsageRates();

  return NextResponse.json({
    currency: 'credits',
    rates: rates.filter((rate) => rate.status !== 'retired'),
    walletPolicy: {
      holdBeforeSend: true,
      finalizeOnProviderWebhook: true,
      releaseOnFailure: true,
      ledgerBreakdown:
        'Every call, WhatsApp, SMS, email, AI and storage charge is recorded as a separate wallet ledger line.',
    },
  });
}
