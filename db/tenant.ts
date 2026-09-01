import { eq } from 'drizzle-orm';

import type { ChatGPTUser } from '@/app/chatgpt-auth';
import { ensureSchema } from '@/db/bootstrap';
import { getDb } from '@/db/index';
import {
  leadForms,
  leadSources,
  organizationMembers,
  organizations,
} from '@/db/schema';

export type TenantContext = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: 'admin' | 'user';
};

export async function ensureTenant(user: ChatGPTUser): Promise<TenantContext> {
  await ensureSchema();
  const db = getDb();
  const [membership] = await db
    .select({
      organizationId: organizationMembers.organizationId,
      role: organizationMembers.role,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
    })
    .from(organizationMembers)
    .innerJoin(
      organizations,
      eq(organizationMembers.organizationId, organizations.id),
    )
    .where(eq(organizationMembers.userId, user.userId))
    .limit(1);

  if (membership) {
    return {
      organizationId: membership.organizationId,
      organizationName: membership.organizationName,
      organizationSlug: membership.organizationSlug,
      role: membership.role === 'admin' ? 'admin' : 'user',
    };
  }

  const organizationId = `org_${crypto.randomUUID()}`;
  const organizationSlug = `urbannest-${organizationId.slice(-8)}`;
  await db.insert(organizations).values({
    id: organizationId,
    slug: organizationSlug,
    name: 'UrbanNest Realty',
  });
  await db.insert(organizationMembers).values({
    id: `member_${crypto.randomUUID()}`,
    organizationId,
    userId: user.userId,
    email: user.email,
    role: 'admin',
  });

  await db.insert(leadSources).values([
    {
      id: `source_${crypto.randomUUID()}`,
      organizationId,
      type: 'meta_ads',
      name: 'Meta Lead Ads',
      externalAccountId: 'Awaiting OAuth connection',
      webhookSecret: 'vaani-demo-webhook',
      status: 'ready_for_credentials',
    },
    {
      id: `source_${crypto.randomUUID()}`,
      organizationId,
      type: 'google_ads',
      name: 'Google Ads Lead Forms',
      externalAccountId: 'Awaiting OAuth connection',
      webhookSecret: 'vaani-demo-webhook',
      status: 'ready_for_credentials',
    },
    {
      id: `source_${crypto.randomUUID()}`,
      organizationId,
      type: 'website_form',
      name: 'Website Popup Form',
      status: 'connected',
    },
    {
      id: `source_${crypto.randomUUID()}`,
      organizationId,
      type: 'manual',
      name: 'Manual / CSV',
      status: 'connected',
    },
  ]);

  await db.insert(leadForms).values({
    id: `form_${crypto.randomUUID()}`,
    organizationId,
    name: 'Project enquiry popup',
    publicKey: `form_${organizationId.slice(-8)}`,
    fieldsJson: JSON.stringify([
      { key: 'name', label: 'Name', required: true },
      { key: 'phone', label: 'Phone', required: true },
      { key: 'email', label: 'Email', required: false },
      { key: 'productInterest', label: 'Interested in', required: false },
    ]),
    allowedDomainsJson: JSON.stringify(['https://example.com']),
  });

  return {
    organizationId,
    organizationName: 'UrbanNest Realty',
    organizationSlug,
    role: 'admin',
  };
}
