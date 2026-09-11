import { desc, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getDb } from '@/db/index';
import {
  callJobs,
  leadForms,
  leads,
  leadSources,
  salesOpportunities,
} from '@/db/schema';
import { requireCustomer } from '@/lib/api-session';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import { ingestLead, normalizeLeadInput } from '@/lib/lead-engine';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const tenant = {
    organizationId: auth.session.organizationId!,
    organizationName: auth.session.organizationName!,
    organizationSlug: auth.session
      .organizationName!.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-'),
    role: 'admin' as const,
  };
  const db = getDb();
  let leadRows = await loadLeads(tenant.organizationId);

  if (leadRows.length === 0) {
    await seedLeads(tenant.organizationId);
    leadRows = await loadLeads(tenant.organizationId);
  }

  const [forms, connections, [callStats], [opportunityStats]] =
    await Promise.all([
      db
        .select()
        .from(leadForms)
        .where(eq(leadForms.organizationId, tenant.organizationId)),
      db
        .select({
          type: leadSources.type,
          name: leadSources.name,
          status: leadSources.status,
        })
        .from(leadSources)
        .where(eq(leadSources.organizationId, tenant.organizationId)),
      db
        .select({
          queued: sql<number>`sum(case when ${callJobs.status} = 'queued' then 1 else 0 end)`,
          total: sql<number>`count(*)`,
        })
        .from(callJobs)
        .where(eq(callJobs.organizationId, tenant.organizationId)),
      db
        .select({
          total: sql<number>`count(*)`,
          pipelineValue: sql<number>`coalesce(sum(${salesOpportunities.estimatedValue}), 0)`,
        })
        .from(salesOpportunities)
        .where(eq(salesOpportunities.organizationId, tenant.organizationId)),
    ]);

  // Counted over every lead, not over the page.
  //
  // `loadLeads` returns the hundred most recent, which is the right size for a
  // list and the wrong size for a total. "Captured leads — all active sources"
  // was the length of that page, so a workspace with four thousand leads read
  // 100 for ever and every lead after the first hundred was invisible. The
  // same page decided "AI-qualified" and the per-source breakdown underneath.
  const [totals, bySource] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)`,
        qualified: sql<number>`sum(CASE WHEN ${leads.score} >= 75 THEN 1 ELSE 0 END)`,
      })
      .from(leads)
      .where(eq(leads.organizationId, tenant.organizationId)),
    db
      .select({
        sourceType: leadSources.type,
        total: sql<number>`count(*)`,
      })
      .from(leads)
      .innerJoin(leadSources, eq(leads.sourceId, leadSources.id))
      .where(eq(leads.organizationId, tenant.organizationId))
      .groupBy(leadSources.type),
  ]);
  const segments = bySource.reduce<Record<string, number>>((result, row) => {
    result[row.sourceType] = Number(row.total ?? 0);
    return result;
  }, {});

  return NextResponse.json({
    tenant,
    leads: leadRows,
    // The list is the most recent hundred. The totals beside it are not.
    leadsAreAPage: Number(totals[0]?.total ?? 0) > leadRows.length,
    forms: forms.map((form) => ({
      id: form.id,
      name: form.name,
      publicKey: form.publicKey,
      status: form.status,
      embedEndpoint: `/api/forms/${form.publicKey}/leads`,
    })),
    connections: connections.map((connection) => ({
      ...connection,
      webhookEndpoint:
        connection.type === 'meta_ads'
          ? `/api/integrations/meta/leads?workspace=${tenant.organizationSlug}`
          : connection.type === 'google_ads'
            ? `/api/integrations/google/leads?workspace=${tenant.organizationSlug}`
            : null,
    })),
    stats: {
      total: Number(totals[0]?.total ?? 0),
      qualified: Number(totals[0]?.qualified ?? 0),
      queuedCalls: Number(callStats?.queued ?? 0),
      opportunities: Number(opportunityStats?.total ?? 0),
      pipelineValue: Number(opportunityStats?.pipelineValue ?? 0),
      segments,
    },
  });
}

export async function POST(request: Request) {
  // Writing into the pipeline.
  const auth = await requireCustomerPermission(request, 'crm.manage');
  if (auth.response) return auth.response;

  try {
    const input = normalizeLeadInput(await request.json());
    const lead = await ingestLead(auth.session.organizationId!, input);
    return NextResponse.json({ lead }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unable to capture lead.',
      },
      { status: 400 },
    );
  }
}

async function loadLeads(organizationId: string) {
  const db = getDb();
  return db
    .select({
      id: leads.id,
      name: leads.name,
      phone: leads.phone,
      email: leads.email,
      campaignName: leads.campaignName,
      productInterest: leads.productInterest,
      status: leads.status,
      score: leads.score,
      intent: leads.intent,
      aiSummary: leads.aiSummary,
      capturedAt: leads.capturedAt,
      sourceType: leadSources.type,
      sourceName: leadSources.name,
    })
    .from(leads)
    .innerJoin(leadSources, eq(leads.sourceId, leadSources.id))
    .where(eq(leads.organizationId, organizationId))
    .orderBy(desc(leads.capturedAt))
    .limit(100);
}

async function seedLeads(organizationId: string) {
  await Promise.all([
    ingestLead(organizationId, {
      sourceType: 'meta_ads',
      externalLeadId: 'meta-demo-1',
      name: 'Aarav Khanna',
      phone: '+91 98765 44210',
      email: 'aarav@example.com',
      campaignName: 'Gurugram Luxury Homes',
      productInterest: '3BHK property',
      notes: 'Wants pricing and a site visit this week.',
      estimatedValue: 12_000_000,
    }),
    ingestLead(organizationId, {
      sourceType: 'google_ads',
      externalLeadId: 'google-demo-1',
      name: 'Priya Mehta',
      phone: '+91 99672 18184',
      campaignName: 'Noida Ready-to-Move Search',
      productInterest: '2BHK property',
      notes: 'Asked for price, EMI and a callback tomorrow.',
      estimatedValue: 8_500_000,
    }),
    ingestLead(organizationId, {
      sourceType: 'website_form',
      externalLeadId: 'web-demo-1',
      name: 'Rohan Sharma',
      phone: '+91 97110 33090',
      email: 'rohan@example.com',
      campaignName: 'Project page popup',
      productInterest: 'Investment property',
      notes: 'Requested brochure and current offers.',
      estimatedValue: 9_500_000,
    }),
    ingestLead(organizationId, {
      sourceType: 'manual',
      externalLeadId: 'manual-demo-1',
      name: 'Neha Kapoor',
      phone: '+91 88260 77062',
      campaignName: 'Past enquiries',
      productInterest: 'Residential property',
      notes: 'Needs more information before deciding.',
      estimatedValue: 7_200_000,
    }),
  ]);
}
