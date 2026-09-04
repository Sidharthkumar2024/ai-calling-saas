import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import { growthBoard, saveDiscovery } from '@/lib/growth-service';

export const dynamic = 'force-dynamic';

/**
 * The AI Business Manager board (§6).
 *
 * Read is `analytics.view`: the observations are the workspace's own numbers.
 * Writing discovery answers is `workspace.manage`, because those answers steer
 * what the agent says and what the growth plan recommends.
 */
export async function GET(request: Request) {
  const auth = await requireCustomerPermission(request, 'analytics.view');
  if (auth.response) return auth.response;
  await ensureSchema();
  return NextResponse.json(await growthBoard(auth.session.organizationId!));
}

export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'workspace.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const body = (await request.json()) as {
    action?: string;
    answers?: Record<string, string>;
  };
  if (body.action !== 'save_discovery')
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  const state = await saveDiscovery({
    organizationId: auth.session.organizationId!,
    answers: body.answers ?? {},
  });
  return NextResponse.json({ ok: true, discovery: state });
}
