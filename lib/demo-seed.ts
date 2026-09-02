import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { ingestLead } from '@/lib/lead-engine';

export async function ensureDemoLeads(organizationId: string) {
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
      campaignName: 'Gurugram Luxury Homes',
      productInterest: '3BHK property',
      notes: 'Wants pricing and a site visit this week.',
      estimatedValue: 12_000_000,
    },
    {
      sourceType: 'google_ads' as const,
      externalLeadId: 'google-demo-1',
      name: 'Priya Mehta',
      phone: '+91 99672 18184',
      email: 'priya@example.com',
      campaignName: 'Noida Ready-to-Move Search',
      productInterest: '2BHK property',
      notes: 'Asked for price, EMI and a callback tomorrow.',
      estimatedValue: 8_500_000,
    },
    {
      sourceType: 'website_form' as const,
      externalLeadId: 'web-demo-1',
      name: 'Rohan Sharma',
      phone: '+91 97110 33090',
      email: 'rohan@example.com',
      campaignName: 'Project page popup',
      productInterest: 'Investment property',
      notes: 'Requested brochure and current offers.',
      estimatedValue: 9_500_000,
    },
    {
      sourceType: 'manual' as const,
      externalLeadId: 'manual-demo-1',
      name: 'Neha Kapoor',
      phone: '+91 88260 77062',
      email: 'neha@example.com',
      campaignName: 'Past enquiries',
      productInterest: 'Residential property',
      notes: 'Needs more information before deciding.',
      estimatedValue: 7_200_000,
    },
    {
      sourceType: 'meta_ads' as const,
      externalLeadId: 'meta-demo-2',
      name: 'Kabir Bansal',
      phone: '+91 98111 44770',
      email: 'kabir@example.com',
      campaignName: 'Weekend Open House',
      productInterest: 'Villa property',
      notes: 'Urgent: wants to book a visit today and has budget approved.',
      estimatedValue: 18_500_000,
    },
  ];

  for (const input of demoLeads) {
    const result = await ingestLead(organizationId, input);
    await db
      .prepare(
        `INSERT OR IGNORE INTO crm_activities
         (id, organization_id, lead_id, type, subject, notes, due_at, created_by)
         VALUES (?, ?, ?, 'ai_call', ?, ?, ?, 'Vaani Ira')`,
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
