import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getDb } from '@/db/index';
import { leadForms } from '@/db/schema';
import { ingestLead, normalizeLeadInput } from '@/lib/lead-engine';
import { enforceRateLimit, requestFingerprint } from '@/lib/rate-limit';
import { collectLeadFields, validateLeadFields } from '@/lib/lead-form-fields';
import { publishedOf } from '@/lib/lead-form-publishing';

export const dynamic = 'force-dynamic';

export async function OPTIONS(
  request: Request,
  { params }: { params: Promise<{ publicKey: string }> },
) {
  const result = await formAndCors(request, (await params).publicKey);
  if (!result) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: result.corsHeaders });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ publicKey: string }> },
) {
  try {
    await ensureSchema();
    const { publicKey } = await params;
    const result = await formAndCors(request, publicKey);
    const form = result?.form;

    if (!form || !result) {
      return NextResponse.json(
        { error: 'Lead form not found or inactive.' },
        { status: 404 },
      );
    }
    const rateLimit = await enforceRateLimit({
      namespace: 'public-form',
      identifier: requestFingerprint(request, publicKey),
      limit: 20,
      windowSeconds: 60 * 60,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many submissions. Try again later.' },
        { status: 429, headers: result.corsHeaders },
      );
    }
    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > 64 * 1024) {
      return NextResponse.json(
        { error: 'Lead form payload is too large.' },
        { status: 413, headers: result.corsHeaders },
      );
    }

    const raw = await request.text();
    if (raw.length > 64 * 1024)
      return NextResponse.json(
        { error: 'Form payload too large.' },
        { status: 413, headers: result.corsHeaders },
      );
    const body = JSON.parse(raw) as Record<string, unknown>;
    let answers;
    // Validated against the published snapshot, which is the form the visitor
    // was actually shown. Checking a submission against a draft nobody has
    // seen would reject the answers to the questions that were asked.
    try {
      answers = collectLeadFields(validateLeadFields(result.live.fields), body);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Invalid form.' },
        { status: 400, headers: result.corsHeaders },
      );
    }
    const custom = Object.entries(answers).filter(
      ([key]) => !['name', 'phone', 'email', 'productInterest'].includes(key),
    );
    const pageUrl =
      typeof body.pageUrl === 'string' ? body.pageUrl.slice(0, 2000) : '';
    const input = normalizeLeadInput({
      ...answers,
      notes: custom.map(([key, value]) => `${key}: ${value}`).join('\n'),
      sourceType: 'website_form',
      campaignName: body.campaignName ?? form.name,
      externalLeadId: body.externalLeadId ?? `form-${crypto.randomUUID()}`,
    });
    input.formContext = {
      formId: form.id,
      version: form.version,
      pageUrl,
      answers,
    };
    const lead = await ingestLead(form.organizationId, input);

    return NextResponse.json(
      { accepted: true, leadId: lead.id, score: lead.score },
      { status: 201, headers: result.corsHeaders },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unable to submit form.',
      },
      { status: 400 },
    );
  }
}

async function formAndCors(request: Request, publicKey: string) {
  await ensureSchema();
  const db = getDb();
  const [form] = await db
    .select()
    .from(leadForms)
    .where(eq(leadForms.publicKey, publicKey))
    .limit(1);
  if (!form) return null;
  const live = publishedOf({
    status: form.status,
    version: form.version,
    fields_json: form.fieldsJson,
    settings_json: form.settingsJson,
    allowed_domains_json: form.allowedDomainsJson,
    published_fields_json: form.publishedFieldsJson,
    published_settings_json: form.publishedSettingsJson,
    published_domains_json: form.publishedDomainsJson,
    published_version: form.publishedVersion,
  });
  if (!live) return null;

  const origin = request.headers.get('origin');
  const allowedDomains = live.domains;
  const allowed =
    !origin ||
    allowedDomains.includes(origin) ||
    (process.env.NODE_ENV !== 'production' &&
      ['http://localhost:3000', 'http://127.0.0.1:3000'].includes(origin));
  if (!allowed) return null;
  return {
    form,
    live,
    corsHeaders: {
      'Access-Control-Allow-Origin': origin ?? 'null',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      Vary: 'Origin',
    },
  };
}
