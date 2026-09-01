import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getDb } from '@/db/index';
import { leadForms } from '@/db/schema';
import { ingestLead, normalizeLeadInput } from '@/lib/lead-engine';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ publicKey: string }> },
) {
  try {
    await ensureSchema();
    const { publicKey } = await params;
    const db = getDb();
    const [form] = await db
      .select()
      .from(leadForms)
      .where(eq(leadForms.publicKey, publicKey))
      .limit(1);

    if (!form || form.status !== 'active') {
      return NextResponse.json(
        { error: 'Lead form not found or inactive.' },
        { status: 404, headers: corsHeaders },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const input = normalizeLeadInput({
      ...body,
      sourceType: 'website_form',
      campaignName: body.campaignName ?? form.name,
      externalLeadId: body.externalLeadId ?? `form-${crypto.randomUUID()}`,
    });
    const lead = await ingestLead(form.organizationId, input);

    return NextResponse.json(
      { accepted: true, leadId: lead.id, score: lead.score },
      { status: 201, headers: corsHeaders },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unable to submit form.',
      },
      { status: 400, headers: corsHeaders },
    );
  }
}
