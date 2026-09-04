import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { recordAudit } from '@/lib/demo-seed';
import { encryptSecret } from '@/lib/security';
import { testIntegrationConnection } from '@/lib/provider-adapters';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import {
  INTEGRATION_CATALOG,
  INTEGRATION_CATEGORIES,
  INTEGRATION_TYPES,
  catalogEntry,
} from '@/lib/integration-catalog';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // The list carries credential hints and provider config, so it is not
  // readable by every workspace member.
  const auth = await requireCustomerPermission(request, 'integrations.manage');
  if (auth.response) return auth.response;
  const rows = await getRawDb()
    .prepare(
      `SELECT id, type, name, status, public_config_json, last_checked_at, created_at,
         CASE WHEN encrypted_secret IS NULL THEN 0 ELSE 1 END AS has_secret
       FROM integration_connections WHERE organization_id = ? ORDER BY name`,
    )
    .bind(auth.session.organizationId)
    .all<{ type: string; status: string }>();
  const connected = new Map((rows.results ?? []).map((row) => [row.type, row]));
  const catalogIds = new Set(INTEGRATION_CATALOG.map((entry) => entry.id));
  // A stored connection whose type is not in the catalog would otherwise be
  // invisible in the grid while still holding a secret. Surface it instead.
  const unrecognised = (rows.results ?? []).filter(
    (row) => !catalogIds.has(row.type),
  );
  return NextResponse.json({
    integrations: rows.results ?? [],
    unrecognised,
    // The catalog ships with the list so the grid cannot drift out of step
    // with what the API will actually accept.
    catalog: INTEGRATION_CATALOG.map((entry) => ({
      ...entry,
      connection: connected.get(entry.id) ?? null,
    })),
    categories: INTEGRATION_CATEGORIES,
  });
}

export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'integrations.manage');
  if (auth.response) return auth.response;
  const body = (await request.json()) as {
    type?: string;
    name?: string;
    apiKey?: string;
    baseUrl?: string;
    accountId?: string;
    webhookSecret?: string;
    model?: string;
    fromAddress?: string;
  };
  if (!body.type || !INTEGRATION_TYPES.has(body.type)) {
    return NextResponse.json(
      { error: 'Choose a provider from the catalog.' },
      { status: 400 },
    );
  }
  const definition = catalogEntry(body.type)!;
  // Required fields come from the catalog, so a provider that needs an account
  // SID or a base URL cannot be saved half-configured and then fail at runtime.
  const missing = definition.fields
    .filter((field) => field.required)
    .filter((field) => {
      const value = body[field.key];
      return typeof value !== 'string' || !value.trim();
    })
    .map((field) => field.label);
  if (missing.length) {
    return NextResponse.json(
      { error: `${definition.label} needs ${missing.join(', ')}.` },
      { status: 400 },
    );
  }
  if (body.baseUrl) {
    try {
      const parsed = new URL(body.baseUrl);
      if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error();
    } catch {
      return NextResponse.json(
        { error: 'Base URL is invalid.' },
        { status: 400 },
      );
    }
  }

  const id = `integration_${crypto.randomUUID()}`;
  const apiKey = (body.apiKey ?? '').trim();
  const publicConfig = JSON.stringify({
    baseUrl: body.baseUrl?.trim() || null,
    accountId: body.accountId?.trim() || null,
    model: body.model?.trim() || null,
    fromAddress: body.fromAddress?.trim() || null,
    credentialHint: apiKey ? `••••${apiKey.slice(-4)}` : null,
  });
  const encrypted = await encryptSecret(
    JSON.stringify({
      apiKey,
      webhookSecret: body.webhookSecret?.trim() || null,
    }),
  );
  // A provider with no live credential test is stored as 'stored_unverified',
  // never as connected — claiming a verified connection we never checked is
  // exactly the kind of thing this panel must not do.
  const initialStatus = definition.verifiable
    ? 'test_pending'
    : 'stored_unverified';
  await getRawDb()
    .prepare(
      `INSERT INTO integration_connections
       (id, organization_id, type, name, status, public_config_json, encrypted_secret, last_checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (organization_id, type) DO UPDATE SET
         name = excluded.name,
         status = excluded.status,
         public_config_json = excluded.public_config_json,
         encrypted_secret = excluded.encrypted_secret,
         last_checked_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      id,
      auth.session.organizationId,
      body.type,
      body.name?.trim() || definition.label,
      initialStatus,
      publicConfig,
      encrypted,
    )
    .run();
  // The upsert keeps the existing row's id when a provider is reconfigured, so
  // the generated id above may never have been inserted. Read back the real one
  // or a client using the returned id gets "Integration not found".
  const stored = await getRawDb()
    .prepare(
      `SELECT id FROM integration_connections WHERE organization_id = ? AND type = ? LIMIT 1`,
    )
    .bind(auth.session.organizationId, body.type)
    .first<{ id: string }>();
  const connectionId = stored?.id ?? id;
  await recordAudit(
    auth.session,
    'integration.configured',
    'integration',
    connectionId,
    { type: body.type },
  );
  return NextResponse.json({
    id: connectionId,
    status: initialStatus,
    verifiable: definition.verifiable,
    message: definition.verifiable
      ? `${definition.label} credentials stored encrypted. Run the connection test to verify them.`
      : `${definition.label} credentials stored encrypted. This provider has no read-only test endpoint, so it stays unverified until the first real call uses it.`,
  });
}

export async function PATCH(request: Request) {
  const auth = await requireCustomerPermission(request, 'integrations.manage');
  if (auth.response) return auth.response;
  const body = (await request.json()) as { action?: string; id?: string };
  if (body.action !== 'test' || !body.id) {
    return NextResponse.json(
      { error: 'Integration and test action are required.' },
      { status: 400 },
    );
  }
  // A provider with no read-only test must not be marked test_failed for
  // lacking one — that reads as a bad credential.
  const row = await getRawDb()
    .prepare(
      `SELECT type FROM integration_connections WHERE id = ? AND organization_id = ? LIMIT 1`,
    )
    .bind(body.id, auth.session.organizationId)
    .first<{ type: string }>();
  if (!row)
    return NextResponse.json(
      { error: 'Integration not found.' },
      { status: 404 },
    );
  const definition = catalogEntry(row.type);
  if (definition && !definition.verifiable) {
    return NextResponse.json({
      status: 'stored_unverified',
      verifiable: false,
      message: `${definition.label} publishes no read-only endpoint we can safely call, so the credential cannot be verified here. It stays stored encrypted and is proven by the first real call.`,
    });
  }
  try {
    const result = await testIntegrationConnection(
      auth.session.organizationId!,
      body.id,
    );
    await getRawDb()
      .prepare(`UPDATE integration_connections SET status = 'connected', last_checked_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?`)
      .bind(body.id, auth.session.organizationId)
      .run();
    await recordAudit(
      auth.session,
      'integration.test_passed',
      'integration',
      body.id,
    );
    return NextResponse.json({ status: 'connected', result });
  } catch (error) {
    await getRawDb()
      .prepare(`UPDATE integration_connections SET status = 'test_failed', last_checked_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?`)
      .bind(body.id, auth.session.organizationId)
      .run();
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Connection test failed.',
      },
      { status: 502 },
    );
  }
}

/**
 * Disconnect: the credential vault in blueprint §13 requires a way to remove a
 * secret, which this panel never had — a rotated or wrong key could only be
 * overwritten, never withdrawn.
 */
export async function DELETE(request: Request) {
  const auth = await requireCustomerPermission(request, 'integrations.manage');
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') ?? '').trim();
  if (!id)
    return NextResponse.json(
      { error: 'Integration id is required.' },
      { status: 400 },
    );
  const existing = await getRawDb()
    .prepare(
      `SELECT id, type FROM integration_connections WHERE id = ? AND organization_id = ? LIMIT 1`,
    )
    .bind(id, auth.session.organizationId)
    .first<{ id: string; type: string }>();
  if (!existing)
    return NextResponse.json(
      { error: 'Integration not found.' },
      { status: 404 },
    );
  await getRawDb()
    .prepare(
      `DELETE FROM integration_connections WHERE id = ? AND organization_id = ?`,
    )
    .bind(id, auth.session.organizationId)
    .run();
  await recordAudit(
    auth.session,
    'integration.disconnected',
    'integration',
    id,
    { type: existing.type },
  );
  return NextResponse.json({ ok: true, disconnected: existing.type });
}
