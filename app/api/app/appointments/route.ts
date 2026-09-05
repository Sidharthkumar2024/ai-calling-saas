import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { listAppointments, moveAppointment } from '@/lib/appointment-service';
import { isAppointmentStatus } from '@/lib/appointments';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import { recordAudit } from '@/lib/demo-seed';

export const dynamic = 'force-dynamic';

/**
 * The appointment book.
 *
 * `crm.manage`, because these are commitments made to customers — the same
 * people who work the pipeline keep them.
 */
export async function GET(request: Request) {
  const auth = await requireCustomerPermission(request, 'crm.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  return NextResponse.json(
    await listAppointments(auth.session.organizationId!),
  );
}

export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'crm.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const body = (await request.json()) as {
    appointmentId?: string;
    status?: string;
    note?: string;
  };
  if (!isAppointmentStatus(body.status))
    return NextResponse.json({ error: 'Unknown status.' }, { status: 400 });
  const result = await moveAppointment({
    organizationId: auth.session.organizationId!,
    appointmentId: String(body.appointmentId ?? ''),
    status: body.status,
    note: body.note,
    userId: auth.session.userId,
  });
  if (result.ok)
    await recordAudit(
      auth.session,
      `appointment.${body.status}`,
      'appointment',
      String(body.appointmentId),
      { note: body.note ?? null },
    );
  // A refused move is a 200 with the reason: "a cancelled appointment cannot
  // be completed" is an answer, not a server error.
  return NextResponse.json(result);
}
