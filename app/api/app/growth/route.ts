import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import {
  getRun,
  growthBoard,
  listRuns,
  runSiteScan,
  saveDiscovery,
} from '@/lib/growth-service';

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
  const organizationId = auth.session.organizationId!;
  const runId = new URL(request.url).searchParams.get('run');
  if (runId) {
    const run = await getRun(organizationId, runId);
    if (!run)
      return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
    return NextResponse.json({ run });
  }
  const [board, runs] = await Promise.all([
    growthBoard(organizationId),
    listRuns(organizationId),
  ]);
  return NextResponse.json({ ...board, runs });
}

export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'workspace.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const body = (await request.json()) as {
    action?: string;
    answers?: Record<string, string>;
    siteUrl?: string;
  };
  if (body.action === 'scan_site') {
    const site = String(body.siteUrl ?? '').trim();
    if (!site)
      return NextResponse.json(
        { error: 'Enter your website address.' },
        { status: 400 },
      );
    const result = await runSiteScan({
      organizationId: auth.session.organizationId!,
      userId: auth.session.userId,
      siteUrl: site,
    });
    // A refused or unreachable site is a 200 carrying the reason, not a 500:
    // the run happened, it is stored, and the reason is the useful part.
    return NextResponse.json(result);
  }
  if (body.action !== 'save_discovery')
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  const state = await saveDiscovery({
    organizationId: auth.session.organizationId!,
    answers: body.answers ?? {},
  });
  return NextResponse.json({ ok: true, discovery: state });
}
