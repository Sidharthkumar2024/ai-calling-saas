import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import {
  dismissObjection,
  setRebuttal,
  workspaceObjections,
} from '@/lib/sales-intelligence-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireCustomerPermission(request, 'analytics.view');
  if (auth.response) return auth.response;
  await ensureSchema();
  const objections = await workspaceObjections(auth.session.organizationId!);
  return NextResponse.json({
    objections,
    // How many the agent is actually briefed with, which is not the same as how
    // many exist: a one-off with no approved answer is listed here and kept out
    // of the prompt.
    briefed: objections.filter((entry) => entry.rebuttal || entry.count > 1)
      .length,
  });
}

export async function POST(request: Request) {
  // Writing a rebuttal is writing what the agent will say on a live call, so it
  // sits behind the same permission as editing the agent itself, not behind
  // read-only analytics.
  const auth = await requireCustomerPermission(request, 'agents.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const body = (await request.json()) as {
    action?: string;
    objectionId?: string;
    rebuttal?: string;
  };
  const organizationId = auth.session.organizationId!;
  const objectionId = String(body.objectionId ?? '');
  if (!objectionId)
    return NextResponse.json(
      { error: 'objectionId is required.' },
      { status: 400 },
    );

  if (body.action === 'set_rebuttal') {
    const result = await setRebuttal({
      organizationId,
      objectionId,
      rebuttal: String(body.rebuttal ?? ''),
      userId: auth.session.userId,
    });
    return NextResponse.json({ ok: true, ...result });
  }
  if (body.action === 'dismiss') {
    const result = await dismissObjection({ organizationId, objectionId });
    return NextResponse.json({ ok: true, ...result });
  }
  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
