import { NextResponse } from 'next/server';
import { requireAdminCapability } from '@/lib/admin-rbac';
import { getRawDb } from '@/db/index';
import { recordAudit } from '@/lib/demo-seed';
import { INCIDENT_STATES, PUBLIC_COMPONENTS } from '@/lib/public-status';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const auth = await requireAdminCapability(request, 'providers.manage');
  if (auth.response) return auth.response;
  const b = (await request.json()) as Record<string, unknown>;
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  const message = typeof b.message === 'string' ? b.message.trim() : '';
  const component = typeof b.component === 'string' ? b.component : '';
  const state = typeof b.state === 'string' ? b.state : '';
  const start =
    typeof b.startsAt === 'string' ? Date.parse(b.startsAt) : Date.now();
  const end =
    typeof b.endsAt === 'string' && b.endsAt ? Date.parse(b.endsAt) : null;
  if (
    !title ||
    title.length > 160 ||
    !message ||
    message.length > 2000 ||
    !INCIDENT_STATES.includes(state as (typeof INCIDENT_STATES)[number]) ||
    !(
      component === 'platform' ||
      PUBLIC_COMPONENTS.some((c) => c.id === component)
    ) ||
    !Number.isFinite(start) ||
    (end !== null && (!Number.isFinite(end) || end <= start)) ||
    (['scheduled', 'maintenance'].includes(state) && end === null)
  )
    return NextResponse.json(
      {
        error:
          'Enter a title, update, component and valid dates. Scheduled maintenance needs an end time.',
      },
      { status: 400 },
    );
  const db = getRawDb();
  const id = typeof b.id === 'string' ? b.id : `status_${crypto.randomUUID()}`;
  if (b.id) {
    const existing = await db
      .prepare('SELECT id FROM public_status_updates WHERE id = ?')
      .bind(id)
      .first();
    if (!existing)
      return NextResponse.json(
        { error: 'Status update not found.' },
        { status: 404 },
      );
    await db
      .prepare(
        `UPDATE public_status_updates SET component=?, title=?, message=?, state=?, starts_at=?, ends_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      )
      .bind(
        component,
        title,
        message,
        state,
        new Date(start).toISOString(),
        end === null ? null : new Date(end).toISOString(),
        id,
      )
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO public_status_updates (id,component,title,message,state,starts_at,ends_at,created_by) VALUES (?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id,
        component,
        title,
        message,
        state,
        new Date(start).toISOString(),
        end === null ? null : new Date(end).toISOString(),
        auth.session.userId,
      )
      .run();
  }
  await recordAudit(auth.session, 'status.published', 'status_update', id, {
    state,
    component,
  });
  return NextResponse.json({ id, published: true });
}
