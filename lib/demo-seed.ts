import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { ingestLead } from '@/lib/lead-engine';

/**
 * The one workspace these leads belong in.
 *
 * The name said demo and the behaviour said "any workspace with no leads yet",
 * which is every workspace on its first day. Two things followed from that.
 *
 * A real customer's pipeline was seeded with three invented people — Aarav
 * Khanna, Priya Mehta, Kabir Bansal — carrying plausible Indian mobile
 * numbers, in a product whose whole purpose is to ring the numbers in its
 * pipeline.
 *
 * And it did not even get that far: signup creates only the `manual` and
 * `website_form` lead sources, while these leads arrive as `meta_ads` and
 * `google_ads`, so `ingestLead` threw "Lead source is not configured." That
 * throw was unhandled on `/api/app/overview` — the first screen a new signup
 * lands on — which answered 500 with an empty body for every account ever
 * created.
 */
const DEMO_ORGANIZATION_ID = 'org_vaani_demo';

export async function ensureDemoLeads(organizationId: string) {
  if (organizationId !== DEMO_ORGANIZATION_ID) return;
  await ensureSchema();
  const db = getRawDb();
  const existing = await db
    .prepare('SELECT count(*) AS total FROM leads WHERE organization_id = ?')
    .bind(organizationId)
    .first<{ total: number }>();
  if (Number(existing?.total ?? 0) > 0) return;

  const demoLeads = [
    {
      sourceType: 'meta_ads' as const,
      externalLeadId: 'meta-demo-1',
      name: 'Aarav Khanna',
      phone: '+91 98765 44210',
      email: 'aarav@example.com',
      campaignName: 'SaaS consultation demo',
      productInterest: 'Custom SaaS portal',
      notes: 'Demo lead asking about a customer portal and delivery timeline.',
      estimatedValue: 350_000,
    },
    {
      sourceType: 'google_ads' as const,
      externalLeadId: 'google-demo-1',
      name: 'Priya Mehta',
      phone: '+91 99672 18184',
      email: 'priya@example.com',
      campaignName: 'CRM automation demo',
      productInterest: 'CRM and lead automation',
      notes: 'Demo lead asked for integration scope and a callback tomorrow.',
      estimatedValue: 180_000,
    },
    {
      sourceType: 'website_form' as const,
      externalLeadId: 'web-demo-1',
      name: 'Rohan Sharma',
      phone: '+91 97110 33090',
      email: 'rohan@example.com',
      campaignName: 'Services website popup',
      productInterest: 'Website and digital marketing',
      notes: 'Demo lead requested a discovery call and portfolio overview.',
      estimatedValue: 120_000,
    },
    {
      sourceType: 'manual' as const,
      externalLeadId: 'manual-demo-1',
      name: 'Neha Kapoor',
      phone: '+91 88260 77062',
      email: 'neha@example.com',
      campaignName: 'Past enquiries',
      productInterest: 'AI calling workflow',
      notes: 'Demo lead needs more information before deciding.',
      estimatedValue: 240_000,
    },
    {
      sourceType: 'meta_ads' as const,
      externalLeadId: 'meta-demo-2',
      name: 'Kabir Bansal',
      phone: '+91 98111 44770',
      email: 'kabir@example.com',
      campaignName: 'E-commerce automation demo',
      productInterest: 'E-commerce and payment integration',
      notes: 'Demo lead wants to book a technical discovery call.',
      estimatedValue: 210_000,
    },
  ];

  for (const input of demoLeads) {
    // Even in the demo workspace, a missing lead source is not a reason to
    // take a screen down. Seeding is a convenience; the page is the product.
    let result: Awaited<ReturnType<typeof ingestLead>>;
    try {
      result = await ingestLead(organizationId, input);
    } catch {
      continue;
    }
    await db
      .prepare(
        `INSERT OR IGNORE INTO crm_activities
         (id, organization_id, lead_id, type, subject, notes, due_at, created_by)
         VALUES (?, ?, ?, 'ai_call', ?, ?, ?, 'Vaani Sara')`,
      )
      .bind(
        `activity_${crypto.randomUUID()}`,
        organizationId,
        result.id,
        `${input.name} qualification call queued`,
        result.summary,
        new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      )
      .run();
  }
}

export async function recordAudit(
  session: {
    userId: string;
    organizationId: string | null;
  },
  action: string,
  targetType: string,
  targetId?: string,
  metadata: Record<string, unknown> = {},
) {
  await ensureSchema();
  await getRawDb()
    .prepare(
      `INSERT INTO audit_events
       (id, organization_id, actor_user_id, action, target_type, target_id, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `audit_${crypto.randomUUID()}`,
      session.organizationId,
      session.userId,
      action,
      targetType,
      targetId ?? null,
      JSON.stringify(metadata),
    )
    .run();
}
