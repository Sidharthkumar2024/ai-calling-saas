import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import { recordAudit } from '@/lib/demo-seed';
import {
  chooseSource,
  connectorStatuses,
  disconnect,
  listChoices,
  startConnection,
} from '@/lib/growth-connector-service';
import { CONNECTORS, isConnectorId } from '@/lib/growth-connectors';

export const dynamic = 'force-dynamic';

/**
 * Connecting Google Analytics, Search Console and HubSpot (§6).
 *
 * `integrations.manage`, because this binds an outside account to the
 * workspace. Nothing here ever returns a token — only state.
 */
export async function GET(request: Request) {
  const auth = await requireCustomerPermission(request, 'integrations.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const organizationId = auth.session.organizationId!;
  const id = new URL(request.url).searchParams.get('choices');
  if (id) {
    if (!isConnectorId(id))
      return NextResponse.json(
        { error: 'Unknown connector.' },
        { status: 404 },
      );
    return NextResponse.json(await listChoices({ organizationId, id }));
  }
  return NextResponse.json({
    connectors: await connectorStatuses(organizationId),
    catalogue: Object.values(CONNECTORS).map((connector) => ({
      id: connector.id,
      label: connector.label,
      answers: connector.answers,
      selectionLabel: connector.selectionLabel,
      needsSelection: connector.needsSelection,
    })),
  });
}

export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'integrations.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const organizationId = auth.session.organizationId!;
  const body = (await request.json()) as {
    action?: string;
    connector?: string;
    selection?: string;
  };
  const id = body.connector;
  if (!isConnectorId(id))
    return NextResponse.json({ error: 'Unknown connector.' }, { status: 404 });

  if (body.action === 'start') {
    const result = await startConnection({ organizationId, id });
    // A refusal is a 200 carrying the reason: "your platform administrator has
    // not registered the app" is an answer, not a server error.
    return NextResponse.json(result);
  }

  if (body.action === 'choose') {
    const selection = String(body.selection ?? '').trim();
    if (!selection)
      return NextResponse.json({ error: 'Choose one first.' }, { status: 400 });
    const result = await chooseSource({ organizationId, id, selection });
    await recordAudit(
      auth.session,
      'growth.connector_selected',
      'integration',
      id,
      {
        selection,
      },
    );
    return NextResponse.json(result);
  }

  if (body.action === 'disconnect') {
    await disconnect(organizationId, id);
    await recordAudit(
      auth.session,
      'growth.connector_disconnected',
      'integration',
      id,
      {},
    );
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
