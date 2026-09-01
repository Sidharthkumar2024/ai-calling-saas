import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';
import { recordAudit } from '@/lib/demo-seed';
import { createOpaqueToken, sha256 } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const rows = await getRawDb()
    .prepare(
      `SELECT id, name, key_prefix, scopes_json, last_used_at, revoked_at, created_at
       FROM api_credentials WHERE organization_id = ? ORDER BY created_at DESC`,
    )
    .bind(auth.session.organizationId)
    .all();
  return NextResponse.json({ apiKeys: rows.results });
}

export async function POST(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const body = (await request.json()) as { name?: string; scopes?: string[] };
  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'Key name is required.' }, { status: 400 });
  }
  const allowedScopes = new Set(['leads:write', 'leads:read', 'calls:write', 'credits:read']);
  const scopes = (body.scopes ?? ['leads:write', 'credits:read']).filter((scope) =>
    allowedScopes.has(scope),
  );
  const apiKey = createOpaqueToken('vaani_live_');
  const id = `apikey_${crypto.randomUUID()}`;
  await getRawDb()
    .prepare(
      `INSERT INTO api_credentials
       (id, organization_id, name, key_prefix, key_hash, scopes_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      auth.session.organizationId,
      body.name.trim(),
      apiKey.slice(0, 18),
      await sha256(apiKey),
      JSON.stringify(scopes),
    )
    .run();
  await recordAudit(auth.session, 'api_key.created', 'api_key', id, { scopes });
  return NextResponse.json(
    {
      id,
      apiKey,
      warning: 'Copy this key now. Vaani stores only its hash and cannot show it again.',
    },
    { status: 201 },
  );
}

export async function DELETE(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Key id is required.' }, { status: 400 });
  const result = await getRawDb()
    .prepare(
      `UPDATE api_credentials SET revoked_at = CURRENT_TIMESTAMP
       WHERE id = ? AND organization_id = ? AND revoked_at IS NULL`,
    )
    .bind(id, auth.session.organizationId)
    .run();
  if (!result.meta.changes) {
    return NextResponse.json({ error: 'Active API key not found.' }, { status: 404 });
  }
  await recordAudit(auth.session, 'api_key.revoked', 'api_key', id);
  return NextResponse.json({ ok: true });
}
