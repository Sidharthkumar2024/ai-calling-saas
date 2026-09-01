import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';
import { recordAudit } from '@/lib/demo-seed';
import { createOpaqueToken, encryptSecret, sha256 } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const rows = await getRawDb()
    .prepare(
      `SELECT id, name, url, events_json, status, last_delivery_at,
         failure_count, created_at
       FROM webhook_endpoints WHERE organization_id = ? ORDER BY created_at DESC`,
    )
    .bind(auth.session.organizationId)
    .all();
  return NextResponse.json({ webhooks: rows.results });
}

export async function POST(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const body = (await request.json()) as {
    name?: string;
    url?: string;
    events?: string[];
  };
  if (!body.name?.trim() || !body.url?.trim()) {
    return NextResponse.json({ error: 'Name and endpoint URL are required.' }, { status: 400 });
  }
  try {
    const parsed = new URL(body.url);
    const local = ['localhost', '127.0.0.1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
      throw new Error();
    }
  } catch {
    return NextResponse.json(
      { error: 'Use an HTTPS URL, or HTTP localhost while developing.' },
      { status: 400 },
    );
  }
  const allowedEvents = new Set([
    'lead.created',
    'lead.qualified',
    'call.completed',
    'appointment.booked',
    'credit.low',
  ]);
  const events = (body.events ?? ['lead.qualified', 'call.completed']).filter((event) =>
    allowedEvents.has(event),
  );
  const secret = createOpaqueToken('whsec_');
  const id = `webhook_${crypto.randomUUID()}`;
  await getRawDb()
    .prepare(
      `INSERT INTO webhook_endpoints
       (id, organization_id, name, url, secret_hash, encrypted_secret, events_json, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
    )
    .bind(
      id,
      auth.session.organizationId,
      body.name.trim(),
      body.url.trim(),
      await sha256(secret),
      await encryptSecret(secret),
      JSON.stringify(events),
    )
    .run();
  await recordAudit(auth.session, 'webhook.created', 'webhook', id, { events });
  return NextResponse.json(
    {
      id,
      signingSecret: secret,
      warning: 'Copy this signing secret now. It is encrypted at rest and not shown again.',
    },
    { status: 201 },
  );
}
