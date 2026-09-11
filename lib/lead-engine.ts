import { and, eq } from 'drizzle-orm';

import { getDb } from '@/db/index';
import {
  callJobs,
  leadEvents,
  leads,
  leadSources,
  salesOpportunities,
} from '@/db/schema';

export const leadSourceTypes = [
  'meta_ads',
  'google_ads',
  'website_form',
  // A form filled in inside WhatsApp. Its own source rather than a website
  // form, because "where did this lead come from" is a question the answer to
  // which decides who follows it up and how.
  'whatsapp',
  'manual',
] as const;

export type LeadSourceType = (typeof leadSourceTypes)[number];

export type LeadInput = {
  sourceType: LeadSourceType;
  externalLeadId?: string;
  name: string;
  phone: string;
  email?: string;
  campaignName?: string;
  productInterest?: string;
  notes?: string;
  estimatedValue?: number;
  formContext?: {
    formId: string;
    version: number;
    pageUrl: string;
    answers: Record<string, string>;
  };
};

export function isLeadSourceType(value: unknown): value is LeadSourceType {
  return (
    typeof value === 'string' &&
    leadSourceTypes.includes(value as LeadSourceType)
  );
}

export function normalizeLeadInput(value: unknown): LeadInput {
  if (!value || typeof value !== 'object') {
    throw new Error('Lead payload must be a JSON object.');
  }

  const body = value as Record<string, unknown>;
  if (!isLeadSourceType(body.sourceType)) {
    throw new Error('Unsupported lead source.');
  }
  if (typeof body.name !== 'string' || body.name.trim().length < 2) {
    throw new Error('Lead name is required.');
  }
  if (typeof body.phone !== 'string' || body.phone.trim().length < 8) {
    throw new Error('A valid phone number is required.');
  }

  return {
    sourceType: body.sourceType,
    externalLeadId: optionalString(body.externalLeadId),
    name: body.name.trim(),
    phone: body.phone.trim(),
    email: optionalString(body.email),
    campaignName: optionalString(body.campaignName),
    productInterest: optionalString(body.productInterest),
    notes: optionalString(body.notes),
    estimatedValue:
      typeof body.estimatedValue === 'number' && body.estimatedValue >= 0
        ? Math.round(body.estimatedValue)
        : undefined,
  };
}

export async function ingestLead(organizationId: string, input: LeadInput) {
  const db = getDb();
  const [source] = await db
    .select()
    .from(leadSources)
    .where(
      and(
        eq(leadSources.organizationId, organizationId),
        eq(leadSources.type, input.sourceType),
      ),
    )
    .limit(1);

  if (!source) throw new Error('Lead source is not configured.');

  const analysis = analyzeLead(input);
  if (input.externalLeadId) {
    const [existingLead] = await db
      .select({
        id: leads.id,
        score: leads.score,
        intent: leads.intent,
        status: leads.status,
        capturedAt: leads.capturedAt,
      })
      .from(leads)
      .where(
        and(
          eq(leads.organizationId, organizationId),
          eq(leads.sourceId, source.id),
          eq(leads.externalLeadId, input.externalLeadId),
        ),
      )
      .limit(1);

    if (existingLead) {
      return {
        ...existingLead,
        source: source.name,
        ...input,
        summary: analysis.summary,
        callJobId: null,
        opportunityId: null,
      };
    }
  }

  const leadId = `lead_${crypto.randomUUID()}`;
  const capturedAt = new Date().toISOString();

  await db.insert(leads).values({
    id: leadId,
    organizationId,
    sourceId: source.id,
    externalLeadId: input.externalLeadId,
    name: input.name,
    phone: input.phone,
    email: input.email,
    campaignName: input.campaignName,
    productInterest: input.productInterest,
    notes: input.notes,
    status: analysis.status,
    score: analysis.score,
    intent: analysis.intent,
    aiSummary: analysis.summary,
    capturedAt,
    updatedAt: capturedAt,
  });

  await db.insert(leadEvents).values([
    {
      id: `event_${crypto.randomUUID()}`,
      organizationId,
      leadId,
      eventType: 'lead.captured',
      payloadJson: JSON.stringify({
        source: input.sourceType,
        form: input.formContext,
      }),
      createdAt: capturedAt,
    },
    {
      id: `event_${crypto.randomUUID()}`,
      organizationId,
      leadId,
      eventType: 'lead.ai_qualified',
      payloadJson: JSON.stringify(analysis),
      createdAt: capturedAt,
    },
  ]);

  const callJobId = `calljob_${crypto.randomUUID()}`;
  await db.insert(callJobs).values({
    id: callJobId,
    organizationId,
    leadId,
    status: 'queued',
    scheduledAt: capturedAt,
    summary: `Call ${input.name} about ${input.productInterest ?? 'their enquiry'}. ${analysis.summary}`,
    createdAt: capturedAt,
  });

  let opportunityId: string | null = null;
  if (analysis.score >= 55) {
    opportunityId = `opportunity_${crypto.randomUUID()}`;
    await db.insert(salesOpportunities).values({
      id: opportunityId,
      organizationId,
      leadId,
      stage: analysis.score >= 75 ? 'hot_lead' : 'ai_qualified',
      estimatedValue:
        input.estimatedValue ??
        (input.productInterest?.toLowerCase().includes('property')
          ? 8_500_000
          : 50_000),
      owner: 'AI SDR',
      nextAction:
        analysis.score >= 75
          ? 'Call immediately and offer a booking slot'
          : 'Run AI discovery call and qualify budget',
      createdAt: capturedAt,
      updatedAt: capturedAt,
    });
  }

  return {
    id: leadId,
    source: source.name,
    ...input,
    ...analysis,
    capturedAt,
    callJobId,
    opportunityId,
  };
}

function analyzeLead(input: LeadInput) {
  const text =
    `${input.productInterest ?? ''} ${input.notes ?? ''} ${input.campaignName ?? ''}`.toLowerCase();
  let score = 42;
  if (input.phone) score += 8;
  if (input.email) score += 5;
  if (/price|pricing|budget|cost|loan|emi/.test(text)) score += 14;
  if (/visit|demo|book|appointment|buy|purchase/.test(text)) score += 22;
  if (/today|now|urgent|immediately|this week/.test(text)) score += 9;
  if (input.sourceType === 'meta_ads' || input.sourceType === 'google_ads') {
    score += 4;
  }
  score = Math.min(score, 100);

  const intent = /visit|demo|book|appointment/.test(text)
    ? 'booking_intent'
    : /buy|purchase|price|budget|cost/.test(text)
      ? 'purchase_intent'
      : 'product_enquiry';
  const status = score >= 75 ? 'qualified' : score >= 55 ? 'nurture' : 'new';
  const summary = `AI identified ${intent.replace('_', ' ')} with a ${score}/100 lead score. Start with ${input.productInterest ?? 'the requested product'}, confirm budget and preferred callback time, then ${score >= 75 ? 'offer a booking or human transfer' : 'continue qualification'}.`;

  return { score, intent, status, summary };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
