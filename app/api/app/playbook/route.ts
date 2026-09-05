import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import { recordAudit } from '@/lib/demo-seed';
import {
  latestPlaybook,
  minePlaybook,
  reviewEntry,
} from '@/lib/playbook-service';
import { PLAYBOOK_CAVEAT } from '@/lib/playbook-mining';

export const dynamic = 'force-dynamic';

/**
 * The mined company playbook (§13.1).
 *
 * Reading is `analytics.view`. Mining and reviewing are `agents.manage`,
 * because an approved entry becomes part of what the agent is told on live
 * calls.
 */
export async function GET(request: Request) {
  const auth = await requireCustomerPermission(request, 'analytics.view');
  if (auth.response) return auth.response;
  await ensureSchema();
  return NextResponse.json({
    playbook: await latestPlaybook(auth.session.organizationId!),
    caveat: PLAYBOOK_CAVEAT,
  });
}

export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'agents.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const organizationId = auth.session.organizationId!;
  const body = (await request.json()) as {
    action?: string;
    entryId?: string;
    status?: string;
  };

  if (body.action === 'mine') {
    const result = await minePlaybook({
      organizationId,
      userId: auth.session.userId,
    });
    await recordAudit(
      auth.session,
      'playbook.mined',
      'playbook',
      result.playbookId ?? '',
      {
        callsRead: result.callsRead,
        entries: result.entries,
      },
    );
    // A refusal — no consent, nothing to read — is a 200 carrying the reason.
    return NextResponse.json(result);
  }

  if (body.action === 'review') {
    const status = String(body.status ?? '');
    if (!['approved', 'rejected', 'proposed'].includes(status))
      return NextResponse.json({ error: 'Unknown status.' }, { status: 400 });
    const result = await reviewEntry({
      organizationId,
      entryId: String(body.entryId ?? ''),
      status: status as 'approved' | 'rejected' | 'proposed',
      userId: auth.session.userId,
    });
    if (result.ok)
      await recordAudit(
        auth.session,
        `playbook.${status}`,
        'playbook_entry',
        String(body.entryId),
        {},
      );
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
