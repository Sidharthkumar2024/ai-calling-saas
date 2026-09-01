import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getDb } from '@/db/index';
import { leadSources, organizations } from '@/db/schema';
import {
  ingestLead,
  normalizeLeadInput,
  type LeadSourceType,
} from '@/lib/lead-engine';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ source: string }> },
) {
  const { source } = await params;
  const url = new URL(request.url);

  if (
    source === 'meta' &&
    url.searchParams.get('hub.mode') === 'subscribe' &&
    url.searchParams.get('hub.verify_token') === 'vaani-demo-webhook'
  ) {
    return new Response(url.searchParams.get('hub.challenge') ?? '', {
      status: 200,
    });
  }

  return NextResponse.json({ error: 'Verification failed.' }, { status: 403 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ source: string }> },
) {
  try {
    await ensureSchema();
    const { source } = await params;
    const sourceType = providerSourceType(source);
    if (!sourceType) {
      return NextResponse.json(
        { error: 'Unsupported provider.' },
        { status: 404 },
      );
    }

    const url = new URL(request.url);
    const workspace = url.searchParams.get('workspace');
    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace is required.' },
        { status: 400 },
      );
    }

    const db = getDb();
    const [connection] = await db
      .select({
        organizationId: organizations.id,
        webhookSecret: leadSources.webhookSecret,
      })
      .from(organizations)
      .innerJoin(
        leadSources,
        and(
          eq(leadSources.organizationId, organizations.id),
          eq(leadSources.type, sourceType),
        ),
      )
      .where(eq(organizations.slug, workspace))
      .limit(1);

    if (!connection) {
      return NextResponse.json(
        { error: 'Integration not configured.' },
        { status: 404 },
      );
    }
    if (
      !connection.webhookSecret ||
      request.headers.get('x-vaani-webhook-secret') !== connection.webhookSecret
    ) {
      return NextResponse.json(
        { error: 'Invalid webhook signature.' },
        { status: 401 },
      );
    }

    const raw = (await request.json()) as Record<string, unknown>;
    const fields = extractProviderFields(raw);
    const input = normalizeLeadInput({
      sourceType,
      externalLeadId:
        stringValue(raw.leadgen_id) ??
        stringValue(raw.gcl_id) ??
        stringValue(raw.id) ??
        crypto.randomUUID(),
      name: fields.full_name ?? fields.name ?? raw.name,
      phone: fields.phone_number ?? fields.phone ?? raw.phone,
      email: fields.email ?? raw.email,
      campaignName:
        fields.campaign_name ?? raw.campaign_name ?? `${source} webhook`,
      productInterest:
        fields.product_interest ?? fields.interest ?? raw.product_interest,
      notes:
        fields.notes ?? raw.notes ?? 'Captured from an advertising lead form.',
    });
    const lead = await ingestLead(connection.organizationId, input);

    return NextResponse.json(
      { accepted: true, leadId: lead.id, score: lead.score },
      { status: 202 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Webhook failed.' },
      { status: 400 },
    );
  }
}

function providerSourceType(source: string): LeadSourceType | null {
  if (source === 'meta') return 'meta_ads';
  if (source === 'google') return 'google_ads';
  return null;
}

function extractProviderFields(body: Record<string, unknown>) {
  const rows = Array.isArray(body.field_data)
    ? body.field_data
    : Array.isArray(body.user_column_data)
      ? body.user_column_data
      : [];

  return rows.reduce<Record<string, unknown>>((result, row) => {
    if (!row || typeof row !== 'object') return result;
    const item = row as Record<string, unknown>;
    const key = stringValue(item.name) ?? stringValue(item.column_name);
    const values = Array.isArray(item.values) ? item.values : [];
    const value =
      stringValue(values[0]) ??
      stringValue(item.string_value) ??
      stringValue(item.value);
    if (key && value) result[key] = value;
    return result;
  }, {});
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
