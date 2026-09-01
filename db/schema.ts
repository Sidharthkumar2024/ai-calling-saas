import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const organizations = sqliteTable(
  'organizations',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex('idx_organizations_slug').on(table.slug)],
);

export const organizationMembers = sqliteTable(
  'organization_members',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    email: text('email').notNull(),
    role: text('role').notNull().default('user'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex('idx_members_org_user').on(table.organizationId, table.userId),
    index('idx_members_user').on(table.userId),
  ],
);

export const leadSources = sqliteTable(
  'lead_sources',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    name: text('name').notNull(),
    externalAccountId: text('external_account_id'),
    webhookSecret: text('webhook_secret'),
    status: text('status').notNull().default('connected'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex('idx_lead_sources_org_type').on(
      table.organizationId,
      table.type,
    ),
  ],
);

export const leadForms = sqliteTable(
  'lead_forms',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    publicKey: text('public_key').notNull(),
    fieldsJson: text('fields_json').notNull(),
    allowedDomainsJson: text('allowed_domains_json').notNull().default('[]'),
    status: text('status').notNull().default('active'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex('idx_lead_forms_public_key').on(table.publicKey)],
);

export const leads = sqliteTable(
  'leads',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => leadSources.id, { onDelete: 'restrict' }),
    externalLeadId: text('external_lead_id'),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    email: text('email'),
    campaignName: text('campaign_name'),
    productInterest: text('product_interest'),
    notes: text('notes'),
    status: text('status').notNull().default('new'),
    score: integer('score').notNull().default(0),
    intent: text('intent').notNull().default('unknown'),
    aiSummary: text('ai_summary').notNull().default('Awaiting analysis'),
    capturedAt: text('captured_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_leads_org_captured').on(table.organizationId, table.capturedAt),
    index('idx_leads_org_status').on(table.organizationId, table.status),
    index('idx_leads_org_score').on(table.organizationId, table.score),
    uniqueIndex('idx_leads_org_external').on(
      table.organizationId,
      table.sourceId,
      table.externalLeadId,
    ),
  ],
);

export const leadEvents = sqliteTable(
  'lead_events',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: text('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    payloadJson: text('payload_json').notNull().default('{}'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_lead_events_org_lead').on(table.organizationId, table.leadId),
  ],
);

export const callJobs = sqliteTable(
  'call_jobs',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: text('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('queued'),
    scheduledAt: text('scheduled_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    attemptCount: integer('attempt_count').notNull().default(0),
    outcome: text('outcome'),
    summary: text('summary'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_call_jobs_org_status_scheduled').on(
      table.organizationId,
      table.status,
      table.scheduledAt,
    ),
  ],
);

export const salesOpportunities = sqliteTable(
  'sales_opportunities',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: text('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    stage: text('stage').notNull().default('ai_qualified'),
    estimatedValue: integer('estimated_value').notNull().default(0),
    owner: text('owner').notNull().default('AI SDR'),
    nextAction: text('next_action').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_opportunities_org_stage').on(table.organizationId, table.stage),
    uniqueIndex('idx_opportunities_org_lead').on(
      table.organizationId,
      table.leadId,
    ),
  ],
);
