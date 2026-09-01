import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';
import { recordAudit } from '@/lib/demo-seed';
import { encryptSecret } from '@/lib/security';
import { testIntegrationConnection } from '@/lib/provider-adapters';

export const dynamic = 'force-dynamic';

const supportedTypes = new Set([
  'meta_ads',
  'google_ads',
  'crm',
  'telephony_byoc',
  'telephony_exotel',
  'telephony_plivo',
  'telephony_twilio',
  'telephony_vobiz',
  'willow_custom',
  'custom_http',
  'sarvam_voice',
  'anthropic_reasoning',
  'razorpay',
  'whatsapp_cloud',
  'hubspot',
  'salesforce',
  'calcom',
  'zapier',
  'make',
  'n8n',
  'google_sheets',
  'aisensy',
  'shopify',
]);

export async function GET(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const rows = await getRawDb()
    .prepare(
      `SELECT id, type, name, status, public_config_json, last_checked_at, created_at,
         CASE WHEN encrypted_secret IS NULL THEN 0 ELSE 1 END AS has_secret
       FROM integration_connections WHERE organization_id = ? ORDER BY name`,
    )
    .bind(auth.session.organizationId)
    .all();
  return NextResponse.json({ integrations: rows.results });
}

export async function POST(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const body = (await request.json()) as {
    type?: string;
    name?: string;
    apiKey?: string;
    baseUrl?: string;
    accountId?: string;
    webhookSecret?: string;
  };
  if (!body.type || !supportedTypes.has(body.type) || !body.name?.trim()) {
    return NextResponse.json({ error: 'Supported type and name are required.' }, { status: 400 });
  }
  if (!body.apiKey?.trim()) {
    return NextResponse.json({ error: 'API key or access token is required.' }, { status: 400 });
  }
  if (body.baseUrl) {
    try {
      const parsed = new URL(body.baseUrl);
      if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error();
    } catch {
      return NextResponse.json({ error: 'Base URL is invalid.' }, { status: 400 });
    }
  }

  const id = `integration_${crypto.randomUUID()}`;
  const publicConfig = JSON.stringify({
    baseUrl: body.baseUrl?.trim() || null,
    accountId: body.accountId?.trim() || null,
    credentialHint: `••••${body.apiKey.slice(-4)}`,
  });
  const encrypted = await encryptSecret(JSON.stringify({
    apiKey: body.apiKey.trim(),
    webhookSecret: body.webhookSecret?.trim() || null,
  }));
  await getRawDb()
    .prepare(
      `INSERT INTO integration_connections
       (id, organization_id, type, name, status, public_config_json, encrypted_secret, last_checked_at)
       VALUES (?, ?, ?, ?, 'test_pending', ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (organization_id, type) DO UPDATE SET
         name = excluded.name,
         status = 'test_pending',
         public_config_json = excluded.public_config_json,
         encrypted_secret = excluded.encrypted_secret,
         last_checked_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      id,
      auth.session.organizationId,
      body.type,
      body.name.trim(),
      publicConfig,
      encrypted,
    )
    .run();
  await recordAudit(auth.session, 'integration.configured', 'integration', id, {
    type: body.type,
  });
  return NextResponse.json({
    id,
    status: 'test_pending',
    message:
      body.type === 'willow_custom'
        ? 'Credentials stored encrypted. Connection test stays pending until the official calling API base URL and auth contract are confirmed.'
        : 'Credentials stored encrypted. Run the provider connection test next.',
  });
}

export async function PATCH(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const body = await request.json() as { action?: string; id?: string };
  if (body.action !== 'test' || !body.id) {
    return NextResponse.json({ error: 'Integration and test action are required.' }, { status: 400 });
  }
  try {
    const result = await testIntegrationConnection(auth.session.organizationId!, body.id);
    await getRawDb().prepare(`UPDATE integration_connections SET status = 'connected', last_checked_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?`).bind(body.id, auth.session.organizationId).run();
    await recordAudit(auth.session, 'integration.test_passed', 'integration', body.id);
    return NextResponse.json({ status: 'connected', result });
  } catch (error) {
    await getRawDb().prepare(`UPDATE integration_connections SET status = 'test_failed', last_checked_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?`).bind(body.id, auth.session.organizationId).run();
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Connection test failed.' }, { status: 502 });
  }
}
