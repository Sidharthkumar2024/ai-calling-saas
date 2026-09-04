import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { requireCustomer } from '@/lib/api-session';
import {
  acknowledgeNotification,
  listNotifications,
  markRead,
  recordNotification,
} from '@/lib/notification-store';
import { isNotificationEvent } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

/**
 * The notification centre (§3.2).
 *
 * Deliberately behind `requireCustomer` and no further permission: every role
 * needs to be told that a caller is waiting or that a payment failed, and the
 * rows themselves carry nothing a member cannot already see.
 */
export async function GET(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  await ensureSchema();
  return NextResponse.json(
    await listNotifications({
      organizationId: auth.session.organizationId!,
      userId: auth.session.userId,
    }),
  );
}

export async function POST(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  await ensureSchema();
  const body = (await request.json()) as {
    action?: string;
    event?: string;
    title?: string;
    detail?: string;
    subject?: string;
    notificationId?: string;
    scope?: string;
  };
  const organizationId = auth.session.organizationId!;

  if (body.action === 'record') {
    if (!isNotificationEvent(body.event))
      return NextResponse.json(
        { error: 'Unknown notification event.' },
        { status: 400 },
      );
    // `created` is what tells the browser whether to toast. A second tab
    // reporting the same event gets created:false and stays quiet — §3.2's
    // duplicate-toast rule, enforced by the unique index rather than by the
    // tabs trying to agree with each other.
    const result = await recordNotification({
      organizationId,
      event: body.event,
      title: body.title,
      detail: body.detail ?? null,
      subject: body.subject ?? null,
      userId: body.scope === 'workspace' ? null : auth.session.userId,
    });
    return NextResponse.json(result);
  }

  if (body.action === 'mark_read') {
    return NextResponse.json(
      await markRead({
        organizationId,
        userId: auth.session.userId,
        notificationId: body.notificationId ?? null,
      }),
    );
  }

  if (body.action === 'acknowledge') {
    if (!body.notificationId)
      return NextResponse.json(
        { error: 'notificationId is required.' },
        { status: 400 },
      );
    return NextResponse.json(
      await acknowledgeNotification({
        organizationId,
        userId: auth.session.userId,
        notificationId: body.notificationId,
      }),
    );
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
