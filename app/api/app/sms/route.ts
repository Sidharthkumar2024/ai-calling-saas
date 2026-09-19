import { NextResponse } from 'next/server';

import { requireCustomerPermission } from '@/lib/customer-rbac';
import { sendSmsMessage } from '@/lib/sms-gateway';
import {
  finalizeUsageCredits,
  holdUsageCredits,
  releaseUsageHold,
} from '@/lib/usage-wallet';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'campaigns.manage');
  if (auth.response) return auth.response;
  const body = (await request.json()) as {
    to?: string;
    message?: string;
    referenceId?: string;
  };
  const to = String(body.to ?? '').trim();
  const message = String(body.message ?? '').trim();
  if (!/^\+?[1-9]\d{7,14}$/.test(to)) {
    return NextResponse.json(
      { error: 'Send SMS to an E.164-style phone number.' },
      { status: 400 },
    );
  }
  if (!message || message.length > 1000) {
    return NextResponse.json(
      { error: 'SMS message must be between 1 and 1000 characters.' },
      { status: 400 },
    );
  }

  const organizationId = auth.session.organizationId!;
  const referenceId =
    body.referenceId?.trim().slice(0, 120) || `sms_${crypto.randomUUID()}`;
  const hold = await holdUsageCredits({
    organizationId,
    referenceType: 'sms',
    referenceId,
    rateId: 'sms_message',
    // Keep first version simple: one customer-visible message event. Segment
    // reconciliation can adjust later once the provider reports segment count.
    quantity: 1,
    description: `SMS hold for ${to}`,
  });
  if (hold.status === 'insufficient') {
    return NextResponse.json(
      {
        error: 'Not enough wallet credits to send this SMS.',
        requiredCredits: hold.estimatedCredits,
        balance: hold.balance,
      },
      { status: 402 },
    );
  }

  const result = await sendSmsMessage({
    organizationId,
    to,
    message,
  });
  if (result.status === 'rejected') {
    const released = await releaseUsageHold({
      organizationId,
      referenceType: 'sms',
      referenceId,
      reason: 'SMS provider rejected the message before acceptance.',
    });
    return NextResponse.json(
      {
        status: result.status,
        providerReference: result.providerReference,
        payload: result.payload,
        credits: 0,
        balance: released.balance,
      },
      { status: 502 },
    );
  }
  if (result.status === 'sandbox_delivered') {
    const released = await releaseUsageHold({
      organizationId,
      referenceType: 'sms',
      referenceId,
      reason: 'SMS sandbox delivery did not contact a provider.',
    });
    return NextResponse.json({
      status: result.status,
      providerReference: result.providerReference,
      payload: result.payload,
      credits: 0,
      balance: released.balance,
    });
  }

  const finalized = await finalizeUsageCredits({
    organizationId,
    referenceType: 'sms',
    referenceId,
    rateId: 'sms_message',
    quantity: 1,
    description: `SMS accepted by provider for ${to}`,
  });
  return NextResponse.json({
    status: result.status,
    providerReference: result.providerReference,
    payload: result.payload,
    credits: finalized.finalCredits ?? finalized.estimatedCredits,
    balance: finalized.balance,
  });
}
