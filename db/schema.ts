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

export const appUsers = sqliteTable(
  'app_users',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').notNull(),
    status: text('status').notNull().default('active'),
    lastLoginAt: text('last_login_at'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex('idx_app_users_email').on(table.email),
    index('idx_app_users_org_role').on(table.organizationId, table.role),
  ],
);

export const authSessions = sqliteTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => appUsers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex('idx_auth_sessions_token_hash').on(table.tokenHash),
    index('idx_auth_sessions_user').on(table.userId),
  ],
);

export const crmActivities = sqliteTable(
  'crm_activities',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: text('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    subject: text('subject').notNull(),
    notes: text('notes'),
    dueAt: text('due_at'),
    completedAt: text('completed_at'),
    createdBy: text('created_by'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_crm_activities_org_lead').on(
      table.organizationId,
      table.leadId,
    ),
  ],
);

export const phoneNumbers = sqliteTable(
  'phone_numbers',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    phoneNumber: text('phone_number').notNull(),
    country: text('country').notNull().default('IN'),
    numberType: text('number_type').notNull().default('local'),
    acquisitionType: text('acquisition_type').notNull(),
    publicProviderName: text('public_provider_name')
      .notNull()
      .default('Vaani Connect'),
    providerReference: text('provider_reference'),
    assignedAgentName: text('assigned_agent_name'),
    direction: text('direction').notNull().default('inbound_outbound'),
    kycStatus: text('kyc_status').notNull().default('not_submitted'),
    status: text('status').notNull().default('pending_verification'),
    monthlyRental: integer('monthly_rental').notNull().default(0),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex('idx_phone_numbers_number').on(table.phoneNumber),
    index('idx_phone_numbers_org_status').on(
      table.organizationId,
      table.status,
    ),
  ],
);

export const numberVerifications = sqliteTable(
  'number_verifications',
  {
    id: text('id').primaryKey(),
    phoneNumberId: text('phone_number_id')
      .notNull()
      .references(() => phoneNumbers.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    method: text('method').notNull().default('otp'),
    attemptCount: integer('attempt_count').notNull().default(0),
    expiresAt: text('expires_at').notNull(),
    verifiedAt: text('verified_at'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('idx_number_verifications_phone').on(table.phoneNumberId)],
);

export const integrationConnections = sqliteTable(
  'integration_connections',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('needs_configuration'),
    publicConfigJson: text('public_config_json').notNull().default('{}'),
    encryptedSecret: text('encrypted_secret'),
    lastCheckedAt: text('last_checked_at'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex('idx_integration_connections_org_type').on(
      table.organizationId,
      table.type,
    ),
  ],
);

export const apiCredentials = sqliteTable(
  'api_credentials',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    scopesJson: text('scopes_json').notNull().default('[]'),
    lastUsedAt: text('last_used_at'),
    revokedAt: text('revoked_at'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex('idx_api_credentials_key_hash').on(table.keyHash),
    index('idx_api_credentials_org').on(table.organizationId),
  ],
);

export const webhookEndpoints = sqliteTable(
  'webhook_endpoints',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    url: text('url').notNull(),
    secretHash: text('secret_hash').notNull(),
    encryptedSecret: text('encrypted_secret').notNull(),
    eventsJson: text('events_json').notNull().default('[]'),
    status: text('status').notNull().default('active'),
    lastDeliveryAt: text('last_delivery_at'),
    failureCount: integer('failure_count').notNull().default(0),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('idx_webhook_endpoints_org').on(table.organizationId)],
);

export const webhookDeliveries = sqliteTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    endpointId: text('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    statusCode: integer('status_code'),
    attempt: integer('attempt').notNull().default(1),
    responseSnippet: text('response_snippet'),
    deliveredAt: text('delivered_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('idx_webhook_deliveries_endpoint').on(table.endpointId)],
);

export const plans = sqliteTable(
  'plans',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    monthlyPrice: integer('monthly_price').notNull(),
    includedCredits: integer('included_credits').notNull(),
    maxAgents: integer('max_agents').notNull(),
    maxNumbers: integer('max_numbers').notNull(),
    concurrency: integer('concurrency').notNull(),
    featuresJson: text('features_json').notNull().default('[]'),
    status: text('status').notNull().default('active'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex('idx_plans_code').on(table.code)],
);

export const subscriptions = sqliteTable(
  'subscriptions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    planId: text('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('active'),
    externalCustomerId: text('external_customer_id'),
    externalSubscriptionId: text('external_subscription_id'),
    currentPeriodEnd: text('current_period_end'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex('idx_subscriptions_org').on(table.organizationId),
    index('idx_subscriptions_external').on(table.externalSubscriptionId),
  ],
);

export const organizationWallets = sqliteTable('organization_wallets', {
  organizationId: text('organization_id')
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  balance: integer('balance').notNull().default(0),
  lowBalanceThreshold: integer('low_balance_threshold').notNull().default(500),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const creditLedger = sqliteTable(
  'credit_ledger',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    amount: integer('amount').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    referenceType: text('reference_type'),
    referenceId: text('reference_id'),
    description: text('description').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_credit_ledger_org_created').on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

export const invoices = sqliteTable(
  'invoices',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    invoiceNumber: text('invoice_number').notNull(),
    status: text('status').notNull().default('open'),
    lineItemsJson: text('line_items_json').notNull().default('[]'),
    subtotal: integer('subtotal').notNull(),
    tax: integer('tax').notNull().default(0),
    total: integer('total').notNull(),
    currency: text('currency').notNull().default('INR'),
    externalInvoiceId: text('external_invoice_id'),
    hostedUrl: text('hosted_url'),
    issuedAt: text('issued_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    dueAt: text('due_at'),
    paidAt: text('paid_at'),
  },
  (table) => [
    uniqueIndex('idx_invoices_number').on(table.invoiceNumber),
    index('idx_invoices_org_issued').on(table.organizationId, table.issuedAt),
  ],
);

export const billingEvents = sqliteTable(
  'billing_events',
  {
    id: text('id').primaryKey(),
    externalEventId: text('external_event_id').notNull(),
    eventType: text('event_type').notNull(),
    payloadJson: text('payload_json').notNull().default('{}'),
    processedAt: text('processed_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex('idx_billing_events_external').on(table.externalEventId)],
);

export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    actorUserId: text('actor_user_id'),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    metadataJson: text('metadata_json').notNull().default('{}'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_audit_events_org_created').on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

export const onboardingProfiles = sqliteTable('onboarding_profiles', {
  organizationId: text('organization_id')
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  phone: text('phone'),
  useCase: text('use_case').notNull().default('sales'),
  primaryLanguage: text('primary_language').notNull().default('hi-IN'),
  stage: text('stage').notNull().default('agent_test'),
  trialGrantedAt: text('trial_granted_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  completedAt: text('completed_at'),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const voiceAgents = sqliteTable(
  'voice_agents',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    useCase: text('use_case').notNull().default('sales'),
    status: text('status').notNull().default('draft'),
    welcomeMessage: text('welcome_message').notNull(),
    systemPrompt: text('system_prompt').notNull(),
    primaryLanguage: text('primary_language').notNull().default('hi-IN'),
    voiceName: text('voice_name').notNull().default('Vaani Tara'),
    intelligenceProfile: text('intelligence_profile')
      .notNull()
      .default('Vaani Sense Balanced'),
    temperature: integer('temperature').notNull().default(20),
    maxTokens: integer('max_tokens').notNull().default(250),
    endpointingMs: integer('endpointing_ms').notNull().default(250),
    interruptWords: integer('interrupt_words').notNull().default(2),
    toolsJson: text('tools_json').notNull().default('[]'),
    extractionsJson: text('extractions_json').notNull().default('[]'),
    callingConfigJson: text('calling_config_json').notNull().default('{}'),
    costPerMinute: integer('cost_per_minute').notNull().default(55),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_voice_agents_org_status').on(table.organizationId, table.status),
  ],
);

export const agentTestSessions = sqliteTable(
  'agent_test_sessions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => voiceAgents.id, { onDelete: 'cascade' }),
    mode: text('mode').notNull().default('text'),
    status: text('status').notNull().default('active'),
    creditsUsed: integer('credits_used').notNull().default(0),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_agent_test_sessions_org_created').on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

export const agentTestMessages = sqliteTable(
  'agent_test_messages',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => agentTestSessions.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    actionsJson: text('actions_json').notNull().default('[]'),
    latencyMs: integer('latency_ms'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('idx_agent_test_messages_session').on(table.sessionId)],
);

export const paymentLinks = sqliteTable(
  'payment_links',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: text('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    agentId: text('agent_id').references(() => voiceAgents.id, {
      onDelete: 'set null',
    }),
    referenceId: text('reference_id').notNull(),
    customerName: text('customer_name').notNull(),
    customerPhone: text('customer_phone').notNull(),
    customerEmail: text('customer_email'),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull().default('INR'),
    description: text('description').notNull(),
    deliveryMode: text('delivery_mode').notNull().default('instant'),
    scheduledFor: text('scheduled_for'),
    provider: text('provider').notNull().default('razorpay_sandbox'),
    externalPaymentLinkId: text('external_payment_link_id'),
    shortUrl: text('short_url').notNull(),
    status: text('status').notNull().default('created'),
    providerPayloadJson: text('provider_payload_json').notNull().default('{}'),
    paidAt: text('paid_at'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex('idx_payment_links_reference').on(table.referenceId),
    uniqueIndex('idx_payment_links_external').on(table.externalPaymentLinkId),
    index('idx_payment_links_org_created').on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

export const outboundMessages = sqliteTable(
  'outbound_messages',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: text('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    paymentLinkId: text('payment_link_id').references(() => paymentLinks.id, {
      onDelete: 'set null',
    }),
    channel: text('channel').notNull().default('whatsapp'),
    destination: text('destination').notNull(),
    templateName: text('template_name'),
    messageBody: text('message_body').notNull(),
    status: text('status').notNull().default('queued'),
    providerReference: text('provider_reference'),
    errorMessage: text('error_message'),
    scheduledFor: text('scheduled_for'),
    sentAt: text('sent_at'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_outbound_messages_org_created').on(
      table.organizationId,
      table.createdAt,
    ),
    index('idx_outbound_messages_status_scheduled').on(
      table.status,
      table.scheduledFor,
    ),
  ],
);

export const scheduledActions = sqliteTable(
  'scheduled_actions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    leadId: text('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    agentId: text('agent_id').references(() => voiceAgents.id, {
      onDelete: 'set null',
    }),
    type: text('type').notNull(),
    payloadJson: text('payload_json').notNull().default('{}'),
    status: text('status').notNull().default('pending'),
    runAt: text('run_at').notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    lastError: text('last_error'),
    completedAt: text('completed_at'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_scheduled_actions_status_run').on(table.status, table.runAt),
    index('idx_scheduled_actions_org').on(table.organizationId),
  ],
);

export const authProviderSettings = sqliteTable('auth_provider_settings', {
  provider: text('provider').primaryKey(),
  displayName: text('display_name').notNull(),
  buttonVisible: integer('button_visible').notNull().default(1),
  enabled: integer('enabled').notNull().default(0),
  status: text('status').notNull().default('not_configured'),
  publicConfigJson: text('public_config_json').notNull().default('{}'),
  encryptedSecret: text('encrypted_secret'),
  updatedBy: text('updated_by'),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const platformProviders = sqliteTable('platform_providers', {
  id: text('id').primaryKey(),
  internalName: text('internal_name').notNull(),
  publicName: text('public_name').notNull(),
  category: text('category').notNull(),
  requiredCredentialsJson: text('required_credentials_json').notNull().default('[]'),
  status: text('status').notNull().default('required'),
  health: text('health').notNull().default('not_connected'),
  usageNote: text('usage_note').notNull(),
  customerVisible: integer('customer_visible').notNull().default(0),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const organizationSettings = sqliteTable('organization_settings', {
  organizationId: text('organization_id')
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  defaultLanguage: text('default_language').notNull().default('hinglish'),
  enabledLanguagesJson: text('enabled_languages_json').notNull().default('["hi-IN","en-IN","hinglish","haryanvi"]'),
  recordingPolicy: text('recording_policy').notNull().default('record_with_consent'),
  recordingRetentionDays: integer('recording_retention_days').notNull().default(90),
  transcriptRetentionDays: integer('transcript_retention_days').notNull().default(180),
  qaSampleRate: integer('qa_sample_rate').notNull().default(100),
  redactSensitiveData: integer('redact_sensitive_data').notNull().default(1),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const sipTrunks = sqliteTable(
  'sip_trunks',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    provider: text('provider').notNull().default('custom'),
    gatewayUri: text('gateway_uri').notNull(),
    authType: text('auth_type').notNull().default('userpass'),
    encryptedCredentials: text('encrypted_credentials'),
    transport: text('transport').notNull().default('tls'),
    mediaEncryption: text('media_encryption').notNull().default('sdes'),
    codecsJson: text('codecs_json').notNull().default('["PCMU","PCMA"]'),
    status: text('status').notNull().default('testing_required'),
    lastCheckedAt: text('last_checked_at'),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('idx_sip_trunks_org_status').on(table.organizationId, table.status)],
);

export const knowledgeBases = sqliteTable(
  'knowledge_bases',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    language: text('language').notNull().default('multilingual'),
    status: text('status').notNull().default('ready'),
    sourceCount: integer('source_count').notNull().default(0),
    chunkCount: integer('chunk_count').notNull().default(0),
    lastSyncedAt: text('last_synced_at'),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('idx_knowledge_bases_org').on(table.organizationId, table.status)],
);

export const workflows = sqliteTable(
  'workflows',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    triggerType: text('trigger_type').notNull(),
    status: text('status').notNull().default('draft'),
    stepsJson: text('steps_json').notNull().default('[]'),
    runCount: integer('run_count').notNull().default(0),
    failureCount: integer('failure_count').notNull().default(0),
    lastRunAt: text('last_run_at'),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('idx_workflows_org_status').on(table.organizationId, table.status)],
);

export const graphAgents = sqliteTable(
  'graph_agents',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    status: text('status').notNull().default('draft'),
    entryNode: text('entry_node').notNull().default('greeting'),
    graphJson: text('graph_json').notNull().default('{}'),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('idx_graph_agents_org_status').on(table.organizationId, table.status)],
);

export const campaigns = sqliteTable(
  'campaigns',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').references(() => voiceAgents.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    status: text('status').notNull().default('draft'),
    audienceSize: integer('audience_size').notNull().default(0),
    attempted: integer('attempted').notNull().default(0),
    connected: integer('connected').notNull().default(0),
    converted: integer('converted').notNull().default(0),
    concurrency: integer('concurrency').notNull().default(1),
    retryPolicyJson: text('retry_policy_json').notNull().default('{}'),
    callingWindowJson: text('calling_window_json').notNull().default('{}'),
    scheduledFor: text('scheduled_for'),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('idx_campaigns_org_status').on(table.organizationId, table.status)],
);

export const callRecords = sqliteTable(
  'call_records',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').references(() => voiceAgents.id, { onDelete: 'set null' }),
    leadId: text('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    campaignId: text('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    direction: text('direction').notNull(),
    fromNumber: text('from_number').notNull(),
    toNumber: text('to_number').notNull(),
    customerName: text('customer_name'),
    status: text('status').notNull(),
    outcome: text('outcome'),
    durationSeconds: integer('duration_seconds').notNull().default(0),
    latencyMs: integer('latency_ms'),
    sentiment: text('sentiment'),
    summary: text('summary'),
    transcriptJson: text('transcript_json').notNull().default('[]'),
    analysisJson: text('analysis_json').notNull().default('{}'),
    recordingStatus: text('recording_status').notNull().default('not_available'),
    recordingStorageKey: text('recording_storage_key'),
    recordingUrl: text('recording_url'),
    costCredits: integer('cost_credits').notNull().default(0),
    disconnectReason: text('disconnect_reason'),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_call_records_org_started').on(table.organizationId, table.startedAt),
    index('idx_call_records_org_status').on(table.organizationId, table.status),
  ],
);

export const callQualityReviews = sqliteTable(
  'call_quality_reviews',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    callId: text('call_id').notNull().references(() => callRecords.id, { onDelete: 'cascade' }),
    overallScore: integer('overall_score').notNull(),
    resolutionScore: integer('resolution_score').notNull(),
    knowledgeScore: integer('knowledge_score').notNull(),
    naturalnessScore: integer('naturalness_score').notNull(),
    policyScore: integer('policy_score').notNull(),
    hallucinationCount: integer('hallucination_count').notNull().default(0),
    overlapCount: integer('overlap_count').notNull().default(0),
    status: text('status').notNull().default('passed'),
    findingsJson: text('findings_json').notNull().default('[]'),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('idx_call_quality_org_score').on(table.organizationId, table.overallScore)],
);

export const alertRules = sqliteTable(
  'alert_rules',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    metric: text('metric').notNull(),
    comparator: text('comparator').notNull().default('>'),
    threshold: integer('threshold').notNull(),
    windowMinutes: integer('window_minutes').notNull().default(60),
    frequencyMinutes: integer('frequency_minutes').notNull().default(15),
    channelsJson: text('channels_json').notNull().default('["email"]'),
    status: text('status').notNull().default('active'),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('idx_alert_rules_org_status').on(table.organizationId, table.status)],
);

export const alertIncidents = sqliteTable(
  'alert_incidents',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    ruleId: text('rule_id').notNull().references(() => alertRules.id, { onDelete: 'cascade' }),
    currentValue: integer('current_value').notNull(),
    status: text('status').notNull().default('open'),
    triggeredAt: text('triggered_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    resolvedAt: text('resolved_at'),
  },
  (table) => [index('idx_alert_incidents_org_status').on(table.organizationId, table.status)],
);

export const reportDefinitions = sqliteTable(
  'report_definitions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    reportType: text('report_type').notNull(),
    schedule: text('schedule').notNull().default('manual'),
    filtersJson: text('filters_json').notNull().default('{}'),
    status: text('status').notNull().default('active'),
    lastGeneratedAt: text('last_generated_at'),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('idx_reports_org_status').on(table.organizationId, table.status)],
);

export const supportTickets = sqliteTable(
  'support_tickets',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    createdByUserId: text('created_by_user_id').notNull(),
    subject: text('subject').notNull(),
    category: text('category').notNull().default('technical'),
    priority: text('priority').notNull().default('normal'),
    status: text('status').notNull().default('open'),
    assignedTo: text('assigned_to'),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('idx_support_tickets_org_status').on(table.organizationId, table.status)],
);

export const supportTicketMessages = sqliteTable(
  'support_ticket_messages',
  {
    id: text('id').primaryKey(),
    ticketId: text('ticket_id').notNull().references(() => supportTickets.id, { onDelete: 'cascade' }),
    senderRole: text('sender_role').notNull(),
    senderName: text('sender_name').notNull(),
    message: text('message').notNull(),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('idx_ticket_messages_ticket').on(table.ticketId, table.createdAt)],
);
