import { getRawDb } from './index';
import { CUSTOMER_USAGE_RATES } from '@/lib/customer-usage-pricing';
import { SEED_RATE_CARDS } from '@/lib/rate-cards';
import { publishCommercialCatalog } from '@/lib/publish-commercial-catalog';
import { removeLegacyCustomerPlatformIntegrations } from './platform-provider-ownership-migration';

let bootstrapPromise: Promise<void> | null = null;
const SCHEMA_BOOTSTRAP_VERSION = 2;

export function ensureSchema(): Promise<void> {
  bootstrapPromise ??= bootstrapOnce();
  return bootstrapPromise;
}

/**
 * Sites applies the checked-in Drizzle migrations before the Worker starts.
 * Replaying the full legacy bootstrap (hundreds of DDL/seed statements) on the
 * first request of every new stateless isolate can exceed the Worker request
 * deadline.  Use a late-schema sentinel to keep production requests fast,
 * while retaining the bootstrap as a fallback for genuinely empty/local D1
 * databases.
 */
async function bootstrapOnce() {
  const db = getRawDb();
  try {
    // A concrete completion marker is safer than probing any business table:
    // an interrupted bootstrap may have created that table but not the later
    // columns, indexes or catalog rows.
    const marker = await db
      .prepare(
        "SELECT version FROM schema_bootstrap_state WHERE id = 'primary' LIMIT 1",
      )
      .first<{ version: number }>();
    if (!marker || Number(marker.version) < 1)
      throw new Error('Bootstrap incomplete');
    // Existing installations also need newly introduced provider rows. Keep
    // this idempotent catalog refresh outside the full schema replay.
    await seedPlatformReferenceCatalog(db);
    if (Number(marker.version) < SCHEMA_BOOTSTRAP_VERSION) {
      await removeLegacyCustomerPlatformIntegrations(db);
      await db
        .prepare(
          `UPDATE schema_bootstrap_state
           SET version = ?, completed_at = CURRENT_TIMESTAMP
           WHERE id = 'primary'`,
        )
        .bind(SCHEMA_BOOTSTRAP_VERSION)
        .run();
    }
    return;
  } catch {
    await bootstrap();
  }
}

async function bootstrap() {
  const db = getRawDb();

  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY NOT NULL,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_slug
      ON organizations (slug)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS organization_members (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT DEFAULT 'agent' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_members_org_user
      ON organization_members (organization_id, user_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_members_user
      ON organization_members (user_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS lead_sources (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      external_account_id TEXT,
      webhook_secret TEXT,
      status TEXT DEFAULT 'connected' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_sources_org_type
      ON lead_sources (organization_id, type)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS lead_forms (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      public_key TEXT NOT NULL,
      fields_json TEXT NOT NULL,
      allowed_domains_json TEXT DEFAULT '[]' NOT NULL,
      settings_json TEXT DEFAULT '{}' NOT NULL,
      status TEXT DEFAULT 'draft' NOT NULL,
      version INTEGER DEFAULT 1 NOT NULL,
      published_at TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_forms_public_key
      ON lead_forms (public_key)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL REFERENCES lead_sources(id) ON DELETE RESTRICT,
      external_lead_id TEXT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      campaign_name TEXT,
      product_interest TEXT,
      notes TEXT,
      status TEXT DEFAULT 'new' NOT NULL,
      score INTEGER DEFAULT 0 NOT NULL,
      intent TEXT DEFAULT 'unknown' NOT NULL,
      ai_summary TEXT DEFAULT 'Awaiting analysis' NOT NULL,
      captured_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_leads_org_captured
      ON leads (organization_id, captured_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_leads_org_status
      ON leads (organization_id, status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_leads_org_score
      ON leads (organization_id, score)`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_org_external
      ON leads (organization_id, source_id, external_lead_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS lead_events (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      payload_json TEXT DEFAULT '{}' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_lead_events_org_lead
      ON lead_events (organization_id, lead_id)`),
    // Superseded. Nothing has ever inserted a row here; the real call log is
    // `call_records` and the real outbound queue is `campaign_contacts`. Kept
    // as DDL only so an existing database is not surprised by its absence.
    db.prepare(`CREATE TABLE IF NOT EXISTS call_jobs (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      status TEXT DEFAULT 'queued' NOT NULL,
      scheduled_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      attempt_count INTEGER DEFAULT 0 NOT NULL,
      outcome TEXT,
      summary TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_call_jobs_org_status_scheduled
      ON call_jobs (organization_id, status, scheduled_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_opportunities (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      stage TEXT DEFAULT 'ai_qualified' NOT NULL,
      estimated_value INTEGER DEFAULT 0 NOT NULL,
      owner TEXT DEFAULT 'AI SDR' NOT NULL,
      next_action TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_opportunities_org_stage
      ON sales_opportunities (organization_id, stage)`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunities_org_lead
      ON sales_opportunities (organization_id, lead_id)`),
  ]);

  await ensureColumn(
    db,
    'lead_forms',
    'settings_json',
    "TEXT DEFAULT '{}' NOT NULL",
  );
  await ensureColumn(db, 'lead_forms', 'version', 'INTEGER DEFAULT 1 NOT NULL');
  await ensureColumn(db, 'lead_forms', 'published_at', 'TEXT');
  await ensureColumn(
    db,
    'lead_forms',
    'updated_at',
    "TEXT DEFAULT '' NOT NULL",
  );

  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS app_users (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      last_login_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email ON app_users (email)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_app_users_org_role ON app_users (organization_id, role)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sessions_token_hash ON auth_sessions (token_hash)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions (user_id)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS crm_activities (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      subject TEXT NOT NULL,
      notes TEXT,
      due_at TEXT,
      completed_at TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_crm_activities_org_lead ON crm_activities (organization_id, lead_id)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS phone_numbers (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      phone_number TEXT NOT NULL,
      country TEXT DEFAULT 'IN' NOT NULL,
      number_type TEXT DEFAULT 'local' NOT NULL,
      acquisition_type TEXT NOT NULL,
      public_provider_name TEXT DEFAULT 'Vaani Connect' NOT NULL,
      provider_reference TEXT,
      provider_code TEXT DEFAULT 'auto' NOT NULL,
      connection_mode TEXT DEFAULT 'managed_number' NOT NULL,
      provider_account_hint TEXT,
      business_use_case TEXT,
      estimated_monthly_minutes INTEGER DEFAULT 0 NOT NULL,
      onboarding_status TEXT DEFAULT 'draft' NOT NULL,
      assigned_agent_name TEXT,
      direction TEXT DEFAULT 'inbound_outbound' NOT NULL,
      kyc_status TEXT DEFAULT 'not_submitted' NOT NULL,
      status TEXT DEFAULT 'pending_verification' NOT NULL,
      monthly_rental INTEGER DEFAULT 0 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_phone_numbers_number ON phone_numbers (phone_number)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_phone_numbers_org_status ON phone_numbers (organization_id, status)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS number_verifications (
      id TEXT PRIMARY KEY NOT NULL,
      phone_number_id TEXT NOT NULL REFERENCES phone_numbers(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      method TEXT DEFAULT 'otp' NOT NULL,
      attempt_count INTEGER DEFAULT 0 NOT NULL,
      expires_at TEXT NOT NULL,
      verified_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_number_verifications_phone ON number_verifications (phone_number_id)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS integration_connections (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'needs_configuration' NOT NULL,
      public_config_json TEXT DEFAULT '{}' NOT NULL,
      encrypted_secret TEXT,
      last_checked_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_connections_org_type ON integration_connections (organization_id, type)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS api_credentials (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      scopes_json TEXT DEFAULT '[]' NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_api_credentials_key_hash ON api_credentials (key_hash)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_api_credentials_org ON api_credentials (organization_id)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS webhook_endpoints (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      secret_hash TEXT NOT NULL,
      encrypted_secret TEXT NOT NULL,
      events_json TEXT DEFAULT '[]' NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      last_delivery_at TEXT,
      failure_count INTEGER DEFAULT 0 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_org ON webhook_endpoints (organization_id)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY NOT NULL,
      endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      status_code INTEGER,
      attempt INTEGER DEFAULT 1 NOT NULL,
      response_snippet TEXT,
      delivered_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint ON webhook_deliveries (endpoint_id)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      monthly_price INTEGER NOT NULL,
      included_credits INTEGER NOT NULL,
      max_agents INTEGER NOT NULL,
      max_numbers INTEGER NOT NULL,
      concurrency INTEGER NOT NULL,
      features_json TEXT DEFAULT '[]' NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_code ON plans (code)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS credit_packages (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      credits INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
      status TEXT DEFAULT 'active' NOT NULL,
      external_customer_id TEXT,
      external_subscription_id TEXT,
      current_period_end TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_org ON subscriptions (organization_id)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_subscriptions_external ON subscriptions (external_subscription_id)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS organization_wallets (
      organization_id TEXT PRIMARY KEY NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      balance INTEGER DEFAULT 0 NOT NULL,
      low_balance_threshold INTEGER DEFAULT 500 NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS credit_ledger (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      reference_type TEXT,
      reference_id TEXT,
      description TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_credit_ledger_org_created ON credit_ledger (organization_id, created_at)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS customer_usage_rates (
      id TEXT PRIMARY KEY NOT NULL,
      category TEXT NOT NULL,
      operation TEXT NOT NULL,
      label TEXT NOT NULL,
      unit TEXT NOT NULL,
      credits INTEGER NOT NULL,
      cost_basis TEXT NOT NULL,
      customer_note TEXT NOT NULL,
      margin_note TEXT NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      updated_by TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_customer_usage_rates_category ON customer_usage_rates (category, status)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      invoice_number TEXT NOT NULL,
      status TEXT DEFAULT 'open' NOT NULL,
      line_items_json TEXT DEFAULT '[]' NOT NULL,
      subtotal INTEGER NOT NULL,
      tax INTEGER DEFAULT 0 NOT NULL,
      total INTEGER NOT NULL,
      currency TEXT DEFAULT 'INR' NOT NULL,
      external_invoice_id TEXT,
      hosted_url TEXT,
      issued_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      due_at TEXT,
      paid_at TEXT
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number ON invoices (invoice_number)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_invoices_org_issued ON invoices (organization_id, issued_at)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS billing_events (
      id TEXT PRIMARY KEY NOT NULL,
      external_event_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT DEFAULT '{}' NOT NULL,
      processed_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_events_external ON billing_events (external_event_id)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
      actor_user_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      metadata_json TEXT DEFAULT '{}' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_audit_events_org_created ON audit_events (organization_id, created_at)`,
    ),
  ]);

  await ensureColumn(
    db,
    'phone_numbers',
    'provider_code',
    "TEXT DEFAULT 'auto' NOT NULL",
  );
  await ensureColumn(
    db,
    'phone_numbers',
    'connection_mode',
    "TEXT DEFAULT 'managed_number' NOT NULL",
  );
  await ensureColumn(db, 'phone_numbers', 'provider_account_hint', 'TEXT');
  await ensureColumn(db, 'phone_numbers', 'business_use_case', 'TEXT');
  await ensureColumn(
    db,
    'phone_numbers',
    'estimated_monthly_minutes',
    'INTEGER DEFAULT 0 NOT NULL',
  );
  await ensureColumn(
    db,
    'phone_numbers',
    'onboarding_status',
    "TEXT DEFAULT 'draft' NOT NULL",
  );
  await db
    .prepare(`UPDATE phone_numbers SET onboarding_status = 'active'
    WHERE kyc_status = 'approved' AND status = 'active' AND onboarding_status = 'draft'`)
    .run();
  await db
    .prepare(`UPDATE phone_numbers SET connection_mode = 'native_import'
    WHERE acquisition_type = 'bring_your_own' AND connection_mode = 'managed_number'`)
    .run();

  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS onboarding_profiles (
      organization_id TEXT PRIMARY KEY NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      phone TEXT,
      use_case TEXT DEFAULT 'sales' NOT NULL,
      primary_language TEXT DEFAULT 'hi-IN' NOT NULL,
      /* Superseded. Written once at signup and never advanced, so it could
         only ever say 'agent_test'. What onboarding has reached is derived
         from evidence in lib/onboarding.ts; nothing reads this. */
      stage TEXT DEFAULT 'agent_test' NOT NULL,
      trial_granted_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      completed_at TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS voice_agents (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      use_case TEXT DEFAULT 'sales' NOT NULL,
      status TEXT DEFAULT 'draft' NOT NULL,
      welcome_message TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      primary_language TEXT DEFAULT 'hi-IN' NOT NULL,
      voice_name TEXT DEFAULT 'Vaani Tara' NOT NULL,
      intelligence_profile TEXT DEFAULT 'Vaani Sense Balanced' NOT NULL,
      temperature INTEGER DEFAULT 20 NOT NULL,
      max_tokens INTEGER DEFAULT 250 NOT NULL,
      endpointing_ms INTEGER DEFAULT 250 NOT NULL,
      interrupt_words INTEGER DEFAULT 2 NOT NULL,
      tools_json TEXT DEFAULT '[]' NOT NULL,
      extractions_json TEXT DEFAULT '[]' NOT NULL,
      calling_config_json TEXT DEFAULT '{}' NOT NULL,
      cost_per_minute INTEGER DEFAULT 55 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_voice_agents_org_status ON voice_agents (organization_id, status)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS agent_test_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES voice_agents(id) ON DELETE CASCADE,
      mode TEXT DEFAULT 'text' NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      credits_used INTEGER DEFAULT 0 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_agent_test_sessions_org_created ON agent_test_sessions (organization_id, created_at)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS agent_test_messages (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL REFERENCES agent_test_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      actions_json TEXT DEFAULT '[]' NOT NULL,
      latency_ms INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_agent_test_messages_session ON agent_test_messages (session_id)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS payment_links (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
      agent_id TEXT REFERENCES voice_agents(id) ON DELETE SET NULL,
      reference_id TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_email TEXT,
      amount INTEGER NOT NULL,
      currency TEXT DEFAULT 'INR' NOT NULL,
      description TEXT NOT NULL,
      delivery_mode TEXT DEFAULT 'instant' NOT NULL,
      scheduled_for TEXT,
      provider TEXT DEFAULT 'razorpay_sandbox' NOT NULL,
      external_payment_link_id TEXT,
      short_url TEXT NOT NULL,
      status TEXT DEFAULT 'created' NOT NULL,
      provider_payload_json TEXT DEFAULT '{}' NOT NULL,
      paid_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_links_reference ON payment_links (reference_id)`,
    ),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_links_external ON payment_links (external_payment_link_id)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_payment_links_org_created ON payment_links (organization_id, created_at)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS outbound_messages (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
      payment_link_id TEXT REFERENCES payment_links(id) ON DELETE SET NULL,
      channel TEXT DEFAULT 'whatsapp' NOT NULL,
      destination TEXT NOT NULL,
      template_name TEXT,
      message_body TEXT NOT NULL,
      status TEXT DEFAULT 'queued' NOT NULL,
      provider_reference TEXT,
      error_message TEXT,
      scheduled_for TEXT,
      sent_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_outbound_messages_org_created ON outbound_messages (organization_id, created_at)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_outbound_messages_status_scheduled ON outbound_messages (status, scheduled_for)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS scheduled_actions (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
      agent_id TEXT REFERENCES voice_agents(id) ON DELETE SET NULL,
      type TEXT NOT NULL,
      payload_json TEXT DEFAULT '{}' NOT NULL,
      status TEXT DEFAULT 'pending' NOT NULL,
      run_at TEXT NOT NULL,
      attempt_count INTEGER DEFAULT 0 NOT NULL,
      max_attempts INTEGER DEFAULT 5 NOT NULL,
      last_error TEXT,
      completed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_scheduled_actions_status_run ON scheduled_actions (status, run_at)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_scheduled_actions_org ON scheduled_actions (organization_id)`,
    ),
  ]);

  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS auth_provider_settings (
      provider TEXT PRIMARY KEY NOT NULL,
      display_name TEXT NOT NULL,
      button_visible INTEGER DEFAULT 1 NOT NULL,
      enabled INTEGER DEFAULT 0 NOT NULL,
      status TEXT DEFAULT 'not_configured' NOT NULL,
      public_config_json TEXT DEFAULT '{}' NOT NULL,
      encrypted_secret TEXT,
      updated_by TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS platform_providers (
      id TEXT PRIMARY KEY NOT NULL,
      internal_name TEXT NOT NULL,
      public_name TEXT NOT NULL,
      category TEXT NOT NULL,
      required_credentials_json TEXT DEFAULT '[]' NOT NULL,
      status TEXT DEFAULT 'required' NOT NULL,
      health TEXT DEFAULT 'not_connected' NOT NULL,
      usage_note TEXT NOT NULL,
      customer_visible INTEGER DEFAULT 0 NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS support_agents (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'support_agent' NOT NULL,
      skills_json TEXT DEFAULT '[]' NOT NULL,
      languages_json TEXT DEFAULT '["hi-IN","en-IN"]' NOT NULL,
      availability TEXT DEFAULT 'offline' NOT NULL,
      active_calls INTEGER DEFAULT 0 NOT NULL,
      priority_tier TEXT DEFAULT 'standard' NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    // Organisation structure (§5-6). None of this existed: a number was bound
    // to a free-text `assigned_agent_name`, availability ignored working
    // hours, and a person could not exist without being a lead.
    db.prepare(`CREATE TABLE IF NOT EXISTS branches (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      code TEXT,
      city TEXT,
      timezone TEXT DEFAULT 'Asia/Kolkata' NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      code TEXT,
      status TEXT DEFAULT 'active' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
      department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      lead_support_agent_id TEXT,
      status TEXT DEFAULT 'active' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS shifts (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      support_agent_id TEXT REFERENCES support_agents(id) ON DELETE CASCADE,
      team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
      name TEXT,
      /** 0=Sunday .. 6=Saturday, as a JSON array of integers. */
      days_json TEXT DEFAULT '[1,2,3,4,5]' NOT NULL,
      start_minute INTEGER DEFAULT 540 NOT NULL,
      end_minute INTEGER DEFAULT 1080 NOT NULL,
      break_start_minute INTEGER,
      break_end_minute INTEGER,
      timezone TEXT DEFAULT 'Asia/Kolkata' NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_shifts_agent ON shifts (support_agent_id)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS agent_languages (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      support_agent_id TEXT NOT NULL REFERENCES support_agents(id) ON DELETE CASCADE,
      language TEXT NOT NULL,
      proficiency TEXT DEFAULT 'fluent' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_languages_unique ON agent_languages (support_agent_id, language)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS number_routes (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      number_id TEXT NOT NULL REFERENCES phone_numbers(id) ON DELETE CASCADE,
      route_type TEXT DEFAULT 'reception' NOT NULL,
      agent_id TEXT REFERENCES voice_agents(id) ON DELETE SET NULL,
      queue_id TEXT REFERENCES queues(id) ON DELETE SET NULL,
      campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
      branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
      language TEXT,
      priority INTEGER DEFAULT 100 NOT NULL,
      off_hours_action TEXT DEFAULT 'voicemail' NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_number_routes_number ON number_routes (number_id, priority)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      full_name TEXT,
      phone TEXT NOT NULL,
      email TEXT,
      preferred_language TEXT,
      branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
      lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
      consent_status TEXT DEFAULT 'unknown' NOT NULL,
      tags_json TEXT DEFAULT '[]' NOT NULL,
      notes TEXT,
      last_contacted_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_org_phone ON contacts (organization_id, phone)`,
    ),
    // Queues and routing (§7-9). Handoff previously had one hardcoded
    // strategy (skill, then language, then least busy) with no queue, no
    // priority and no overflow.
    db.prepare(`CREATE TABLE IF NOT EXISTS queues (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      strategy TEXT DEFAULT 'skill_first' NOT NULL,
      priority INTEGER DEFAULT 100 NOT NULL,
      required_skill TEXT,
      language TEXT,
      min_role TEXT,
      sla_seconds INTEGER DEFAULT 60 NOT NULL,
      overflow_action TEXT DEFAULT 'callback' NOT NULL,
      overflow_queue_id TEXT,
      status TEXT DEFAULT 'active' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_queues_org_slug ON queues (organization_id, slug)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS queue_members (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      queue_id TEXT NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
      support_agent_id TEXT NOT NULL REFERENCES support_agents(id) ON DELETE CASCADE,
      priority INTEGER DEFAULT 100 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_members_unique ON queue_members (queue_id, support_agent_id)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS routing_rules (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      match_type TEXT NOT NULL,
      match_value TEXT NOT NULL,
      queue_id TEXT NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
      priority INTEGER DEFAULT 100 NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_routing_rules_org ON routing_rules (organization_id, priority)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS approval_requests (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      session_id TEXT,
      handoff_id TEXT,
      action TEXT NOT NULL,
      amount INTEGER,
      currency TEXT DEFAULT 'INR' NOT NULL,
      reason TEXT,
      case_summary TEXT,
      evidence_json TEXT DEFAULT '{}' NOT NULL,
      risk_level TEXT NOT NULL,
      policy_decision TEXT NOT NULL,
      policy_version INTEGER DEFAULT 1 NOT NULL,
      policy_reasons_json TEXT DEFAULT '[]' NOT NULL,
      ai_recommendation TEXT,
      status TEXT DEFAULT 'pending' NOT NULL,
      decided_by TEXT,
      decided_at TEXT,
      decision_reason TEXT,
      idempotency_key TEXT UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS refunds (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      approval_id TEXT,
      session_id TEXT,
      order_reference TEXT,
      customer_phone TEXT,
      amount INTEGER NOT NULL,
      currency TEXT DEFAULT 'INR' NOT NULL,
      reason TEXT,
      status TEXT DEFAULT 'requested' NOT NULL,
      provider TEXT,
      provider_reference TEXT,
      failure_reason TEXT,
      policy_version INTEGER DEFAULT 1 NOT NULL,
      authorised_by TEXT,
      idempotency_key TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      confirmed_at TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS callback_requests (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      session_id TEXT,
      customer_name TEXT,
      customer_phone TEXT NOT NULL,
      reason TEXT,
      requested_window TEXT,
      status TEXT DEFAULT 'pending' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      lead_id TEXT,
      agent_id TEXT,
      customer_name TEXT,
      customer_phone TEXT,
      service TEXT,
      slot_start TEXT NOT NULL,
      slot_end TEXT,
      mode TEXT DEFAULT 'in_person' NOT NULL,
      status TEXT DEFAULT 'booked' NOT NULL,
      idempotency_key TEXT UNIQUE,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS handoffs (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      agent_id TEXT,
      session_id TEXT,
      lead_id TEXT,
      reason TEXT NOT NULL,
      summary TEXT,
      status TEXT DEFAULT 'pending' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS agent_tool_calls (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL,
      session_id TEXT,
      turn_id INTEGER,
      tool_name TEXT NOT NULL,
      input_json TEXT DEFAULT '{}' NOT NULL,
      result_json TEXT,
      ok INTEGER DEFAULT 0 NOT NULL,
      error_message TEXT,
      latency_ms INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS platform_provider_secrets (
      provider TEXT PRIMARY KEY NOT NULL,
      encrypted_secret TEXT,
      public_config_json TEXT DEFAULT '{}' NOT NULL,
      updated_by TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS organization_settings (
      organization_id TEXT PRIMARY KEY NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      timezone TEXT DEFAULT 'Asia/Kolkata' NOT NULL,
      default_language TEXT DEFAULT 'hinglish' NOT NULL,
      enabled_languages_json TEXT DEFAULT '["hi-IN","en-IN","hinglish","haryanvi","pa-IN","mr-IN","gu-IN","bn-IN","ta-IN","te-IN"]' NOT NULL,
      recording_policy TEXT DEFAULT 'record_with_consent' NOT NULL,
      recording_retention_days INTEGER DEFAULT 90 NOT NULL,
      transcript_retention_days INTEGER DEFAULT 180 NOT NULL,
      qa_sample_rate INTEGER DEFAULT 100 NOT NULL,
      redact_sensitive_data INTEGER DEFAULT 1 NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sip_trunks (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      provider TEXT DEFAULT 'custom' NOT NULL,
      gateway_uri TEXT NOT NULL,
      auth_type TEXT DEFAULT 'userpass' NOT NULL,
      encrypted_credentials TEXT,
      transport TEXT DEFAULT 'tls' NOT NULL,
      media_encryption TEXT DEFAULT 'sdes' NOT NULL,
      codecs_json TEXT DEFAULT '["PCMU","PCMA"]' NOT NULL,
      status TEXT DEFAULT 'testing_required' NOT NULL,
      last_checked_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_sip_trunks_org_status ON sip_trunks (organization_id, status)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS knowledge_bases (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      language TEXT DEFAULT 'multilingual' NOT NULL,
      status TEXT DEFAULT 'ready' NOT NULL,
      source_count INTEGER DEFAULT 0 NOT NULL,
      chunk_count INTEGER DEFAULT 0 NOT NULL,
      last_synced_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_knowledge_bases_org ON knowledge_bases (organization_id, status)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      status TEXT DEFAULT 'draft' NOT NULL,
      steps_json TEXT DEFAULT '[]' NOT NULL,
      run_count INTEGER DEFAULT 0 NOT NULL,
      failure_count INTEGER DEFAULT 0 NOT NULL,
      last_run_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_workflows_org_status ON workflows (organization_id, status)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS graph_agents (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'draft' NOT NULL,
      entry_node TEXT DEFAULT 'greeting' NOT NULL,
      graph_json TEXT DEFAULT '{}' NOT NULL,
      version INTEGER DEFAULT 1 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_graph_agents_org_status ON graph_agents (organization_id, status)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      agent_id TEXT REFERENCES voice_agents(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'draft' NOT NULL,
      audience_size INTEGER DEFAULT 0 NOT NULL,
      attempted INTEGER DEFAULT 0 NOT NULL,
      connected INTEGER DEFAULT 0 NOT NULL,
      converted INTEGER DEFAULT 0 NOT NULL,
      concurrency INTEGER DEFAULT 1 NOT NULL,
      retry_policy_json TEXT DEFAULT '{}' NOT NULL,
      calling_window_json TEXT DEFAULT '{}' NOT NULL,
      scheduled_for TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_campaigns_org_status ON campaigns (organization_id, status)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS call_records (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      agent_id TEXT REFERENCES voice_agents(id) ON DELETE SET NULL,
      lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
      campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
      direction TEXT NOT NULL,
      from_number TEXT NOT NULL,
      to_number TEXT NOT NULL,
      customer_name TEXT,
      status TEXT NOT NULL,
      outcome TEXT,
      duration_seconds INTEGER DEFAULT 0 NOT NULL,
      latency_ms INTEGER,
      sentiment TEXT,
      summary TEXT,
      transcript_json TEXT DEFAULT '[]' NOT NULL,
      analysis_json TEXT DEFAULT '{}' NOT NULL,
      recording_status TEXT DEFAULT 'not_available' NOT NULL,
      recording_storage_key TEXT,
      recording_url TEXT,
      cost_credits INTEGER DEFAULT 0 NOT NULL,
      disconnect_reason TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_call_records_org_started ON call_records (organization_id, started_at)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_call_records_org_status ON call_records (organization_id, status)`,
    ),
    // Call telemetry (§11-12). Conversation content used to live only in the
    // seed-only `call_records.transcript_json` blob, so no real call could
    // produce a transcript, a summary or a QA review.
    db.prepare(`CREATE TABLE IF NOT EXISTS call_turns (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      call_id TEXT NOT NULL REFERENCES call_records(id) ON DELETE CASCADE,
      turn_index INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      language TEXT,
      latency_ms INTEGER,
      model TEXT,
      tool_calls_json TEXT DEFAULT '[]' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_call_turns_call_index ON call_turns (call_id, turn_index)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS transcripts (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      call_id TEXT NOT NULL UNIQUE REFERENCES call_records(id) ON DELETE CASCADE,
      language TEXT,
      source TEXT DEFAULT 'playground' NOT NULL,
      turn_count INTEGER DEFAULT 0 NOT NULL,
      full_text TEXT DEFAULT '' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS summaries (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      call_id TEXT NOT NULL UNIQUE REFERENCES call_records(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      intent TEXT,
      sentiment TEXT,
      outcome TEXT,
      objections_json TEXT DEFAULT '[]' NOT NULL,
      next_action TEXT,
      model TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    // §6's chat and its history. One thread per conversation, messages inside.
    // What was actually done about a recommendation (§6, Execution). Kept
    // separate from the campaign or task it created, so the board can say
    // "you made this a campaign on 5 September" without the recommendation
    // itself disappearing — the observation behind it stays true until the
    // numbers move.
    db.prepare(`CREATE TABLE IF NOT EXISTS growth_actions (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      recommendation_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT DEFAULT '' NOT NULL,
      status TEXT DEFAULT 'open' NOT NULL,
      target_type TEXT,
      target_id TEXT,
      assigned_to TEXT,
      due_at TEXT,
      evidence_json TEXT DEFAULT '[]' NOT NULL,
      created_by TEXT,
      completed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_growth_actions_org ON growth_actions (organization_id, status, created_at)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS growth_chats (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_growth_chats_org
      ON growth_chats (organization_id, updated_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS growth_messages (
      id TEXT PRIMARY KEY NOT NULL,
      chat_id TEXT NOT NULL REFERENCES growth_chats(id) ON DELETE CASCADE,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      -- What the answer was allowed to draw on, kept so a reply can be audited
      -- later rather than taken on trust.
      grounded_on_json TEXT DEFAULT '{}' NOT NULL,
      model TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_growth_messages_chat
      ON growth_messages (chat_id, created_at)`),
    // §6 growth runs. Each run keeps its own trace, so a report can show what
    // was actually fetched and how long each step took rather than asking to be
    // believed. The run id is printed on the report for the same reason.
    db.prepare(`CREATE TABLE IF NOT EXISTS growth_runs (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      started_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
      site_url TEXT NOT NULL,
      host TEXT,
      status TEXT DEFAULT 'running' NOT NULL,
      failure_reason TEXT,
      steps_json TEXT DEFAULT '[]' NOT NULL,
      pages_json TEXT DEFAULT '[]' NOT NULL,
      findings_json TEXT DEFAULT '[]' NOT NULL,
      high_count INTEGER DEFAULT 0 NOT NULL,
      medium_count INTEGER DEFAULT 0 NOT NULL,
      low_count INTEGER DEFAULT 0 NOT NULL,
      total_ms INTEGER DEFAULT 0 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_growth_runs_org
      ON growth_runs (organization_id, created_at)`),
    // §6's discovery interview. One row per workspace: the answers are the
    // business's own description of itself, and everything the growth board
    // says is either measured from real tables or traceable to one of these.
    db.prepare(`CREATE TABLE IF NOT EXISTS business_profiles (
      organization_id TEXT PRIMARY KEY NOT NULL
        REFERENCES organizations(id) ON DELETE CASCADE,
      answers_json TEXT DEFAULT '{}' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    // §3.5: "Save named filter/view combinations by user/team." Per-person by
    // default because a view is how somebody works, not a workspace setting;
    // `shared` promotes one to the whole team.
    db.prepare(`CREATE TABLE IF NOT EXISTS saved_lead_views (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      view TEXT DEFAULT 'kanban' NOT NULL,
      filters_json TEXT DEFAULT '{}' NOT NULL,
      shared INTEGER DEFAULT 0 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_views_name
      ON saved_lead_views (organization_id, user_id, name)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_saved_views_org
      ON saved_lead_views (organization_id, shared)`),
    // §3.2 asks for a notification centre, and names it a bug fix: the bell in
    // the portal shell showed a permanently-lit unread dot over the hardcoded
    // sentence "Workspace systems are healthy", and its "Open notification
    // center" button navigated to the alerts screen. There was no centre, no
    // read state, and nothing stored — so an event a person missed was gone.
    //
    // Stored server-side rather than per browser because §3.2 requires read
    // state "consistent across tabs/devices", which localStorage cannot do.
    db.prepare(`CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      -- Null means the whole workspace sees it. A user id scopes it to one
      -- person, so "your transfer was accepted" does not reach everybody.
      user_id TEXT REFERENCES app_users(id) ON DELETE CASCADE,
      event TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      severity TEXT DEFAULT 'info' NOT NULL,
      -- §3.2: payment failure, transfer failure and security issues stay until
      -- somebody acknowledges them rather than timing out unseen.
      requires_ack INTEGER DEFAULT 0 NOT NULL,
      -- The "single event ID" §3.2 asks for. One real-world event has one key,
      -- so two tabs or two devices reporting it produce one row and one toast.
      dedupe_key TEXT NOT NULL,
      read_at TEXT,
      acknowledged_at TEXT,
      acknowledged_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe
      ON notifications (organization_id, dedupe_key)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_notifications_inbox
      ON notifications (organization_id, created_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_notifications_unread
      ON notifications (organization_id, read_at)`),
    // §10's objection library. Objections have always been extracted per call
    // into summaries.objections_json and never read back; this is where they
    // accumulate into something a workspace can see and answer.
    db.prepare(`CREATE TABLE IF NOT EXISTS objection_library (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      objection_key TEXT NOT NULL,
      label TEXT NOT NULL,
      occurrences INTEGER DEFAULT 0 NOT NULL,
      rebuttal TEXT,
      rebuttal_updated_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,
      rebuttal_updated_at TEXT,
      status TEXT DEFAULT 'open' NOT NULL,
      last_call_id TEXT,
      first_heard_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      last_heard_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_objection_library_key
      ON objection_library (organization_id, objection_key)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_objection_library_rank
      ON objection_library (organization_id, occurrences)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS call_participants (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      call_id TEXT NOT NULL REFERENCES call_records(id) ON DELETE CASCADE,
      participant_type TEXT NOT NULL,
      reference_id TEXT,
      display_name TEXT,
      joined_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      left_at TEXT
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_call_participants_call ON call_participants (call_id)`,
    ),
    // §7-9: the Universal Object Engine. A workspace defines its own objects
    // and fields; `records.values_json` is the whole record, and `record_values`
    // is a typed projection of the filterable fields so SQLite can index them.
    // The projection is derived on every write, never authoritative.
    db.prepare(`CREATE TABLE IF NOT EXISTS custom_objects (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      plural_name TEXT,
      description TEXT,
      icon TEXT,
      /* Which field is the record's headline, for tool results and lists. */
      title_field TEXT,
      status TEXT DEFAULT 'active' NOT NULL,
      source TEXT DEFAULT 'manual' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_objects_key ON custom_objects (organization_id, key)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS custom_fields (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      object_id TEXT NOT NULL REFERENCES custom_objects(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      required INTEGER DEFAULT 0 NOT NULL,
      filterable INTEGER DEFAULT 0 NOT NULL,
      options_json TEXT DEFAULT '[]' NOT NULL,
      related_object TEXT,
      currency TEXT,
      position INTEGER DEFAULT 0 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_fields_key ON custom_fields (object_id, key)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      object_id TEXT NOT NULL REFERENCES custom_objects(id) ON DELETE CASCADE,
      title TEXT,
      values_json TEXT DEFAULT '{}' NOT NULL,
      search_text TEXT DEFAULT '' NOT NULL,
      /* published records are the only ones an agent may quote to a customer. */
      status TEXT DEFAULT 'published' NOT NULL,
      external_id TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_records_object ON records (organization_id, object_id, status)`,
    ),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_records_external ON records (object_id, external_id)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS record_values (
      record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL,
      text_value TEXT,
      number_value REAL,
      date_value TEXT,
      PRIMARY KEY (record_id, field_key)
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_record_values_text ON record_values (field_key, text_value)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_record_values_number ON record_values (field_key, number_value)`,
    ),
    // §9: an order is a distinct thing from a payment link. A link is a request
    // for money; an order is what the customer bought, what it costs, and what
    // has to reach them afterwards.
    db.prepare(`CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
      session_id TEXT,
      customer_name TEXT,
      customer_phone TEXT,
      customer_email TEXT,
      status TEXT DEFAULT 'awaiting_payment' NOT NULL,
      currency TEXT DEFAULT 'INR' NOT NULL,
      subtotal INTEGER DEFAULT 0 NOT NULL,
      total INTEGER DEFAULT 0 NOT NULL,
      has_digital INTEGER DEFAULT 0 NOT NULL,
      payment_link_id TEXT REFERENCES payment_links(id) ON DELETE SET NULL,
      idempotency_key TEXT UNIQUE,
      notes TEXT,
      paid_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_orders_org ON orders (organization_id, status, created_at)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_orders_payment_link ON orders (payment_link_id)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY NOT NULL,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      record_id TEXT,
      object_key TEXT,
      title TEXT NOT NULL,
      kind TEXT DEFAULT 'physical' NOT NULL,
      quantity INTEGER DEFAULT 1 NOT NULL,
      unit_price INTEGER DEFAULT 0 NOT NULL,
      line_total INTEGER DEFAULT 0 NOT NULL,
      inventory_field TEXT,
      delivery_asset TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id)`,
    ),
    // §9: the gate. An entitlement exists from the moment the order is placed
    // and stays 'pending' until the payment provider's *signed* webhook says
    // the money arrived. The raw token is only ever in the delivery URL; the
    // row stores its hash, so a leaked database does not hand out downloads.
    db.prepare(`CREATE TABLE IF NOT EXISTS entitlements (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      order_item_id TEXT REFERENCES order_items(id) ON DELETE CASCADE,
      record_id TEXT,
      token_hash TEXT NOT NULL,
      asset_url TEXT NOT NULL,
      title TEXT,
      status TEXT DEFAULT 'pending' NOT NULL,
      download_count INTEGER DEFAULT 0 NOT NULL,
      max_downloads INTEGER,
      released_at TEXT,
      expires_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_entitlements_token ON entitlements (token_hash)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_entitlements_order ON entitlements (order_id)`,
    ),
    // §13, §34: versioned provider rate cards, which double as the model
    // registry. Never edited in place — a call made last month must still price
    // at last month's rate, or margin history rewrites itself whenever a
    // provider changes its pricing.
    db.prepare(`CREATE TABLE IF NOT EXISTS provider_rate_cards (
      id TEXT PRIMARY KEY NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      category TEXT NOT NULL,
      unit TEXT NOT NULL,
      price_micros INTEGER NOT NULL,
      currency TEXT DEFAULT 'INR' NOT NULL,
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      /* Where the figure came from, so a reference is never mistaken for a quote. */
      source TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_rate_cards_lookup ON provider_rate_cards (provider, unit, effective_from)`,
    ),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_cards_version ON provider_rate_cards (provider, coalesce(model, ''), unit, effective_from)`,
    ),
    // §32: consent for a custom voice. The artefact a platform reviewer reads
    // before anyone may speak in somebody else's voice.
    db.prepare(`CREATE TABLE IF NOT EXISTS voice_consents (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      voice_profile_id TEXT NOT NULL REFERENCES voice_profiles(id) ON DELETE CASCADE,
      speaker_name TEXT NOT NULL,
      relationship TEXT NOT NULL,
      statement TEXT NOT NULL,
      /* A stored recording or signed document, never a public URL. */
      evidence_key TEXT NOT NULL,
      state TEXT DEFAULT 'pending' NOT NULL,
      submitted_by TEXT,
      verified_by TEXT,
      verified_at TEXT,
      review_note TEXT,
      withdrawn_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_consents_profile ON voice_consents (voice_profile_id)`,
    ),
    // §30: audited support access. A PIN is minted *inside* the workspace by
    // someone who works there — support cannot let itself in — and it is
    // single-use, attempt-limited and short-lived. Only the hash is stored.
    db.prepare(`CREATE TABLE IF NOT EXISTS support_pins (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      pin_hash TEXT NOT NULL,
      issued_by TEXT,
      reason TEXT,
      attempts INTEGER DEFAULT 0 NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      revoked_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_support_pins_org ON support_pins (organization_id, expires_at)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS support_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      pin_id TEXT REFERENCES support_pins(id) ON DELETE SET NULL,
      executive_user_id TEXT NOT NULL,
      executive_email TEXT,
      ticket_id TEXT,
      reason TEXT,
      /* Every read during the session is counted, so a "quick look" that turns
         into an hour of browsing is visible afterwards. */
      view_count INTEGER DEFAULT 0 NOT NULL,
      expires_at TEXT NOT NULL,
      ended_at TEXT,
      ended_reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_support_sessions_org ON support_sessions (organization_id, created_at)`,
    ),
    // §29: per-component health state that survives a restart. The measured
    // window comes from provider_usage_events; this row carries the facts a
    // window cannot show — the last success, a tripped breaker, a declared
    // maintenance window, credential expiry and quota.
    db.prepare(`CREATE TABLE IF NOT EXISTS public_status_updates (
      id TEXT PRIMARY KEY NOT NULL,
      component TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      state TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT,
      created_by TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS service_health (
      component TEXT PRIMARY KEY NOT NULL,
      state TEXT DEFAULT 'unknown' NOT NULL,
      reason TEXT,
      last_success_at TEXT,
      last_failure_at TEXT,
      consecutive_failures INTEGER DEFAULT 0 NOT NULL,
      breaker_opened_at TEXT,
      maintenance_until TEXT,
      maintenance_note TEXT,
      token_expires_at TEXT,
      quota_used INTEGER,
      quota_limit INTEGER,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    // §26: country price books. An entry here is an explicit pricing decision
    // and beats any conversion — a rounded conversion is not a strategy.
    db.prepare(`CREATE TABLE IF NOT EXISTS price_books (
      id TEXT PRIMARY KEY NOT NULL,
      product_type TEXT NOT NULL,
      product_id TEXT NOT NULL,
      /* Empty means "any country using this currency". */
      country TEXT DEFAULT '' NOT NULL,
      currency TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      active INTEGER DEFAULT 1 NOT NULL,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_price_books_entry ON price_books (product_type, product_id, country, currency)`,
    ),
    // §26: FX. A rate is stored with the day it applied, so a converted amount
    // can be explained months later rather than silently re-derived at today's
    // rate.
    db.prepare(`CREATE TABLE IF NOT EXISTS fx_rates (
      id TEXT PRIMARY KEY NOT NULL,
      base_currency TEXT NOT NULL,
      quote_currency TEXT NOT NULL,
      rate REAL NOT NULL,
      effective_from TEXT NOT NULL,
      source TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_fx_pair ON fx_rates (base_currency, quote_currency, effective_from)`,
    ),
    // §6: what the audio path actually did, per leg. Recorded from the leg's
    // own socket at the end of a call, so support can answer "why did that
    // call sound bad" with measurements instead of guesses.
    db.prepare(`CREATE TABLE IF NOT EXISTS call_transport_stats (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      call_id TEXT NOT NULL REFERENCES call_records(id) ON DELETE CASCADE,
      leg_role TEXT DEFAULT 'agent' NOT NULL,
      transport TEXT DEFAULT 'websocket' NOT NULL,
      band TEXT,
      score INTEGER,
      frames_sent INTEGER DEFAULT 0 NOT NULL,
      frames_received INTEGER DEFAULT 0 NOT NULL,
      send_kbps REAL,
      receive_kbps REAL,
      pacing_jitter_ms REAL,
      worst_gap_ms INTEGER,
      underruns INTEGER DEFAULT 0 NOT NULL,
      longest_silence_ms INTEGER,
      socket_rtt_ms INTEGER,
      socket_jitter_ms INTEGER,
      primary_issue TEXT,
      warnings_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_call_transport_call ON call_transport_stats (call_id)`,
    ),
    // Superseded. A row per call was written here and read by nothing; the
    // recording a workspace can play is `call_records.recording_status` plus
    // `recording_storage_key`, which the telephony webhook keeps current.
    db.prepare(`CREATE TABLE IF NOT EXISTS recordings (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      call_id TEXT NOT NULL REFERENCES call_records(id) ON DELETE CASCADE,
      storage_key TEXT,
      status TEXT DEFAULT 'not_available' NOT NULL,
      format TEXT,
      duration_seconds INTEGER DEFAULT 0 NOT NULL,
      bytes INTEGER DEFAULT 0 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_recordings_call ON recordings (call_id)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS call_quality_reviews (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      call_id TEXT NOT NULL REFERENCES call_records(id) ON DELETE CASCADE,
      overall_score INTEGER NOT NULL,
      resolution_score INTEGER NOT NULL,
      knowledge_score INTEGER NOT NULL,
      naturalness_score INTEGER NOT NULL,
      policy_score INTEGER NOT NULL,
      hallucination_count INTEGER DEFAULT 0 NOT NULL,
      overlap_count INTEGER DEFAULT 0 NOT NULL,
      status TEXT DEFAULT 'passed' NOT NULL,
      findings_json TEXT DEFAULT '[]' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_call_quality_org_score ON call_quality_reviews (organization_id, overall_score)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS alert_rules (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      metric TEXT NOT NULL,
      comparator TEXT DEFAULT '>' NOT NULL,
      threshold INTEGER NOT NULL,
      window_minutes INTEGER DEFAULT 60 NOT NULL,
      frequency_minutes INTEGER DEFAULT 15 NOT NULL,
      channels_json TEXT DEFAULT '["email"]' NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_alert_rules_org_status ON alert_rules (organization_id, status)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS alert_incidents (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      rule_id TEXT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
      current_value INTEGER NOT NULL,
      status TEXT DEFAULT 'open' NOT NULL,
      triggered_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      resolved_at TEXT
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_alert_incidents_org_status ON alert_incidents (organization_id, status)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS report_definitions (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      report_type TEXT NOT NULL,
      schedule TEXT DEFAULT 'manual' NOT NULL,
      filters_json TEXT DEFAULT '{}' NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      last_generated_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_reports_org_status ON report_definitions (organization_id, status)`,
    ),
    // Provider webhook receipts. Kept so a redelivery is idempotent and an
    // unrecognised event is visible rather than silently dropped.
    db.prepare(`CREATE TABLE IF NOT EXISTS provider_webhook_events (
      id TEXT PRIMARY KEY NOT NULL,
      provider TEXT NOT NULL,
      event_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
      status TEXT DEFAULT 'received' NOT NULL,
      detail TEXT,
      payload_json TEXT DEFAULT '{}' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_webhook_event ON provider_webhook_events (provider, event_id)`,
    ),
    // Agent workstation diagnostics (§17, §23).
    db.prepare(`CREATE TABLE IF NOT EXISTS agent_device_preferences (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      input_device_label TEXT,
      output_device_label TEXT,
      input_device_id TEXT,
      output_device_id TEXT,
      ringtone_volume INTEGER DEFAULT 70 NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_device_prefs_user ON agent_device_preferences (organization_id, user_id)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS device_test_runs (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      support_code TEXT NOT NULL,
      readiness TEXT NOT NULL,
      quality_score INTEGER,
      quality_band TEXT,
      rtt_ms INTEGER,
      jitter_ms INTEGER,
      loss_percent REAL,
      mic_level REAL,
      microphone_permission TEXT,
      input_device_label TEXT,
      output_device_label TEXT,
      browser TEXT,
      platform TEXT,
      warnings_json TEXT DEFAULT '[]' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_device_tests_user ON device_test_runs (organization_id, user_id, created_at)`,
    ),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_device_tests_support ON device_test_runs (support_code)`,
    ),
    // Bulk calling imports (§10). A rejected row keeps its reason so the
    // customer can fix the file rather than guessing what went wrong.
    db.prepare(`CREATE TABLE IF NOT EXISTS import_jobs (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      created_by_user_id TEXT,
      filename TEXT NOT NULL,
      format TEXT NOT NULL,
      status TEXT DEFAULT 'previewed' NOT NULL,
      campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
      headers_json TEXT DEFAULT '[]' NOT NULL,
      mapping_json TEXT DEFAULT '{}' NOT NULL,
      total_rows INTEGER DEFAULT 0 NOT NULL,
      accepted_rows INTEGER DEFAULT 0 NOT NULL,
      rejected_rows INTEGER DEFAULT 0 NOT NULL,
      duplicate_rows INTEGER DEFAULT 0 NOT NULL,
      suppressed_rows INTEGER DEFAULT 0 NOT NULL,
      truncated INTEGER DEFAULT 0 NOT NULL,
      default_country_code TEXT DEFAULT '91' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      committed_at TEXT
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_import_jobs_org ON import_jobs (organization_id, created_at)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS import_rows (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      import_job_id TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
      row_number INTEGER NOT NULL,
      phone TEXT,
      name TEXT,
      language TEXT,
      timezone TEXT,
      company TEXT,
      notes TEXT,
      status TEXT DEFAULT 'accepted' NOT NULL,
      reason TEXT,
      raw_json TEXT DEFAULT '[]' NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_import_rows_job ON import_rows (import_job_id, status)`,
    ),
    // Co-pilot suggestions, cached per transcript length so a polling Agent
    // Desk cannot re-bill the model on every refresh.
    db.prepare(`CREATE TABLE IF NOT EXISTS copilot_suggestions (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      handoff_id TEXT NOT NULL,
      call_id TEXT,
      turn_count INTEGER DEFAULT 0 NOT NULL,
      goal TEXT,
      facts_json TEXT DEFAULT '[]' NOT NULL,
      suggestions_json TEXT DEFAULT '[]' NOT NULL,
      risks_json TEXT DEFAULT '[]' NOT NULL,
      next_action TEXT,
      model TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_copilot_handoff_turns ON copilot_suggestions (handoff_id, turn_count)`,
    ),
    // Report runs. `report.generate` used to only bump last_generated_at, so a
    // scheduled report produced nothing a customer could open or download.
    db.prepare(`CREATE TABLE IF NOT EXISTS report_runs (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      report_id TEXT NOT NULL REFERENCES report_definitions(id) ON DELETE CASCADE,
      status TEXT DEFAULT 'ready' NOT NULL,
      report_type TEXT NOT NULL,
      window_days INTEGER DEFAULT 30 NOT NULL,
      row_count INTEGER DEFAULT 0 NOT NULL,
      summary_json TEXT DEFAULT '{}' NOT NULL,
      content_csv TEXT DEFAULT '' NOT NULL,
      bytes INTEGER DEFAULT 0 NOT NULL,
      error TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_report_runs_report ON report_runs (report_id, created_at)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      created_by_user_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      category TEXT DEFAULT 'technical' NOT NULL,
      priority TEXT DEFAULT 'normal' NOT NULL,
      status TEXT DEFAULT 'open' NOT NULL,
      assigned_to TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_support_tickets_org_status ON support_tickets (organization_id, status)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS support_ticket_messages (
      id TEXT PRIMARY KEY NOT NULL,
      ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      sender_role TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON support_ticket_messages (ticket_id, created_at)`,
    ),
  ]);

  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS background_jobs (
      id TEXT PRIMARY KEY NOT NULL, organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
      queue TEXT DEFAULT 'default' NOT NULL, type TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      payload_json TEXT DEFAULT '{}' NOT NULL, status TEXT DEFAULT 'queued' NOT NULL,
      priority INTEGER DEFAULT 100 NOT NULL, attempts INTEGER DEFAULT 0 NOT NULL,
      max_attempts INTEGER DEFAULT 5 NOT NULL, available_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      locked_at TEXT, locked_by TEXT, last_error TEXT, completed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_background_jobs_idempotency ON background_jobs (idempotency_key)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_background_jobs_claim ON background_jobs (status, available_at, priority)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_background_jobs_org ON background_jobs (organization_id, created_at)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS job_attempts (
      id TEXT PRIMARY KEY NOT NULL, job_id TEXT NOT NULL REFERENCES background_jobs(id) ON DELETE CASCADE,
      attempt INTEGER NOT NULL, status TEXT NOT NULL, duration_ms INTEGER, error TEXT,
      result_json TEXT DEFAULT '{}' NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_job_attempts_job ON job_attempts (job_id, attempt)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS consent_records (
      id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL, phone TEXT NOT NULL, purpose TEXT NOT NULL,
      lawful_basis TEXT DEFAULT 'explicit_consent' NOT NULL, status TEXT DEFAULT 'granted' NOT NULL,
      proof_json TEXT DEFAULT '{}' NOT NULL, captured_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      expires_at TEXT, revoked_at TEXT
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_consent_org_phone ON consent_records (organization_id, phone, status)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS suppression_entries (
      id TEXT PRIMARY KEY NOT NULL, organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
      phone_hash TEXT NOT NULL, scope TEXT DEFAULT 'organization' NOT NULL, reason TEXT NOT NULL,
      source TEXT DEFAULT 'customer_request' NOT NULL, expires_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_suppression_scope_phone ON suppression_entries (organization_id, scope, phone_hash)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS kyc_documents (
      id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      phone_number_id TEXT REFERENCES phone_numbers(id) ON DELETE SET NULL, document_type TEXT NOT NULL,
      storage_key TEXT NOT NULL, checksum TEXT NOT NULL, status TEXT DEFAULT 'submitted' NOT NULL,
      rejection_reason TEXT, reviewed_by TEXT, reviewed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_kyc_org_status ON kyc_documents (organization_id, status)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS oauth_states (
      id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL, state_hash TEXT NOT NULL,
      code_verifier_encrypted TEXT NOT NULL, return_to TEXT DEFAULT '/app' NOT NULL,
      expires_at TEXT NOT NULL, consumed_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_states_hash ON oauth_states (state_hash)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS oauth_identities (
      id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL, subject TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      email TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_identities_provider_subject
       ON oauth_identities (provider, subject)`,
    ),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_identities_provider_user
       ON oauth_identities (provider, user_id)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS oauth_account_links (
      id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      email TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_oauth_account_links_pending
       ON oauth_account_links (provider, user_id, email, expires_at, consumed_at)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS security_challenges (
      id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      type TEXT NOT NULL, token_hash TEXT NOT NULL, metadata_json TEXT DEFAULT '{}' NOT NULL,
      expires_at TEXT NOT NULL, consumed_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_security_challenges_token ON security_challenges (token_hash)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_security_challenges_user ON security_challenges (user_id, type)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS rate_limit_buckets (
      bucket_key TEXT PRIMARY KEY NOT NULL, count INTEGER DEFAULT 0 NOT NULL,
      window_started_at TEXT NOT NULL, blocked_until TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS user_security_settings (
      user_id TEXT PRIMARY KEY NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      email_verified_at TEXT, mfa_enabled INTEGER DEFAULT 0 NOT NULL,
      totp_secret_encrypted TEXT, recovery_code_hashes_json TEXT DEFAULT '[]' NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS team_invitations (
      id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      email TEXT NOT NULL, role TEXT NOT NULL, token_hash TEXT NOT NULL, invited_by TEXT NOT NULL,
      expires_at TEXT NOT NULL, accepted_at TEXT, revoked_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_team_invites_token ON team_invitations (token_hash)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_team_invites_org_email ON team_invitations (organization_id, email)`,
    ),
  ]);

  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS knowledge_sources (
      id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      knowledge_base_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
      type TEXT NOT NULL, name TEXT NOT NULL, source_url TEXT, storage_key TEXT,
      content_hash TEXT NOT NULL, status TEXT DEFAULT 'queued' NOT NULL, error TEXT, synced_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_knowledge_sources_kb ON knowledge_sources (knowledge_base_id, status)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL, content TEXT NOT NULL, token_estimate INTEGER NOT NULL,
      metadata_json TEXT DEFAULT '{}' NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_chunks_source_ordinal ON knowledge_chunks (source_id, ordinal)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_org ON knowledge_chunks (organization_id)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE, trigger_type TEXT NOT NULL,
      trigger_id TEXT, status TEXT DEFAULT 'queued' NOT NULL, input_json TEXT DEFAULT '{}' NOT NULL,
      output_json TEXT DEFAULT '{}' NOT NULL, started_at TEXT, completed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_workflow_runs_org ON workflow_runs (organization_id, created_at)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS workflow_run_steps (
      id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      step_index INTEGER NOT NULL, step_type TEXT NOT NULL, status TEXT DEFAULT 'pending' NOT NULL,
      input_json TEXT DEFAULT '{}' NOT NULL, output_json TEXT DEFAULT '{}' NOT NULL, error TEXT,
      started_at TEXT, completed_at TEXT
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_steps_run_index ON workflow_run_steps (run_id, step_index)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS campaign_contacts (
      id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL, phone TEXT NOT NULL,
      status TEXT DEFAULT 'pending' NOT NULL, consent_status TEXT DEFAULT 'unknown' NOT NULL,
      attempt_count INTEGER DEFAULT 0 NOT NULL, next_attempt_at TEXT, outcome TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_contacts_campaign_phone ON campaign_contacts (campaign_id, phone)`,
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_campaign_contacts_ready ON campaign_contacts (campaign_id, status, next_attempt_at)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS provider_usage_events (
      id TEXT PRIMARY KEY NOT NULL, organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
      provider_id TEXT NOT NULL, category TEXT NOT NULL, operation TEXT NOT NULL, units INTEGER DEFAULT 1 NOT NULL,
      provider_cost_micros INTEGER DEFAULT 0 NOT NULL, billed_credits INTEGER DEFAULT 0 NOT NULL,
      latency_ms INTEGER, status TEXT NOT NULL, reference_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_provider_usage_created ON provider_usage_events (provider_id, created_at)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS retargeting_audiences (
      id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL, destination TEXT NOT NULL, rules_json TEXT DEFAULT '{}' NOT NULL,
      status TEXT DEFAULT 'draft' NOT NULL, eligible_count INTEGER DEFAULT 0 NOT NULL,
      last_synced_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_retargeting_org ON retargeting_audiences (organization_id, status)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS payment_reconciliations (
      id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      provider TEXT NOT NULL, external_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT,
      amount INTEGER NOT NULL, currency TEXT DEFAULT 'INR' NOT NULL, status TEXT NOT NULL,
      mismatch_reason TEXT, reconciled_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_reconciliation_provider_external ON payment_reconciliations (provider, external_id)`,
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS voice_profiles (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      presentation TEXT DEFAULT 'female' NOT NULL,
      provider TEXT DEFAULT 'elevenlabs' NOT NULL,
      provider_voice_id TEXT,
      model_id TEXT,
      default_language TEXT DEFAULT 'hi-IN' NOT NULL,
      allowed_languages_json TEXT DEFAULT '["hi-IN","en-IN","hinglish"]' NOT NULL,
      auto_language_switch INTEGER DEFAULT 1 NOT NULL,
      accent_profile TEXT DEFAULT 'indian_neutral' NOT NULL,
      speaking_rate TEXT DEFAULT 'normal' NOT NULL,
      style TEXT DEFAULT 'warm' NOT NULL,
      provider_policy TEXT DEFAULT 'elevenlabs_first' NOT NULL,
      voice_lock INTEGER DEFAULT 0 NOT NULL,
      fallback_profile_id TEXT,
      status TEXT DEFAULT 'active' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
  ]);

  // Handoff routing columns, added separately for databases created before the
  // human-handoff engine shipped.
  for (const column of [
    'assigned_agent_id TEXT',
    'skill TEXT',
    'language TEXT',
    'queue_status TEXT',
    'ai_summary TEXT',
  ]) {
    try {
      await db.prepare(`ALTER TABLE handoffs ADD COLUMN ${column}`).run();
    } catch {
      /* column already present */
    }
  }

  // A voice scheduled for removal by the provider: the agents bound to it go
  // silent when it disappears, so the profile must carry the warning.
  await ensureColumn(db, 'voice_profiles', 'removal_notice_at', 'TEXT');
  await ensureColumn(db, 'voice_profiles', 'removal_reason', 'TEXT');

  // Platform admin sub-roles, so tenant-destructive actions are deliberate.
  await ensureColumn(db, 'app_users', 'admin_role', 'TEXT');
  // Backfill once, so `adminRole()` can fail closed. Admins that existed before
  // sub-roles keep everything they had; a null column afterwards means the role
  // was never granted, and is answered with read-only rather than everything.
  await db
    .prepare(
      `UPDATE app_users SET admin_role = 'super_admin'
        WHERE role = 'platform_admin' AND admin_role IS NULL`,
    )
    .run();
  // `tools_json` was decorative until now: the studio wrote a list, the list
  // was stored, and every turn handed the model all fifteen tools regardless.
  // Making it filter is correct — and it turns the studio's typo into a real
  // loss, because the picker wrote `transfer_human` and the tool is called
  // `transfer_to_human`. Every agent in the product carries the wrong name, so
  // it is repaired here rather than being read as "this workspace switched
  // transfer off". `send_email` and `create_ticket` are dropped: they never had
  // a definition or a handler, so there is no behaviour to keep.
  await db
    .prepare(
      `UPDATE voice_agents
         SET tools_json = replace(tools_json, '"transfer_human"', '"transfer_to_human"')
       WHERE tools_json LIKE '%"transfer_human"%'`,
    )
    .run();
  await db
    .prepare(
      `UPDATE voice_agents
         SET tools_json = replace(
               replace(tools_json, '"send_email",', ''), '"create_ticket",', '')
       WHERE tools_json LIKE '%"send_email"%' OR tools_json LIKE '%"create_ticket"%'`,
    )
    .run();
  // `agent_tool_calls.ok` is the tool's reply to the model — "there is no such
  // customer" is a legitimate `ok: false`. Nothing read the column, so nothing
  // noticed it was also being used as a health signal: `lookup_customer` read
  // as 13 calls and 0 successes while working correctly every time. This column
  // records what the call *was*, so a negative answer stops looking like a bug.
  // §14's grace window. Recorded per account and started the first time the
  // account is seen needing a second factor, so switching enforcement on does
  // not lock out everybody who was mid-work when it deployed.
  await ensureColumn(db, 'user_security_settings', 'mfa_grace_until', 'TEXT');
  await ensureColumn(db, 'agent_tool_calls', 'outcome_kind', 'TEXT');

  // The visual workflow builder (§7). `steps_json` held a flat list of step
  // names for the old executor, which marked every step complete without
  // running it. The graph lives in its own column so a workflow authored
  // under the old shape stays readable instead of being silently reinterpreted
  // as something it never was.
  await ensureColumn(db, 'workflows', 'graph_json', 'TEXT');
  await ensureColumn(db, 'workflows', 'description', 'TEXT');
  await ensureColumn(db, 'workflows', 'template_key', 'TEXT');
  // A run carries its own variables, and can be parked mid-graph waiting for
  // an approval, so it needs to remember where to pick up.
  await ensureColumn(
    db,
    'workflow_runs',
    'variables_json',
    "TEXT DEFAULT '{}' NOT NULL",
  );
  await ensureColumn(db, 'workflow_runs', 'resume_node', 'TEXT');
  await ensureColumn(db, 'workflow_runs', 'waiting_on', 'TEXT');
  await ensureColumn(db, 'workflow_runs', 'error', 'TEXT');
  await ensureColumn(db, 'workflow_runs', 'call_id', 'TEXT');
  await ensureColumn(db, 'workflow_run_steps', 'node_id', 'TEXT');
  await ensureColumn(db, 'workflow_run_steps', 'branch', 'TEXT');

  // Scheduled reports (§6): who receives one, and what actually happened to
  // the delivery. `sandbox` has to be distinguishable from `sent`, or a
  // workspace will believe its Monday report is landing in an inbox.
  await ensureColumn(
    db,
    'report_definitions',
    'recipients_json',
    "TEXT DEFAULT '[]'",
  );
  await ensureColumn(db, 'report_runs', 'delivery_state', 'TEXT');
  await ensureColumn(db, 'report_runs', 'delivered_to', 'TEXT');

  // What an outbound campaign says it is (§19). Without this every campaign
  // opened with the agent's single welcome_message, so a recruitment call and
  // a payment reminder from the same workspace introduced themselves
  // identically.
  await ensureColumn(db, 'campaigns', 'opening_json', "TEXT DEFAULT '{}'");
  // Contacts whose personalisation could not be built and fell back. Recorded
  // so a campaign degrading for every contact is visible rather than assumed
  // to be working.
  await ensureColumn(
    db,
    'campaigns',
    'opening_degraded',
    'INTEGER DEFAULT 0 NOT NULL',
  );

  // A callback is a promise made out loud to a person. It was created and
  // then abandoned: no status ever moved, nobody owned it, and after a week
  // nobody could tell which had been called.
  await ensureColumn(db, 'callback_requests', 'claimed_by', 'TEXT');
  await ensureColumn(db, 'callback_requests', 'claimed_at', 'TEXT');
  await ensureColumn(db, 'callback_requests', 'resolved_by', 'TEXT');
  await ensureColumn(db, 'callback_requests', 'resolved_at', 'TEXT');
  await ensureColumn(
    db,
    'callback_requests',
    'attempts',
    'INTEGER DEFAULT 0 NOT NULL',
  );
  await ensureColumn(db, 'callback_requests', 'outcome_note', 'TEXT');

  // An appointment used to be write-only: booked, and then invisible. These
  // are the columns that let a person work it — whether the customer was ever
  // told, whether they were reminded, and how it actually went.
  await ensureColumn(
    db,
    'appointments',
    'timezone',
    "TEXT DEFAULT 'Asia/Kolkata' NOT NULL",
  );
  await ensureColumn(db, 'appointments', 'confirmed_at', 'TEXT');
  await ensureColumn(db, 'appointments', 'confirmation_message_id', 'TEXT');
  await ensureColumn(db, 'appointments', 'reminded_at', 'TEXT');
  await ensureColumn(db, 'appointments', 'reminder_message_id', 'TEXT');
  await ensureColumn(db, 'appointments', 'outcome_note', 'TEXT');
  await ensureColumn(db, 'appointments', 'updated_by', 'TEXT');
  await ensureColumn(db, 'appointments', 'updated_at', 'TEXT');

  // Who closed a flagged quality review, and when. The screen counted open
  // findings and nothing could ever close one.
  await ensureColumn(db, 'call_quality_reviews', 'reviewed_by', 'TEXT');
  await ensureColumn(db, 'call_quality_reviews', 'reviewed_at', 'TEXT');
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_appointments_org_slot ON appointments (organization_id, status, slot_start)`,
    )
    .run();

  // The rest of the Campaign Opening Studio (Part 2.2): how the opening is
  // pitched, the variants being compared, and what counts as qualified.
  await ensureColumn(
    db,
    'campaigns',
    'opening_style',
    "TEXT DEFAULT 'standard'",
  );
  await ensureColumn(db, 'campaigns', 'variants_json', "TEXT DEFAULT '[]'");
  await ensureColumn(
    db,
    'campaigns',
    'qualification_json',
    "TEXT DEFAULT '{}'",
  );
  // Which opening a contact was given, so a redial keeps the same one and the
  // result can be read per variant afterwards.
  await ensureColumn(db, 'campaign_contacts', 'variant_key', 'TEXT');

  // Every publish of an agent, kept so a change can be undone (Part 2.1).
  // Editing used to overwrite in place: there was no way back to what the
  // agent said yesterday, and no record that anything had changed.
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS agent_versions (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES voice_agents(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      note TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`)
    .run();
  await db
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_versions_number ON agent_versions (agent_id, version)`,
    )
    .run();

  // Documents that arrive from outside (Part 3). WhatsApp is the transport;
  // the business copy lives in our own storage, because provider media is not
  // guaranteed to stay fetchable.
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS document_inbox (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      contact_phone TEXT,
      lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
      source TEXT DEFAULT 'whatsapp' NOT NULL,
      provider_media_id TEXT,
      document_type TEXT DEFAULT 'unclassified' NOT NULL,
      filename TEXT,
      mime_type TEXT,
      size_bytes INTEGER DEFAULT 0 NOT NULL,
      checksum TEXT,
      storage_key TEXT,
      status TEXT DEFAULT 'new' NOT NULL,
      rejection_reason TEXT,
      association_type TEXT,
      association_id TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      retention_until TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`)
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_document_inbox_org ON document_inbox (organization_id, status, created_at)`,
    )
    .run();
  // One row per provider media id, so a redelivered webhook does not file the
  // same Aadhaar card twice.
  await db
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_document_inbox_media ON document_inbox (organization_id, provider_media_id)`,
    )
    .run();
  // Asking for a document, rather than telling a customer to use a link that
  // was never generated. Only the token's hash is kept: the customer has no
  // account, so the token is the whole credential.
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS document_requests (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      document_label TEXT NOT NULL,
      contact_phone TEXT,
      lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
      association_type TEXT,
      association_id TEXT,
      status TEXT DEFAULT 'open' NOT NULL,
      attempts INTEGER DEFAULT 0 NOT NULL,
      expires_at TEXT,
      document_id TEXT REFERENCES document_inbox(id) ON DELETE SET NULL,
      fulfilled_at TEXT,
      requested_by TEXT,
      source TEXT DEFAULT 'manual' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`)
    .run();
  await db
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_document_requests_token ON document_requests (token_hash)`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_document_requests_org ON document_requests (organization_id, status, created_at)`,
    )
    .run();
  // What an agent actually sent, to whom, and which of it was held back.
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS whatsapp_sends (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      session_id TEXT,
      agent_id TEXT,
      destination TEXT NOT NULL,
      sent_json TEXT DEFAULT '[]' NOT NULL,
      withheld_json TEXT DEFAULT '[]' NOT NULL,
      status TEXT DEFAULT 'queued' NOT NULL,
      provider_reference TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`)
    .run();
  // Conversation inbox for inbound WhatsApp text and media metadata. The
  // raw provider payload is never stored; only the tenant-scoped fields needed
  // for an agent to reply or link the message to a lead are retained.
  //
  // No `status` column: it was here, defaulted to 'received', and nothing ever
  // moved it — there is no screen yet from which a message could be read,
  // replied to or linked. A status nothing can change is decoration that reads
  // like a lifecycle. When the inbox screen lands it can add the column
  // together with the transitions that make it mean something.
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      phone_number_id TEXT NOT NULL,
      wa_message_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      sender_phone TEXT NOT NULL,
      message_type TEXT NOT NULL,
      body TEXT,
      media_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`)
    .run();
  await db
    .prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_messages_provider_id
      ON whatsapp_messages (phone_number_id, wa_message_id)`)
    .run();
  await db
    .prepare(`CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_inbox
      ON whatsapp_messages (organization_id, created_at)`)
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_whatsapp_sends_org ON whatsapp_sends (organization_id, created_at)`,
    )
    .run();
  // Which media an agent may release without a person (Part 3.1).
  await ensureColumn(db, 'voice_agents', 'send_policy_json', 'TEXT');

  // The embeddable web voice widget (§8). `allowed_origins_json` and the two
  // caps are not configuration niceties: this widget is reachable by a public
  // endpoint that starts calls, and those three columns are what stands
  // between it and somebody emptying a customer's wallet with curl.
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS web_widgets (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      agent_id TEXT REFERENCES voice_agents(id) ON DELETE SET NULL,
      public_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'paused' NOT NULL,
      allowed_origins_json TEXT DEFAULT '[]' NOT NULL,
      modes_json TEXT DEFAULT '["voice","callback"]' NOT NULL,
      branding_json TEXT DEFAULT '{}' NOT NULL,
      daily_cap INTEGER DEFAULT 200 NOT NULL,
      hourly_cap INTEGER DEFAULT 40 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`)
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_web_widgets_org ON web_widgets (organization_id, status)`,
    )
    .run();
  // Every attempt, allowed or refused, with the reason. A widget that stopped
  // answering must be diagnosable without guessing, and a refusal nobody
  // recorded is a support ticket with no evidence in it.
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS web_widget_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      widget_id TEXT NOT NULL REFERENCES web_widgets(id) ON DELETE CASCADE,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      call_id TEXT,
      lead_id TEXT,
      mode TEXT NOT NULL,
      origin TEXT,
      outcome TEXT DEFAULT 'started' NOT NULL,
      refusal_code TEXT,
      page_url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`)
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_web_widget_sessions ON web_widget_sessions (widget_id, created_at)`,
    )
    .run();

  // Mined playbooks (§13.1). Entries start as proposals: §13.1 puts "Human
  // reviews" between the mining and any use of it, and nothing here reaches a
  // live call until somebody approves that row.
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS playbooks (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      status TEXT DEFAULT 'proposed' NOT NULL,
      calls_read INTEGER DEFAULT 0 NOT NULL,
      won_count INTEGER DEFAULT 0 NOT NULL,
      lost_count INTEGER DEFAULT 0 NOT NULL,
      blocked TEXT,
      excluded_json TEXT DEFAULT '[]' NOT NULL,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`)
    .run();
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS playbook_entries (
      id TEXT PRIMARY KEY NOT NULL,
      playbook_id TEXT NOT NULL REFERENCES playbooks(id) ON DELETE CASCADE,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      section TEXT NOT NULL,
      content TEXT NOT NULL,
      evidence TEXT DEFAULT '' NOT NULL,
      won_calls INTEGER DEFAULT 0 NOT NULL,
      lost_calls INTEGER DEFAULT 0 NOT NULL,
      confidence TEXT DEFAULT 'low' NOT NULL,
      status TEXT DEFAULT 'proposed' NOT NULL,
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`)
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_playbook_entries_org ON playbook_entries (organization_id, status)`,
    )
    .run();

  // The two demo workflows above are INSERT OR IGNORE, so a database seeded by
  // the earlier build still holds their invented step lists and run counts.
  // Repair those rows only — never a workflow somebody wrote.
  // Counters *and* the graph. Resetting the invented run counts without
  // writing the graph left both rows saying "0 steps · needs rebuilding" on a
  // database seeded by the earlier build — repaired halfway is still broken.
  for (const [id, graph] of [
    ['workflow_demo_payment', DEMO_PAYMENT_GRAPH],
    ['workflow_demo_no_answer', DEMO_NO_ANSWER_GRAPH],
  ] as const)
    await db
      .prepare(
        `UPDATE workflows SET run_count = 0, failure_count = 0, last_run_at = NULL,
         trigger_type = 'webhook', steps_json = '[]', graph_json = ?
         WHERE id = ? AND (graph_json IS NULL OR graph_json = '')`,
      )
      .bind(graph, id)
      .run();
  await db
    .prepare(
      `UPDATE agent_tool_calls SET outcome_kind = CASE
         WHEN ok = 1 THEN 'succeeded'
         WHEN error_message IN ('not_found','no_slots','no_availability',
              'insufficient_inventory','already_exists','nothing_to_cancel',
              'out_of_stock','not_eligible') THEN 'answered_no'
         WHEN error_message IN ('invalid_phone','invalid_amount','invalid_input',
              'missing_field','invalid_date') THEN 'rejected_input'
         ELSE 'failed' END
       WHERE outcome_kind IS NULL`,
    )
    .run();
  await ensureColumn(db, 'organizations', 'suspended_at', 'TEXT');
  await ensureColumn(db, 'organizations', 'suspension_reason', 'TEXT');

  // Place agents in the org structure.
  await ensureColumn(db, 'support_agents', 'branch_id', 'TEXT');
  // §19: a workspace may require a passing device test before an agent may go
  // Available. Off by default — it must be opted into, not sprung on people.
  await ensureColumn(
    db,
    'organization_settings',
    'require_device_test',
    'INTEGER DEFAULT 0 NOT NULL',
  );
  await ensureColumn(
    db,
    'organization_settings',
    'device_test_valid_hours',
    'INTEGER DEFAULT 12 NOT NULL',
  );
  await ensureColumn(db, 'support_agents', 'team_id', 'TEXT');
  await ensureColumn(db, 'support_agents', 'department_id', 'TEXT');

  // Routing needs presence timing (longest-idle) and a queue binding.
  await ensureColumn(db, 'support_agents', 'last_assigned_at', 'TEXT');
  await ensureColumn(db, 'support_agents', 'presence_changed_at', 'TEXT');
  await ensureColumn(
    db,
    'support_agents',
    'max_concurrent_calls',
    'INTEGER DEFAULT 1 NOT NULL',
  );
  await ensureColumn(db, 'handoffs', 'queue_id', 'TEXT');
  // VPS/local Worker databases can begin from the legacy bootstrap without
  // Drizzle migrations having run. Create the reservation table here as well
  // so rate limiting, admin mutations and realtime calls do not fail merely
  // because migration 0009 was not applied by an external hosting platform.
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS realtime_reservations (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES voice_agents(id) ON DELETE CASCADE,
      request_hash TEXT NOT NULL,
      unit TEXT DEFAULT 'realtime_session_v1' NOT NULL,
      credits INTEGER DEFAULT 10 NOT NULL,
      status TEXT NOT NULL,
      provider_reference TEXT,
      error_code TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`)
    .run();
  await ensureColumn(db, 'realtime_reservations', 'last_heartbeat_at', 'TEXT');
  // Who is answering which WhatsApp conversation. Keyed by the customer's
  // number rather than by a message, because a conversation is the thing a
  // person picks up — and a new message must not silently unassign it.
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS whatsapp_assignments (
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      phone TEXT NOT NULL,
      support_agent_id TEXT REFERENCES support_agents(id) ON DELETE SET NULL,
      assigned_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      PRIMARY KEY (organization_id, phone)
    )`)
    .run();

  // Approved message templates — the only thing WhatsApp accepts once the
  // 24-hour window has closed. Kept per workspace and keyed by (name,
  // language) the way Meta keys them, because the same template exists once
  // per language and sending picks one of those, not one of these rows.
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS whatsapp_templates (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      language TEXT DEFAULT 'en' NOT NULL,
      category TEXT DEFAULT 'UTILITY' NOT NULL,
      header TEXT,
      body TEXT NOT NULL,
      footer TEXT,
      status TEXT DEFAULT 'draft' NOT NULL,
      provider_id TEXT,
      rejected_reason TEXT,
      submitted_at TEXT,
      synced_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      UNIQUE (organization_id, name, language)
    )`)
    .run();
  // What visitors are actually being served, as a snapshot taken when
  // somebody pressed publish. Before this a form had one copy of itself, so
  // editing a published popup rewrote the running form keystroke by keystroke.
  await ensureColumn(db, 'lead_forms', 'published_fields_json', 'TEXT');
  await ensureColumn(db, 'lead_forms', 'published_settings_json', 'TEXT');
  await ensureColumn(db, 'lead_forms', 'published_domains_json', 'TEXT');
  await ensureColumn(db, 'lead_forms', 'published_version', 'INTEGER');
  // Forms that were already live have no snapshot, and without this they
  // would go dark the moment this ships. Their current configuration is what
  // visitors are being served, so that is exactly the snapshot to take.
  await db
    .prepare(`UPDATE lead_forms
      SET published_fields_json = fields_json,
          published_settings_json = settings_json,
          published_domains_json = allowed_domains_json,
          published_version = version
      WHERE status = 'active' AND published_fields_json IS NULL`)
    .run();

  // Flows — a form the customer fills in without leaving WhatsApp. Defined
  // here, published at Meta, answered on the customer's phone.
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS whatsapp_flows (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      cta_label TEXT DEFAULT 'Open form' NOT NULL,
      screens_json TEXT NOT NULL,
      status TEXT DEFAULT 'draft' NOT NULL,
      provider_id TEXT,
      error TEXT,
      published_at TEXT,
      synced_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      UNIQUE (organization_id, name)
    )`)
    .run();
  // One row per send, so the answers that come back can be matched to the flow
  // that asked and the person who was asked. The token is what Meta echoes.
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS whatsapp_flow_responses (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      flow_id TEXT REFERENCES whatsapp_flows(id) ON DELETE SET NULL,
      flow_token TEXT NOT NULL,
      phone TEXT NOT NULL,
      status TEXT DEFAULT 'sent' NOT NULL,
      answers_json TEXT,
      sent_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      answered_at TEXT,
      UNIQUE (organization_id, flow_token)
    )`)
    .run();
  // Every workspace needs somewhere for a WhatsApp form's answers to land.
  // Without this, an existing organisation's first filled-in form fails on
  // "Lead source is not configured" — after the customer has already answered.
  await db
    .prepare(`INSERT INTO lead_sources (id, organization_id, type, name, status)
      SELECT 'src_wa_' || o.id, o.id, 'whatsapp', 'WhatsApp Form', 'connected'
      FROM organizations o
      WHERE NOT EXISTS (
        SELECT 1 FROM lead_sources s
        WHERE s.organization_id = o.id AND s.type = 'whatsapp'
      )`)
    .run();
  await ensureColumn(db, 'handoffs', 'call_id', 'TEXT');
  await ensureColumn(db, 'handoffs', 'enqueued_at', 'TEXT');
  await ensureColumn(db, 'handoffs', 'accepted_at', 'TEXT');
  await ensureColumn(db, 'handoffs', 'disposition', 'TEXT');
  await ensureColumn(db, 'handoffs', 'disposition_notes', 'TEXT');

  // Distinguish real telephony from playground conversations in call history.
  await ensureColumn(
    db,
    'call_records',
    'channel',
    "TEXT DEFAULT 'phone' NOT NULL",
  );
  await ensureColumn(db, 'call_records', 'intelligence_status', 'TEXT');
  // Carrier's own call id, used to make an inbound webhook retry idempotent.
  await ensureColumn(db, 'call_records', 'provider_reference', 'TEXT');
  // Which campaign contact this call was placed for.
  //
  // A campaign's audience lives in `campaign_contacts`; a call lives in
  // `call_records`; and until now the only thing joining them was the lead id,
  // which is null for an imported phone number. So a campaign could not be told
  // how one of its own calls ended — which is exactly why the dialer refused to
  // place them: a contact who answered would be dialled again on the next
  // backoff, because nothing could mark them done.
  await ensureColumn(db, 'call_records', 'campaign_contact_id', 'TEXT');
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_call_records_campaign_contact ON call_records (campaign_contact_id)`,
    )
    .run();
  // The other direction, so the campaign screen can open the call it made.
  await ensureColumn(db, 'campaign_contacts', 'last_call_id', 'TEXT');
  // The WebRTC capability probe's findings (§6), stored beside the HTTP
  // measurements rather than mixed into them: they answer different questions.
  await ensureColumn(db, 'device_test_runs', 'webrtc_json', 'TEXT');
  // §26: the platform's base currency and each workspace's own.
  await ensureColumn(db, 'organizations', 'currency', "TEXT DEFAULT 'INR'");
  await ensureColumn(
    db,
    'organization_settings',
    'fx_markup_percent',
    'REAL DEFAULT 0',
  );
  await ensureColumn(
    db,
    'organization_settings',
    'price_rounding',
    "TEXT DEFAULT 'none'",
  );
  // §27-28: what a usage event actually consumed and cost. `units` existed and
  // was hardcoded to 1; the rest is what makes a margin figure possible.
  await ensureColumn(db, 'provider_usage_events', 'model', 'TEXT');
  await ensureColumn(db, 'provider_usage_events', 'unit', 'TEXT');
  await ensureColumn(db, 'provider_usage_events', 'rate_card_id', 'TEXT');
  await ensureColumn(db, 'provider_usage_events', 'cost_currency', 'TEXT');
  await ensureColumn(
    db,
    'provider_usage_events',
    'base_cost_micros',
    'INTEGER',
  );
  await ensureColumn(db, 'provider_usage_events', 'fx_rate', 'REAL');
  // Distinguishes "this was free" from "we could not price it" — the old
  // metering could only produce the second, and reported it as the first.
  await ensureColumn(
    db,
    'provider_usage_events',
    'unpriced',
    'INTEGER DEFAULT 0',
  );
  // Rows written before metering existed have no `unit` — the old code
  // hardcoded units = 1 and cost = 0 for every provider call. They are unpriced
  // by definition, and leaving them at the column default of 0 would report a
  // 99.99% gross margin from a cost base that is almost entirely missing.
  await db
    .prepare(
      `UPDATE provider_usage_events SET unpriced = 1
        WHERE unit IS NULL AND coalesce(provider_cost_micros, 0) = 0`,
    )
    .run();
  await ensureColumn(db, 'call_records', 'cost_micros', 'INTEGER');
  // §26: an invoice records the rate it used, or its total cannot be audited.
  await ensureColumn(db, 'invoices', 'fx_rate', 'REAL');
  await ensureColumn(db, 'invoices', 'base_currency', 'TEXT');
  await ensureColumn(db, 'invoices', 'base_total', 'INTEGER');
  // §27: what an invoice has to carry to be an invoice.
  await ensureColumn(db, 'invoices', 'sequence_number', 'INTEGER');
  await ensureColumn(db, 'invoices', 'financial_year', 'TEXT');
  await ensureColumn(db, 'invoices', 'tax_kind', 'TEXT');
  await ensureColumn(db, 'invoices', 'cgst', 'INTEGER DEFAULT 0');
  await ensureColumn(db, 'invoices', 'sgst', 'INTEGER DEFAULT 0');
  await ensureColumn(db, 'invoices', 'igst', 'INTEGER DEFAULT 0');
  await ensureColumn(db, 'invoices', 'tax_note', 'TEXT');
  await ensureColumn(db, 'invoices', 'supplier_gstin', 'TEXT');
  await ensureColumn(db, 'invoices', 'customer_gstin', 'TEXT');
  await ensureColumn(db, 'invoices', 'place_of_supply', 'TEXT');
  // Billing identity of the workspace being invoiced.
  await ensureColumn(db, 'organization_settings', 'gstin', 'TEXT');
  // §30: a short code the customer can quote, so a ticket and a call can be
  // found without anyone reading out a UUID.
  await ensureColumn(db, 'support_tickets', 'diagnostic_code', 'TEXT');
  // §32: a prebuilt library voice and a cloned one carry very different
  // obligations, so the profile has to say which it is.
  await ensureColumn(db, 'voice_profiles', 'kind', "TEXT DEFAULT 'prebuilt'");
  // The Super Admin kill switch.
  await ensureColumn(
    db,
    'voice_profiles',
    'platform_blocked',
    'INTEGER DEFAULT 0',
  );
  await ensureColumn(db, 'voice_profiles', 'platform_block_reason', 'TEXT');
  await ensureColumn(db, 'organization_settings', 'legal_name', 'TEXT');
  await ensureColumn(db, 'organization_settings', 'billing_state', 'TEXT');
  await ensureColumn(
    db,
    'organization_settings',
    'billing_country',
    "TEXT DEFAULT 'IN'",
  );
  // Sequence numbers must be unbroken *within a series*, not globally.
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS invoice_sequences (
        series TEXT NOT NULL,
        financial_year TEXT NOT NULL,
        next_value INTEGER DEFAULT 1 NOT NULL,
        PRIMARY KEY (series, financial_year)
      )`,
    )
    .run();

  // §13: seed the reference rate cards once, so the cost engine has somewhere
  // to start. They are versioned rows an operator edits, not constants —
  // INSERT OR IGNORE means a hand-corrected price is never overwritten by a
  // later boot.
  for (const card of SEED_RATE_CARDS) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO provider_rate_cards
          (id, provider, model, category, unit, price_micros, currency,
           effective_from, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        `rate_${card.provider}_${card.model ?? 'any'}_${card.unit}`
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, '_'),
        card.provider,
        card.model,
        card.category,
        card.unit,
        card.priceMicros,
        card.currency,
        card.effectiveFrom,
        card.source ?? null,
      )
      .run();
  }
  // Customer-facing usage prices are separate from provider cost cards. The
  // defaults are seeded once and then editable from the admin panel, so pricing
  // changes never require an ENV change or deploy.
  for (const rate of CUSTOMER_USAGE_RATES) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO customer_usage_rates
          (id, category, operation, label, unit, credits, cost_basis,
           customer_note, margin_note, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      )
      .bind(
        rate.id,
        rate.category,
        rate.operation,
        rate.label,
        rate.unit,
        rate.credits,
        rate.costBasis,
        rate.customerNote,
        rate.marginNote,
      )
      .run();
  }
  // Update only unchanged seeded descriptions for the BYO-carrier model.
  // Never reset an admin's prices, status, or customized text on startup.
  const oldUsageCopy = [
    [
      'call_inbound_minute',
      'Carrier inbound minute + media gateway',
      'Charged per started minute after the call connects.',
      'Keep above carrier minute + STT/TTS pass-through exposure.',
    ],
    [
      'call_outbound_minute',
      'Carrier outbound minute + dialing control',
      'Charged per started minute after answer.',
      'Higher than inbound because outbound carrier rates vary more.',
    ],
    [
      'ai_voice_minute',
      'Deepgram/Sarvam STT + LLM + Cartesia/ElevenLabs TTS',
      'Charged while the AI is actively listening or speaking.',
      'Main margin line; tune after real provider invoices.',
    ],
  ];
  for (const [id, oldCost, oldNote, oldMargin] of oldUsageCopy) {
    const current = CUSTOMER_USAGE_RATES.find((rate) => rate.id === id)!;
    await db
      .prepare(
        `UPDATE customer_usage_rates SET cost_basis = ?, customer_note = ?, margin_note = ? WHERE id = ? AND cost_basis = ? AND customer_note = ? AND margin_note = ?`,
      )
      .bind(
        current.costBasis,
        current.customerNote,
        current.marginNote,
        id,
        oldCost,
        oldNote,
        oldMargin,
      )
      .run();
  }
  // §15: nothing on the platform is 'platform_provided' any more — the rented
  // number path is gone, so a row still claiming it would describe a number
  // nobody owns.
  await db
    .prepare(
      `UPDATE phone_numbers SET acquisition_type = 'bring_your_own', monthly_rental = 0
        WHERE acquisition_type = 'platform_provided'`,
    )
    .run();
  // One vocabulary for call outcomes (lib/call-outcomes.ts). Lifecycle values
  // had been written into the outcome column alongside the intelligence job's
  // own set, and two screens each counted conversions from a different guess at
  // which was which. Existing rows are mapped once; `unknown` means the call was
  // never analysed, which is not the same as "nothing happened".
  await db
    .prepare(
      `UPDATE call_records SET outcome = CASE
         WHEN outcome IN ('resolved','information_provided','appointment_booked',
           'payment_link_sent','callback_scheduled','transferred_to_human',
           'not_interested','incomplete','unknown') THEN outcome
         WHEN outcome IN ('completed','in_progress','dialing','enqueue',
           'qualifying','payment_link_requested') THEN 'unknown'
         WHEN outcome = 'abandoned' THEN 'incomplete'
         WHEN outcome IN ('callback','callback_requested') THEN 'callback_scheduled'
         WHEN outcome = 'transferred' THEN 'transferred_to_human'
         WHEN outcome = 'converted' THEN 'resolved'
         WHEN outcome IS NULL OR trim(outcome) = '' THEN 'unknown'
         ELSE 'incomplete' END`,
    )
    .run();
  // Added after the table shipped: a database created by the earlier build has
  // call_transport_stats without this column, and CREATE TABLE IF NOT EXISTS
  // will not add it.
  await ensureColumn(
    db,
    'call_transport_stats',
    'longest_silence_ms',
    'INTEGER',
  );

  // Bind an agent to a voice profile. Added separately because the column may
  // already exist on databases created before voice profiles shipped.
  try {
    await db
      .prepare(`ALTER TABLE voice_agents ADD COLUMN voice_profile_id TEXT`)
      .run();
  } catch {
    /* column already present */
  }

  if (process.env.NODE_ENV !== 'production') {
    await seedLocalDemo(db);
  }

  // Platform reference rows are required in every environment. They are not
  // demo/customer data: the admin provider screens and OAuth configuration
  // update these stable records in production as well.
  await seedPlatformReferenceCatalog(db);
  await removeLegacyCustomerPlatformIntegrations(db);

  await db.prepare('PRAGMA optimize').run();
  await publishCommercialCatalog(db);
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS schema_bootstrap_state (
      id TEXT PRIMARY KEY NOT NULL,
      version INTEGER NOT NULL,
      completed_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`)
    .run();
  await db
    .prepare(`INSERT INTO schema_bootstrap_state (id, version, completed_at)
      VALUES ('primary', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET version = excluded.version,
        completed_at = CURRENT_TIMESTAMP`)
    .bind(SCHEMA_BOOTSTRAP_VERSION)
    .run();
}

async function seedPlatformReferenceCatalog(db: D1Database) {
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO auth_provider_settings
      (provider, display_name, button_visible, enabled, status, public_config_json)
      VALUES ('google', 'Google', 1, 0, 'admin_disabled', '{"required":["GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","GOOGLE_REDIRECT_URI"]}')`),
    db.prepare(`INSERT OR IGNORE INTO auth_provider_settings
      (provider, display_name, button_visible, enabled, status)
      VALUES ('microsoft', 'Microsoft', 0, 0, 'not_configured')`),
    db.prepare(`INSERT OR IGNORE INTO auth_provider_settings
      (provider, display_name, button_visible, enabled, status, public_config_json)
      VALUES ('github', 'GitHub', 0, 0, 'hidden', '{"required":["GITHUB_CLIENT_ID","GITHUB_CLIENT_SECRET"]}')`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_sarvam', 'Sarvam AI', 'Call Vani Voice India', 'speech',
       '["SARVAM_API_KEY"]', 'required_for_live', 'not_connected', 'Indic STT, TTS and realtime voice', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_deepgram', 'Deepgram', 'Call Vani Speech Intelligence', 'speech',
       '["DEEPGRAM_API_KEY"]', 'optional', 'not_connected', 'Realtime speech recognition and voice-agent audio', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_elevenlabs', 'ElevenLabs API', 'Call Vani Voice Global', 'speech',
       '["ELEVENLABS_API_KEY","ELEVENLABS_VOICE_ID"]', 'optional', 'not_connected', 'Multilingual low-latency speech and streaming output', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_cartesia', 'Cartesia AI', 'Call Vani Sonic Voice', 'speech',
       '["CARTESIA_API_KEY","CARTESIA_VOICE_ID","CARTESIA_MODEL"]', 'optional', 'not_connected', 'Low-latency premium realtime voices', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_email', 'Resend / SMTP', 'Call Vani Mail', 'email',
       '["EMAIL_PROVIDER","RESEND_API_KEY","SMTP_HOST","SMTP_PORT","SMTP_USERNAME","SMTP_PASSWORD","EMAIL_FROM"]', 'optional', 'not_connected', 'Transactional email and account notifications', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_google_oauth', 'Google OAuth', 'Google sign-in', 'identity',
       '["GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","GOOGLE_REDIRECT_URI"]', 'planned', 'admin_disabled', 'Customer account sign-in', 1)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_vobiz', 'Vobiz', 'Call Vani Numbers · Vobiz', 'telephony',
       '["VOBIZ_AUTH_ID","VOBIZ_AUTH_TOKEN","VOBIZ_BASE_URL"]', 'optional', 'not_connected', 'Customer-owned numbers, calls and status webhooks', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_razorpay', 'Razorpay', 'Call Vani Payments · Razorpay', 'payments',
       '["RAZORPAY_KEY_ID","RAZORPAY_KEY_SECRET","RAZORPAY_WEBHOOK_SECRET"]', 'optional', 'not_connected', 'India checkout, subscriptions and signed webhooks', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_stripe', 'Stripe', 'Call Vani Payments · Stripe', 'payments',
       '["STRIPE_SECRET_KEY","STRIPE_WEBHOOK_SECRET"]', 'optional', 'not_connected', 'International checkout, subscriptions and signed webhooks', 0)`),
  ]);
}

async function seedLocalDemo(db: D1Database) {
  // Demo credentials must never be committed. A production database is seeded
  // through the secure runtime environment, while existing accounts are left
  // untouched by the INSERT OR IGNORE statements below.
  const adminPassword = process.env.SEED_PLATFORM_ADMIN_PASSWORD;
  const ownerPassword = process.env.SEED_CUSTOMER_OWNER_PASSWORD;
  if (!adminPassword || !ownerPassword) {
    if (process.env.NODE_ENV === 'production') return;
    throw new Error(
      'Set SEED_PLATFORM_ADMIN_PASSWORD and SEED_CUSTOMER_OWNER_PASSWORD before seeding local demo accounts.',
    );
  }
  const adminHash = await hashSeedPassword(adminPassword, 'vaani-admin-local');
  const ownerHash = await hashSeedPassword(ownerPassword, 'vaani-owner-local');
  const demoMfaGraceUntil = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO organizations (id, slug, name, status)
      VALUES ('org_vaani_demo', 'sidharth-kumar-services', 'Sidharth Kumar · SaaS & Digital Services', 'active')`),
    db
      .prepare(`INSERT OR IGNORE INTO app_users
      (id, organization_id, name, email, password_hash, role, status)
      VALUES ('user_vaani_admin', NULL, 'Vaani Platform Admin', 'admin@vaani.local', ?, 'platform_admin', 'active')`)
      .bind(adminHash),
    db
      .prepare(`INSERT OR IGNORE INTO app_users
      (id, organization_id, name, email, password_hash, role, status)
      VALUES ('user_vaani_owner', 'org_vaani_demo', 'Sidharth Kumar', 'sidharthkumar2028@gmail.com', ?, 'customer_owner', 'active')`)
      .bind(ownerHash),
    db
      .prepare(`INSERT INTO user_security_settings
      (user_id, email_verified_at, mfa_enabled, mfa_grace_until, updated_at)
      VALUES ('user_vaani_admin', CURRENT_TIMESTAMP, 0, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        email_verified_at = COALESCE(user_security_settings.email_verified_at, CURRENT_TIMESTAMP),
        mfa_grace_until = CASE
          WHEN user_security_settings.mfa_enabled = 1 THEN user_security_settings.mfa_grace_until
          WHEN user_security_settings.mfa_grace_until IS NULL THEN excluded.mfa_grace_until
          WHEN user_security_settings.mfa_grace_until < CURRENT_TIMESTAMP THEN excluded.mfa_grace_until
          ELSE user_security_settings.mfa_grace_until
        END,
        updated_at = CURRENT_TIMESTAMP`)
      .bind(demoMfaGraceUntil),
    db
      .prepare(`INSERT INTO user_security_settings
      (user_id, email_verified_at, mfa_enabled, mfa_grace_until, updated_at)
      VALUES ('user_vaani_owner', CURRENT_TIMESTAMP, 0, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        email_verified_at = COALESCE(user_security_settings.email_verified_at, CURRENT_TIMESTAMP),
        mfa_grace_until = CASE
          WHEN user_security_settings.mfa_enabled = 1 THEN user_security_settings.mfa_grace_until
          WHEN user_security_settings.mfa_grace_until IS NULL THEN excluded.mfa_grace_until
          WHEN user_security_settings.mfa_grace_until < CURRENT_TIMESTAMP THEN excluded.mfa_grace_until
          ELSE user_security_settings.mfa_grace_until
        END,
        updated_at = CURRENT_TIMESTAMP`)
      .bind(demoMfaGraceUntil),
    db.prepare(`INSERT OR IGNORE INTO organization_members
      (id, organization_id, user_id, email, role)
      VALUES ('member_vaani_owner', 'org_vaani_demo', 'user_vaani_owner', 'sidharthkumar2028@gmail.com', 'admin')`),
    db.prepare(`INSERT OR IGNORE INTO lead_sources
      (id, organization_id, type, name, external_account_id, webhook_secret, status)
      VALUES ('source_demo_meta', 'org_vaani_demo', 'meta_ads', 'Meta Lead Ads', 'Awaiting OAuth', 'vaani-meta-local-verification', 'ready_for_credentials')`),
    db.prepare(`INSERT OR IGNORE INTO lead_sources
      (id, organization_id, type, name, external_account_id, webhook_secret, status)
      VALUES ('source_demo_google', 'org_vaani_demo', 'google_ads', 'Google Ads Lead Forms', 'Awaiting OAuth', 'vaani-google-local-verification', 'ready_for_credentials')`),
    db.prepare(`INSERT OR IGNORE INTO lead_sources
      (id, organization_id, type, name, status)
      VALUES ('source_demo_web', 'org_vaani_demo', 'website_form', 'Website Popup Form', 'connected')`),
    db.prepare(`INSERT OR IGNORE INTO lead_sources
      (id, organization_id, type, name, status)
      VALUES ('source_demo_manual', 'org_vaani_demo', 'manual', 'Manual / CSV', 'connected')`),
    db.prepare(`INSERT OR IGNORE INTO lead_sources
      (id, organization_id, type, name, status)
      VALUES ('source_demo_whatsapp', 'org_vaani_demo', 'whatsapp', 'WhatsApp Form', 'connected')`),
    db
      .prepare(`INSERT OR IGNORE INTO lead_forms
      (id, organization_id, name, public_key, fields_json, allowed_domains_json, status)
      VALUES ('form_demo_popup', 'org_vaani_demo', 'IT services consultation', 'form_sidharth_services', ?, '["http://localhost:3000"]', 'active')`)
      .bind(
        JSON.stringify([
          { key: 'name', label: 'Name', required: true },
          { key: 'phone', label: 'Phone', required: true },
          { key: 'email', label: 'Email', required: false },
          { key: 'productInterest', label: 'Interested in', required: false },
        ]),
      ),
    db.prepare(`INSERT OR IGNORE INTO plans
      (id, code, name, monthly_price, included_credits, max_agents, max_numbers, concurrency, features_json, status)
      VALUES ('plan_free', 'free', 'Free', 0, 100, 1, 1, 1, '["100 trial credits","1 AI agent","CRM lite","API sandbox"]', 'active')`),
    db.prepare(`INSERT OR IGNORE INTO plans
      (id, code, name, monthly_price, included_credits, max_agents, max_numbers, concurrency, features_json, status)
      VALUES ('plan_growth', 'growth', 'Growth', 799900, 10000, 5, 3, 10, '["10,000 credits","5 AI agents","Advanced CRM","API and webhooks","Retargeting"]', 'active')`),
    db.prepare(`INSERT OR IGNORE INTO plans
      (id, code, name, monthly_price, included_credits, max_agents, max_numbers, concurrency, features_json, status)
      VALUES ('plan_scale', 'scale', 'Scale', 2499900, 50000, 20, 10, 50, '["50,000 credits","20 AI agents","Priority routing","Custom retention","SLA support"]', 'active')`),
    db.prepare(`INSERT OR IGNORE INTO credit_packages
      (id, name, credits, amount, status)
      VALUES ('credits_1000', '1,000 credits', 1000, 99900, 'active')`),
    db.prepare(`INSERT OR IGNORE INTO credit_packages
      (id, name, credits, amount, status)
      VALUES ('credits_5000', '5,000 credits', 5000, 449900, 'active')`),
    db.prepare(`INSERT OR IGNORE INTO credit_packages
      (id, name, credits, amount, status)
      VALUES ('credits_20000', '20,000 credits', 20000, 1599900, 'active')`),
    db.prepare(`INSERT OR IGNORE INTO subscriptions
      (id, organization_id, plan_id, status, current_period_end)
      VALUES ('sub_demo_growth', 'org_vaani_demo', 'plan_growth', 'active', '2026-10-01T00:00:00.000Z')`),
    db.prepare(`INSERT OR IGNORE INTO organization_wallets
      (organization_id, balance, low_balance_threshold)
      VALUES ('org_vaani_demo', 28670, 2000)`),
    db.prepare(`INSERT OR IGNORE INTO credit_ledger
      (id, organization_id, type, amount, balance_after, reference_type, reference_id, description)
      VALUES ('credit_demo_grant', 'org_vaani_demo', 'grant', 10000, 28670, 'subscription', 'sub_demo_growth', 'Growth plan monthly grant')`),
    db.prepare(`INSERT OR IGNORE INTO credit_ledger
      (id, organization_id, type, amount, balance_after, reference_type, reference_id, description)
      VALUES ('credit_demo_topup', 'org_vaani_demo', 'purchase', 20000, 18670, 'invoice', 'invoice_demo_paid', 'Credit top-up')`),
    db.prepare(`INSERT OR IGNORE INTO credit_ledger
      (id, organization_id, type, amount, balance_after, reference_type, reference_id, description)
      VALUES ('credit_demo_usage', 'org_vaani_demo', 'usage', -1330, 28670, 'usage_batch', 'usage_august', 'AI calling usage')`),
    db.prepare(`INSERT OR IGNORE INTO invoices
      (id, organization_id, invoice_number, status, line_items_json, subtotal, tax, total, currency, issued_at, paid_at)
      VALUES ('invoice_demo_paid', 'org_vaani_demo', 'VAI-2026-0831', 'paid', '[{"description":"Growth plan","quantity":1,"amount":799900}]', 799900, 143982, 943882, 'INR', '2026-08-31T10:00:00.000Z', '2026-08-31T10:02:00.000Z')`),
    db.prepare(`INSERT OR IGNORE INTO phone_numbers
      (id, organization_id, phone_number, country, number_type, acquisition_type, public_provider_name, assigned_agent_name, direction, kyc_status, status, monthly_rental)
      VALUES ('number_demo_active', 'org_vaani_demo', '+918071582881', 'IN', 'local', 'bring_your_own', 'Vobiz', 'Aarohi · Services Sales', 'inbound_outbound', 'not_required', 'active', 0)`),
    db.prepare(`INSERT OR IGNORE INTO phone_numbers
      (id, organization_id, phone_number, country, number_type, acquisition_type, public_provider_name, assigned_agent_name, direction, kyc_status, status, monthly_rental)
      VALUES ('number_demo_byoc', 'org_vaani_demo', '+919876500001', 'IN', 'mobile', 'bring_your_own', 'Vaani Connect', 'Meera · Reception', 'inbound', 'approved', 'active', 0)`),
    db.prepare(`INSERT OR IGNORE INTO integration_connections
      (id, organization_id, type, name, status, public_config_json, last_checked_at)
      VALUES ('integration_demo_voice', 'org_vaani_demo', 'voice_engine', 'Vaani Voice', 'connected', '{"region":"India","languages":12}', CURRENT_TIMESTAMP)`),
    db.prepare(`INSERT OR IGNORE INTO integration_connections
      (id, organization_id, type, name, status, public_config_json)
      VALUES ('integration_demo_willow', 'org_vaani_demo', 'willow_custom', 'Willow / Custom HTTP', 'needs_documentation', '{"note":"Awaiting official calling API base URL and authentication scheme"}')`),
    db.prepare(`INSERT OR IGNORE INTO onboarding_profiles
      (organization_id, phone, use_case, primary_language, stage, completed_at)
      VALUES ('org_vaani_demo', '+917510020067', 'sales', 'hi-IN', 'complete', CURRENT_TIMESTAMP)`),
    db.prepare(`INSERT OR IGNORE INTO voice_agents
      (id, organization_id, name, use_case, status, welcome_message, system_prompt,
       primary_language, voice_name, intelligence_profile, temperature, max_tokens,
       endpointing_ms, interrupt_words, tools_json, extractions_json, calling_config_json,
       cost_per_minute)
      VALUES (
        'agent_demo_maya', 'org_vaani_demo', 'Aarohi', 'sales_development', 'active',
        'नमस्ते, मैं आरोही, सिद्धार्थ कुमार की AI assistant बोल रही हूँ। क्या अभी एक मिनट बात करना सुविधाजनक है?',
        'You are Sidharth Kumar''s consultative AI sales assistant for verified SaaS product development, custom portals, CRM and API integrations, AI calling workflows, websites, e-commerce, LMS, admin panels and digital marketing automation. Speak naturally in the caller''s Hindi, Hinglish or English. Ask permission to continue, discover the business problem one question at a time, and use only approved knowledge. Never invent clients, prices, guarantees, certifications or availability. Qualify the need, timeline and decision process, then offer a confirmed meeting or human transfer. Respect opt-outs immediately and never claim an action succeeded without a successful tool result.',
        'hi-IN', 'Vaani Tara', 'Vaani Sense Balanced', 20, 250, 250, 2,
        '["lookup_customer","create_lead","schedule_follow_up","book_appointment","transfer_to_human","end_call"]',
        '["language","intent","service_interest","business_problem","timeline","decision_process","next_action"]',
        '{"inbound":true,"outbound":true,"voicemailDetection":true,"silenceTimeoutSeconds":15,"maxCallSeconds":300,"callingWindow":"10:00-19:00 Asia/Kolkata"}',
        55
      )`),
    db.prepare(`INSERT OR IGNORE INTO payment_links
      (id, organization_id, agent_id, reference_id, customer_name, customer_phone,
       amount, currency, description, delivery_mode, scheduled_for, provider,
       short_url, status, provider_payload_json)
      VALUES ('payment_demo_cod', 'org_vaani_demo', 'agent_demo_maya', 'VAI-DEMO-COD-550',
       'Aditi Mehra', '+919876544210', 55000, 'INR', 'Winter cap COD confirmation',
       'scheduled', '2026-09-01T20:00:00+05:30', 'razorpay_sandbox',
       'https://pay.local.vaani.test/VAI-DEMO-COD-550', 'scheduled', '{"mode":"local_sandbox"}')`),
    db.prepare(`INSERT OR IGNORE INTO outbound_messages
      (id, organization_id, payment_link_id, channel, destination, template_name,
       message_body, status, scheduled_for)
      VALUES ('message_demo_cod', 'org_vaani_demo', 'payment_demo_cod', 'whatsapp',
       '+919876544210', 'vaani_payment_link',
       'Your ₹550 payment link is ready: https://pay.local.vaani.test/VAI-DEMO-COD-550',
       'scheduled', '2026-09-01T20:00:00+05:30')`),
    db.prepare(`INSERT OR IGNORE INTO scheduled_actions
      (id, organization_id, agent_id, type, payload_json, status, run_at)
      VALUES ('action_demo_cod', 'org_vaani_demo', 'agent_demo_maya', 'send_payment_link',
       '{"paymentLinkId":"payment_demo_cod","messageId":"message_demo_cod"}',
       'pending', '2026-09-01T20:00:00+05:30')`),
  ]);

  await db.batch([
    // Demo content is deliberately updated (rather than only inserted) so an
    // existing local database receives the same Sidharth-services experience
    // as a clean install. Login identity is not rewritten because another
    // local test user may already own the resume email.
    db.prepare(`UPDATE organizations
      SET slug = 'sidharth-kumar-services',
          name = 'Sidharth Kumar · SaaS & Digital Services', status = 'active'
      WHERE id = 'org_vaani_demo'`),
    db.prepare(`UPDATE lead_forms
      SET name = 'IT services consultation', public_key = 'form_sidharth_services'
      WHERE id = 'form_demo_popup' AND organization_id = 'org_vaani_demo'`),
    db.prepare(`UPDATE phone_numbers
      SET phone_number = '+918071582881', country = 'IN', number_type = 'local',
          acquisition_type = 'bring_your_own', public_provider_name = 'Vobiz',
          assigned_agent_name = 'Aarohi · Services Sales',
          direction = 'inbound_outbound', kyc_status = 'not_required',
          status = 'active', monthly_rental = 0
      WHERE id = 'number_demo_active' AND organization_id = 'org_vaani_demo'`),
    db.prepare(`UPDATE voice_agents SET
        name = 'Aarohi', use_case = 'sales_development', status = 'active',
        welcome_message = 'नमस्ते, मैं आरोही, सिद्धार्थ कुमार की AI assistant बोल रही हूँ। क्या अभी एक मिनट बात करना सुविधाजनक है?',
        system_prompt = 'You are Sidharth Kumar''s consultative AI sales assistant for verified SaaS product development, custom portals, CRM and API integrations, AI calling workflows, websites, e-commerce, LMS, admin panels and digital marketing automation. Speak naturally in the caller''s Hindi, Hinglish or English. Ask permission to continue, discover the business problem one question at a time, and use only approved knowledge. Never invent clients, prices, guarantees, certifications or availability. Qualify the need, timeline and decision process, then offer a confirmed meeting or human transfer. Respect opt-outs immediately and never claim an action succeeded without a successful tool result.',
        primary_language = 'hi-IN', voice_name = 'Vaani Tara',
        intelligence_profile = 'Vaani Sense Balanced', temperature = 20,
        max_tokens = 250, endpointing_ms = 250, interrupt_words = 2,
        tools_json = '["lookup_customer","create_lead","schedule_follow_up","book_appointment","transfer_to_human","end_call"]',
        extractions_json = '["language","intent","service_interest","business_problem","timeline","decision_process","next_action"]',
        calling_config_json = '{"inbound":true,"outbound":true,"voicemailDetection":true,"silenceTimeoutSeconds":15,"maxCallSeconds":300,"callingWindow":"10:00-19:00 Asia/Kolkata"}',
        cost_per_minute = 55
      WHERE id = 'agent_demo_maya' AND organization_id = 'org_vaani_demo'`),
    db.prepare(`UPDATE campaigns SET
        name = 'SaaS & digital services consultations', status = 'paused',
        audience_size = 0, attempted = 0, connected = 0, converted = 0
      WHERE id = 'campaign_demo_gurugram' AND organization_id = 'org_vaani_demo'`),
    db.prepare(`UPDATE knowledge_bases SET name = 'Sidharth Kumar · services and profile'
      WHERE id = 'kb_demo_products' AND organization_id = 'org_vaani_demo'`),
    db.prepare(`UPDATE plans SET included_credits = 100,
      features_json = '["100 trial credits","1 AI agent","CRM lite","API sandbox"]'
      WHERE id = 'plan_free'`),
    db.prepare(`INSERT OR IGNORE INTO auth_provider_settings
      (provider, display_name, button_visible, enabled, status, public_config_json)
      VALUES ('google', 'Google', 1, 0, 'admin_disabled', '{"required":["GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","GOOGLE_REDIRECT_URI"]}')`),
    db.prepare(`INSERT OR IGNORE INTO auth_provider_settings
      (provider, display_name, button_visible, enabled, status)
      VALUES ('microsoft', 'Microsoft', 0, 0, 'not_configured')`),
    db.prepare(`INSERT OR IGNORE INTO auth_provider_settings
      (provider, display_name, button_visible, enabled, status, public_config_json)
      VALUES ('github', 'GitHub', 0, 0, 'hidden', '{"required":["GITHUB_CLIENT_ID","GITHUB_CLIENT_SECRET"]}')`),
    db.prepare(`INSERT OR IGNORE INTO organization_settings
      (organization_id, timezone, default_language, enabled_languages_json, recording_policy,
       recording_retention_days, transcript_retention_days, qa_sample_rate, redact_sensitive_data)
      VALUES ('org_vaani_demo', 'Asia/Kolkata', 'hinglish',
       '["hi-IN","en-IN","hinglish","haryanvi","bn-IN","ta-IN","te-IN","mr-IN"]',
       'record_with_consent', 90, 180, 100, 1)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_sarvam', 'Sarvam AI', 'Vaani Voice India', 'speech',
       '["SARVAM_API_KEY"]', 'required_for_live', 'not_connected', 'Indic STT, TTS and realtime voice', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_anthropic', 'Anthropic Claude', 'Vaani Sense', 'reasoning',
       '["ANTHROPIC_API_KEY"]', 'required_for_live', 'not_connected', 'Reasoning and tool planning', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_openai', 'OpenAI API', 'Vaani Realtime', 'realtime_reasoning',
       '["OPENAI_API_KEY","OPENAI_MODEL","OPENAI_REALTIME_MODEL"]', 'optional', 'not_connected', 'Realtime audio, streaming responses and tool-capable reasoning', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_elevenlabs', 'ElevenLabs API', 'Vaani Voice Global', 'speech',
       '["ELEVENLABS_API_KEY","ELEVENLABS_VOICE_ID"]', 'optional', 'not_connected', 'Multilingual low-latency speech, voice selection and streaming output', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_cartesia', 'Cartesia AI', 'Call Vani Sonic Voice', 'speech',
       '["CARTESIA_API_KEY","CARTESIA_VOICE_ID","CARTESIA_MODEL"]', 'optional', 'not_connected', 'Low-latency Sonic TTS/STT option for premium realtime voices', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_bolna', 'Bolna AI', 'Call Vani Bolna Voice Agent', 'voice_platform',
       '["BOLNA_API_KEY","BOLNA_BASE_URL","BOLNA_WEBHOOK_SECRET"]', 'optional', 'not_connected', 'Voice-agent platform for agents, calls, templates and execution webhooks', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_razorpay', 'Razorpay', 'Vaani Payments', 'payments',
       '["RAZORPAY_KEY_ID","RAZORPAY_KEY_SECRET","RAZORPAY_WEBHOOK_SECRET"]', 'optional', 'sandbox', 'Payment links, subscriptions and webhook status', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_stripe', 'Stripe', 'Call Vani Payments · Stripe', 'payments',
       '["STRIPE_SECRET_KEY","STRIPE_WEBHOOK_SECRET"]', 'optional', 'not_connected', 'International card payments, balance checks and signed checkout webhooks', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_payu', 'PayU', 'Vaani Payments · PayU', 'payments',
       '["PAYU_MERCHANT_KEY","PAYU_MERCHANT_SALT","PAYU_WEBHOOK_SECRET"]', 'optional', 'not_connected', 'India payment links and checkout', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_phonepe', 'PhonePe', 'Vaani Payments · PhonePe', 'payments',
       '["PHONEPE_MERCHANT_ID","PHONEPE_SALT_KEY","PHONEPE_SALT_INDEX","PHONEPE_WEBHOOK_SECRET"]', 'optional', 'not_connected', 'UPI checkout and payment status', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_paytm', 'Paytm', 'Vaani Payments · Paytm', 'payments',
       '["PAYTM_MERCHANT_ID","PAYTM_MERCHANT_KEY","PAYTM_WEBSITE","PAYTM_WEBHOOK_SECRET"]', 'optional', 'not_connected', 'Paytm checkout and payment status', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_cashfree', 'Cashfree Payments', 'Call Vani Payments · Cashfree', 'payments',
       '["CASHFREE_CLIENT_ID","CASHFREE_CLIENT_SECRET","CASHFREE_WEBHOOK_SECRET"]', 'optional', 'not_connected', 'India checkout, payouts-ready reconciliation and signed payment webhooks', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_bank_transfer', 'Manual bank transfer', 'Vaani Payments · Bank transfer', 'payments',
       '["BANK_TRANSFER_ACCOUNT_NAME","BANK_TRANSFER_ACCOUNT_NUMBER","BANK_TRANSFER_IFSC"]', 'optional', 'admin_review', 'Manual proof upload and admin reconciliation', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_whatsapp', 'Meta WhatsApp Cloud', 'Vaani Messages', 'messaging',
       '["WHATSAPP_ACCESS_TOKEN","WHATSAPP_PHONE_NUMBER_ID","WHATSAPP_PAYMENT_TEMPLATE"]', 'optional', 'sandbox', 'Approved templates and follow-ups', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_telephony', 'Exotel / Vobiz / SIP', 'Vaani Connect', 'telephony',
       '["TELEPHONY_API_KEY","TELEPHONY_API_SECRET","SIP_GATEWAY"]', 'required_for_live', 'not_connected', 'Inbound, outbound, DID and SIP routing', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_vobiz', 'Vobiz AI', 'Call Vani Numbers · Vobiz', 'telephony',
       '["VOBIZ_AUTH_ID","VOBIZ_AUTH_TOKEN","VOBIZ_BASE_URL"]', 'optional', 'not_connected', 'Partner/sub-account numbers, outbound calls and status webhooks', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_twilio', 'Twilio', 'Vaani Connect Global', 'telephony',
       '["TWILIO_ACCOUNT_SID","TWILIO_AUTH_TOKEN","TWILIO_PHONE_NUMBER","TWILIO_WEBHOOK_SECRET"]', 'optional', 'not_connected', 'Secondary carrier, global numbers and failover routing', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_sms', 'SMS gateway', 'Call Vani SMS', 'messaging',
       '["SMS_PROVIDER","SMS_API_KEY","SMS_SENDER_ID","SMS_WEBHOOK_SECRET"]', 'optional', 'not_connected', 'OTP, missed-call follow-up and payment-link SMS routing', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_storage', 'Cloudflare R2 / S3', 'Vaani Vault', 'storage',
       '["R2_BUCKET","R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY"]', 'required_for_recordings', 'local_demo', 'Encrypted call recordings and exports', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_google_oauth', 'Google OAuth', 'Google sign-in', 'identity',
       '["GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","GOOGLE_REDIRECT_URI"]', 'planned', 'admin_disabled', 'Customer account sign-in; button visible but inactive', 1)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_email', 'Resend / SMTP', 'Call Vani Mail', 'email',
       '["EMAIL_PROVIDER","RESEND_API_KEY","SMTP_HOST","SMTP_PORT","SMTP_USERNAME","SMTP_PASSWORD","EMAIL_FROM"]', 'optional', 'not_connected', 'Transactional email, fallback delivery and account notifications', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_enterprise_identity', 'OIDC / SAML + SCIM', 'Vaani Enterprise Identity', 'identity',
       '["SSO_ISSUER_URL","SSO_CLIENT_ID","SSO_CLIENT_SECRET","SCIM_TOKEN"]', 'optional', 'admin_disabled', 'Enterprise SSO and directory provisioning; disabled until verified', 0)`),
    db.prepare(`INSERT OR IGNORE INTO sip_trunks
      (id, organization_id, name, provider, gateway_uri, auth_type, transport, media_encryption,
       codecs_json, status, last_checked_at)
      VALUES ('sip_demo_india', 'org_vaani_demo', 'India primary trunk', 'custom',
       'sip:gateway.example.local:5061', 'userpass', 'tls', 'sdes', '["PCMU","PCMA"]',
       'testing_required', CURRENT_TIMESTAMP)`),
    db.prepare(`INSERT OR IGNORE INTO knowledge_bases
      (id, organization_id, name, description, language, status, source_count, chunk_count, last_synced_at)
      VALUES ('kb_demo_products', 'org_vaani_demo', 'Products & objections',
       'Approved product facts, pricing, FAQs and objection handling', 'Hindi + English',
       'ready', 4, 186, CURRENT_TIMESTAMP)`),
    db.prepare(`INSERT OR IGNORE INTO knowledge_sources
      (id, organization_id, knowledge_base_id, type, name, content_hash, status, synced_at)
      VALUES ('source_sidharth_resume', 'org_vaani_demo', 'kb_demo_products', 'text',
       'Sidharth Kumar verified professional profile', 'resume-2026-09-19', 'ready', CURRENT_TIMESTAMP)`),
    db.prepare(`INSERT OR IGNORE INTO knowledge_chunks
      (id, organization_id, source_id, ordinal, content, token_estimate, metadata_json)
      VALUES ('chunk_sidharth_profile', 'org_vaani_demo', 'source_sidharth_resume', 0,
       'Sidharth Kumar is based in New Delhi. He is Co-founder and SaaS Product and Client Delivery Lead at Hexbytes since December 2024, co-founded with Sourabh Chauhan. His work covers SaaS architecture, portals and role-based access, APIs and webhooks, AI workflows, CRM, pricing and client delivery. The resume states the team has delivered for more than 100 clients.',
       92, '{"source":"resume","verified":true}')`),
    db.prepare(`INSERT OR IGNORE INTO knowledge_chunks
      (id, organization_id, source_id, ordinal, content, token_estimate, metadata_json)
      VALUES ('chunk_sidharth_services', 'org_vaani_demo', 'source_sidharth_resume', 1,
       'Verified service capabilities include SaaS product development, custom customer and admin portals, CRM systems, API and webhook integrations, AI telecalling and lead management, websites, e-commerce, learning management systems, and marketing automation. Products referenced in the resume include Adgrowly GBP management, an AI telecalling and lead-management platform, salon management software, and WhatsApp API or AI omnichannel work.',
       93, '{"source":"resume","verified":true}')`),
    db.prepare(`INSERT OR IGNORE INTO knowledge_chunks
      (id, organization_id, source_id, ordinal, content, token_estimate, metadata_json)
      VALUES ('chunk_sidharth_languages', 'org_vaani_demo', 'source_sidharth_resume', 2,
       'Sidharth speaks Hindi natively and English professionally, and is a beginner in Japanese. He is pursuing a B.Tech in Computer Science and Engineering with expected completion in 2027. For project enquiries the assistant should collect the requested service, current problem, target timeline, approximate scope and preferred meeting time, without inventing a quotation.',
       78, '{"source":"resume","verified":true}')`),
    // Two demo workflows. They used to be a list of step names that matched no
    // node type — `wait_2_hours`, `update_crm` — on a trigger the builder does
    // not have, carrying 83 and 214 runs that never happened. The old executor
    // would have marked every one of those steps complete. These are real
    // graphs that validate and execute, with run counts of zero, because they
    // have not run.
    db.prepare(`INSERT OR IGNORE INTO workflows
      (id, organization_id, name, description, trigger_type, status, steps_json, graph_json, run_count, failure_count)
      VALUES ('workflow_demo_payment', 'org_vaani_demo', 'Payment follow-up',
       'When a call asks for a payment link: find the lead, create the link, send it.',
       'webhook', 'active', '[]', '{"nodes":[{"id":"start","kind":"trigger","name":"Payment requested","config":{"event":"webhook","filter":"call.payment_requested"},"next":{"next":"lookup"}},{"id":"lookup","kind":"crm_lookup","name":"Find the caller","config":{"entity":"lead","match":"phone","value":"{{caller_phone}}","variable":"lead"},"next":{"found":"link","not_found":"unknown"}},{"id":"link","kind":"payment","name":"Payment link","config":{"amount":"{{amount}}","purpose":"{{purpose}}","channel":"whatsapp","destination":"{{caller_phone}}"},"next":{"next":"notify"}},{"id":"notify","kind":"message","name":"Send it over WhatsApp","config":{"channel":"whatsapp","destination":"{{caller_phone}}","body":"Your payment link is ready. Reply here if anything looks wrong."},"next":{"next":"done"}},{"id":"unknown","kind":"end","name":"No matching lead","config":{"disposition":"payment_no_lead"},"next":{}},{"id":"done","kind":"end","name":"Close","config":{"disposition":"payment_link_sent"},"next":{}}]}', 0, 0)`),
    db.prepare(`INSERT OR IGNORE INTO workflows
      (id, organization_id, name, description, trigger_type, status, steps_json, graph_json, run_count, failure_count)
      VALUES ('workflow_demo_no_answer', 'org_vaani_demo', 'No-answer recovery',
       'When a call goes unanswered: find the lead and offer a callback in writing.',
       'webhook', 'active', '[]', '{"nodes":[{"id":"start","kind":"trigger","name":"Call not answered","config":{"event":"webhook","filter":"call.no_answer"},"next":{"next":"lookup"}},{"id":"lookup","kind":"crm_lookup","name":"Find the lead","config":{"entity":"lead","match":"phone","value":"{{caller_phone}}","variable":"lead"},"next":{"found":"reach","not_found":"unknown"}},{"id":"reach","kind":"message","name":"Offer a callback","config":{"channel":"whatsapp","destination":"{{caller_phone}}","body":"Sorry we missed you. Reply here with a time that suits you and we will call back."},"next":{"next":"done"}},{"id":"unknown","kind":"end","name":"No matching lead","config":{"disposition":"no_answer_no_lead"},"next":{}},{"id":"done","kind":"end","name":"Close","config":{"disposition":"no_answer_followed_up"},"next":{}}]}', 0, 0)`),
    db.prepare(`INSERT OR IGNORE INTO graph_agents
      (id, organization_id, name, status, entry_node, graph_json, version)
      VALUES ('graph_demo_revenue', 'org_vaani_demo', 'Revenue qualification graph', 'active', 'greeting',
       '{"nodes":[{"id":"greeting","type":"conversation"},{"id":"qualify","type":"condition"},{"id":"payment","type":"tool"},{"id":"handoff","type":"transfer"}],"edges":[["greeting","qualify"],["qualify","payment"],["qualify","handoff"]]}', 3)`),
    db.prepare(`INSERT OR IGNORE INTO campaigns
      (id, organization_id, agent_id, name, status, audience_size, attempted, connected,
       converted, concurrency, retry_policy_json, calling_window_json)
      VALUES ('campaign_demo_gurugram', 'org_vaani_demo', 'agent_demo_maya', 'Gurugram site visits',
       'live', 540, 389, 266, 41, 12, '{"attempts":3,"backoffMinutes":[120,1440]}',
       '{"timezone":"Asia/Kolkata","start":"10:00","end":"19:00"}')`),
    db.prepare(`INSERT OR IGNORE INTO call_records
      (id, organization_id, agent_id, campaign_id, direction, from_number, to_number,
       customer_name, status, outcome, duration_seconds, latency_ms, sentiment, summary,
       transcript_json, analysis_json, recording_status, recording_url, cost_credits,
       disconnect_reason, started_at, ended_at)
      VALUES ('call_demo_aditi', 'org_vaani_demo', 'agent_demo_maya', 'campaign_demo_gurugram',
       'outbound', '+911244982201', '+919876544210', 'Aditi Mehra', 'completed', 'payment_link_requested',
       194, 642, 'positive', 'Customer confirmed the order and requested a ₹550 payment link at 8 PM.',
       '[{"role":"agent","text":"नमस्ते, क्या अभी दो मिनट बात कर सकते हैं?"},{"role":"customer","text":"Payment link रात 8 बजे WhatsApp कर देना."}]',
       '{"language":"Hinglish","intent":"payment","amount":550,"resolved":true}',
       'demo_available', '/api/app/recordings/call_demo_aditi', 34, 'agent_hangup',
       '2026-09-01T13:15:00.000Z', '2026-09-01T13:18:14.000Z')`),
    db.prepare(`INSERT OR IGNORE INTO call_records
      (id, organization_id, agent_id, campaign_id, direction, from_number, to_number,
       customer_name, status, outcome, duration_seconds, latency_ms, sentiment, summary,
       transcript_json, analysis_json, recording_status, cost_credits, started_at)
      VALUES ('call_demo_live', 'org_vaani_demo', 'agent_demo_maya', 'campaign_demo_gurugram',
       'outbound', '+911244982201', '+919971103309', 'Rohan Sharma', 'in_progress', 'qualifying',
       126, 588, 'neutral', 'Live qualification call; budget and timeline detected.',
       '[{"role":"agent","text":"आप किस location में property देख रहे हैं?"},{"role":"customer","text":"Gurugram side, possession this year."}]',
       '{"language":"Haryanvi + Hindi","intent":"site_visit","live":true}', 'recording', 20,
       '2026-09-01T14:31:00.000Z')`),
    db.prepare(`INSERT OR IGNORE INTO call_records
      (id, organization_id, agent_id, direction, from_number, to_number, customer_name,
       status, outcome, duration_seconds, latency_ms, sentiment, summary, transcript_json,
       analysis_json, recording_status, recording_url, cost_credits, disconnect_reason, started_at, ended_at)
      VALUES ('call_demo_support', 'org_vaani_demo', 'agent_demo_maya', 'inbound', '+919819325400',
       '+911244982201', 'Kabir Bansal', 'completed', 'appointment_booked', 268, 711, 'positive',
       'Booked a Saturday 11:30 AM site visit and sent confirmation.', '[]',
       '{"language":"English","intent":"appointment","resolved":true}', 'demo_available',
       '/api/app/recordings/call_demo_support', 44, 'user_hangup',
       '2026-09-01T11:08:00.000Z', '2026-09-01T11:12:28.000Z')`),
    db.prepare(`INSERT OR IGNORE INTO call_quality_reviews
      (id, organization_id, call_id, overall_score, resolution_score, knowledge_score,
       naturalness_score, policy_score, hallucination_count, overlap_count, status, findings_json)
      VALUES ('qa_demo_aditi', 'org_vaani_demo', 'call_demo_aditi', 94, 100, 92, 91, 96, 0, 1,
       'passed', '["One short customer interruption","All payment claims correctly marked pending"]')`),
    db.prepare(`INSERT OR IGNORE INTO call_quality_reviews
      (id, organization_id, call_id, overall_score, resolution_score, knowledge_score,
       naturalness_score, policy_score, hallucination_count, overlap_count, status, findings_json)
      VALUES ('qa_demo_support', 'org_vaani_demo', 'call_demo_support', 88, 100, 84, 86, 91, 0, 2,
       'review', '["Knowledge answer was correct but longer than target","Two overlapping speech moments"]')`),
    db.prepare(`INSERT OR IGNORE INTO alert_rules
      (id, organization_id, name, metric, comparator, threshold, window_minutes,
       frequency_minutes, channels_json, status)
      VALUES ('alert_demo_latency', 'org_vaani_demo', 'High response latency', 'p95_latency_ms', '>',
       1200, 30, 5, '["email","webhook"]', 'active')`),
    db.prepare(`INSERT OR IGNORE INTO alert_rules
      (id, organization_id, name, metric, comparator, threshold, window_minutes,
       frequency_minutes, channels_json, status)
      VALUES ('alert_demo_qa', 'org_vaani_demo', 'QA failure rate', 'qa_not_passed_rate', '>',
       15, 1440, 60, '["email"]', 'active')`),
    db.prepare(`INSERT OR IGNORE INTO alert_incidents
      (id, organization_id, rule_id, current_value, status, triggered_at)
      VALUES ('incident_demo_latency', 'org_vaani_demo', 'alert_demo_latency', 1320, 'resolved',
       '2026-08-31T16:20:00.000Z')`),
    db.prepare(`INSERT OR IGNORE INTO report_definitions
      (id, organization_id, name, report_type, schedule, filters_json, status, last_generated_at)
      VALUES ('report_demo_weekly', 'org_vaani_demo', 'Weekly revenue calls', 'operations', 'weekly_monday',
       '{"agents":"all","include":["outcomes","qa","cost","conversion"]}', 'active', CURRENT_TIMESTAMP)`),
    // A minimal org structure so the screen is not empty on a fresh install.
    // Shifts are deliberately NOT seeded: they are opt-in, and seeding them
    // would silently make agents unroutable outside those hours.
    db.prepare(`INSERT OR IGNORE INTO branches
      (id, organization_id, name, code, city, timezone)
      VALUES ('branch_ggn', 'org_vaani_demo', 'Gurugram HQ', 'GGN', 'Gurugram', 'Asia/Kolkata')`),
    db.prepare(`INSERT OR IGNORE INTO departments (id, organization_id, name, code)
      VALUES ('dept_revenue', 'org_vaani_demo', 'Revenue', 'REV')`),
    db.prepare(`INSERT OR IGNORE INTO teams
      (id, organization_id, branch_id, department_id, name)
      VALUES ('team_inside_sales', 'org_vaani_demo', 'branch_ggn', 'dept_revenue', 'Inside sales')`),

    // Human support bench, queues and routing rules so handoff works on a
    // fresh install instead of dead-ending with "no members".
    db.prepare(`INSERT OR IGNORE INTO support_agents
      (id, organization_id, name, role, skills_json, languages_json, availability,
       priority_tier, max_concurrent_calls)
      VALUES ('sa_mgr', 'org_vaani_demo', 'Neha (Manager)', 'manager',
       '["refund","escalation"]', '["hi-IN","en-IN"]', 'offline', 'priority', 2)`),
    db.prepare(`INSERT OR IGNORE INTO support_agents
      (id, organization_id, name, role, skills_json, languages_json, availability,
       priority_tier, max_concurrent_calls)
      VALUES ('sa_sup', 'org_vaani_demo', 'Rohit (Support)', 'support_agent',
       '["support"]', '["hi-IN"]', 'offline', 'standard', 1)`),
    // Linked to the demo owner so the Agent Desk is usable on a fresh install
    // instead of showing "you are not on the support bench".
    db.prepare(`UPDATE support_agents SET user_id = 'user_vaani_owner'
      WHERE id = 'sa_sup' AND organization_id = 'org_vaani_demo' AND user_id IS NULL`),
    db.prepare(`INSERT OR IGNORE INTO support_agents
      (id, organization_id, name, role, skills_json, languages_json, availability,
       priority_tier, max_concurrent_calls)
      VALUES ('sa_sales', 'org_vaani_demo', 'Simran (Sales)', 'support_agent',
       '["sales","site_visit"]', '["pa-IN","hi-IN","en-IN"]', 'offline', 'standard', 2)`),
    db.prepare(`INSERT OR IGNORE INTO queues
      (id, organization_id, name, slug, description, strategy, priority,
       required_skill, min_role, sla_seconds, overflow_action, overflow_queue_id)
      VALUES ('queue_escalation', 'org_vaani_demo', 'Escalations', 'escalation',
       'Refunds, complaints and anything needing authority.', 'skill_first', 10,
       'escalation', 'manager', 45, 'callback', NULL)`),
    db.prepare(`INSERT OR IGNORE INTO queues
      (id, organization_id, name, slug, description, strategy, priority,
       required_skill, min_role, sla_seconds, overflow_action, overflow_queue_id)
      VALUES ('queue_sales', 'org_vaani_demo', 'Sales', 'sales',
       'Site visits, pricing and new enquiries.', 'longest_idle', 50,
       'sales', NULL, 60, 'overflow_queue', 'queue_support')`),
    db.prepare(`INSERT OR IGNORE INTO queues
      (id, organization_id, name, slug, description, strategy, priority,
       required_skill, min_role, sla_seconds, overflow_action, overflow_queue_id)
      VALUES ('queue_support', 'org_vaani_demo', 'Support', 'support',
       'General help for existing customers.', 'least_busy', 100,
       NULL, NULL, 90, 'callback', NULL)`),
    db.prepare(`INSERT OR IGNORE INTO queue_members
      (id, organization_id, queue_id, support_agent_id, priority)
      VALUES ('qm_esc_mgr', 'org_vaani_demo', 'queue_escalation', 'sa_mgr', 10)`),
    db.prepare(`INSERT OR IGNORE INTO queue_members
      (id, organization_id, queue_id, support_agent_id, priority)
      VALUES ('qm_sales_simran', 'org_vaani_demo', 'queue_sales', 'sa_sales', 10)`),
    db.prepare(`INSERT OR IGNORE INTO queue_members
      (id, organization_id, queue_id, support_agent_id, priority)
      VALUES ('qm_sup_rohit', 'org_vaani_demo', 'queue_support', 'sa_sup', 10)`),
    db.prepare(`INSERT OR IGNORE INTO queue_members
      (id, organization_id, queue_id, support_agent_id, priority)
      VALUES ('qm_sup_simran', 'org_vaani_demo', 'queue_support', 'sa_sales', 200)`),
    db.prepare(`INSERT OR IGNORE INTO routing_rules
      (id, organization_id, name, match_type, match_value, queue_id, priority)
      VALUES ('rr_refund', 'org_vaani_demo', 'Refunds to escalations', 'skill',
       'escalation', 'queue_escalation', 10)`),
    db.prepare(`INSERT OR IGNORE INTO routing_rules
      (id, organization_id, name, match_type, match_value, queue_id, priority)
      VALUES ('rr_sales', 'org_vaani_demo', 'Sales enquiries', 'skill', 'sales',
       'queue_sales', 50)`),
    db.prepare(`INSERT OR IGNORE INTO routing_rules
      (id, organization_id, name, match_type, match_value, queue_id, priority)
      VALUES ('rr_default', 'org_vaani_demo', 'Everything else', 'reason', '*',
       'queue_support', 900)`),
    db.prepare(`UPDATE support_agents SET branch_id = 'branch_ggn',
      team_id = 'team_inside_sales', department_id = 'dept_revenue'
      WHERE organization_id = 'org_vaani_demo' AND id IN ('sa_sales', 'sa_sup')
        AND branch_id IS NULL`),
    db.prepare(`INSERT OR IGNORE INTO support_tickets
      (id, organization_id, created_by_user_id, subject, category, priority, status, assigned_to)
      VALUES ('ticket_demo_sip', 'org_vaani_demo', 'user_vaani_owner', 'SIP trunk test call needs review',
       'telephony', 'high', 'in_progress', 'Platform operations')`),
    db.prepare(`INSERT OR IGNORE INTO support_ticket_messages
      (id, ticket_id, sender_role, sender_name, message)
      VALUES ('ticket_message_demo_1', 'ticket_demo_sip', 'customer', 'Sidharth Kumar',
       'The ownership check passed; please help validate inbound routing before activation.')`),
    db.prepare(`INSERT OR IGNORE INTO support_ticket_messages
      (id, ticket_id, sender_role, sender_name, message)
      VALUES ('ticket_message_demo_2', 'ticket_demo_sip', 'admin', 'Platform operations',
       'We are reviewing the gateway, codecs and TLS configuration. No live routing is enabled yet.')`),
  ]);
}

/**
 * The two demo workflows' graphs, defined once and used by both the seed and
 * the repair below. Kept apart from the INSERTs so a database created by the
 * earlier build and a fresh one end up with exactly the same thing.
 */
const DEMO_PAYMENT_GRAPH =
  '{"nodes":[{"id":"start","kind":"trigger","name":"Payment requested","config":{"event":"webhook","filter":"call.payment_requested"},"next":{"next":"lookup"}},{"id":"lookup","kind":"crm_lookup","name":"Find the caller","config":{"entity":"lead","match":"phone","value":"{{caller_phone}}","variable":"lead"},"next":{"found":"link","not_found":"unknown"}},{"id":"link","kind":"payment","name":"Payment link","config":{"amount":"{{amount}}","purpose":"{{purpose}}","channel":"whatsapp","destination":"{{caller_phone}}"},"next":{"next":"notify"}},{"id":"notify","kind":"message","name":"Send it over WhatsApp","config":{"channel":"whatsapp","destination":"{{caller_phone}}","body":"Your payment link is ready. Reply here if anything looks wrong."},"next":{"next":"done"}},{"id":"unknown","kind":"end","name":"No matching lead","config":{"disposition":"payment_no_lead"},"next":{}},{"id":"done","kind":"end","name":"Close","config":{"disposition":"payment_link_sent"},"next":{}}]}';
const DEMO_NO_ANSWER_GRAPH =
  '{"nodes":[{"id":"start","kind":"trigger","name":"Call not answered","config":{"event":"webhook","filter":"call.no_answer"},"next":{"next":"lookup"}},{"id":"lookup","kind":"crm_lookup","name":"Find the lead","config":{"entity":"lead","match":"phone","value":"{{caller_phone}}","variable":"lead"},"next":{"found":"reach","not_found":"unknown"}},{"id":"reach","kind":"message","name":"Offer a callback","config":{"channel":"whatsapp","destination":"{{caller_phone}}","body":"Sorry we missed you. Reply here with a time that suits you and we will call back."},"next":{"next":"done"}},{"id":"unknown","kind":"end","name":"No matching lead","config":{"disposition":"no_answer_no_lead"},"next":{}},{"id":"done","kind":"end","name":"Close","config":{"disposition":"no_answer_followed_up"},"next":{}}]}';

async function ensureColumn(
  db: D1Database,
  table: string,
  column: string,
  definition: string,
) {
  const info = await db
    .prepare(`PRAGMA table_info(${table})`)
    .all<{ name: string }>();
  if (!info.results.some((item) => item.name === column)) {
    await db
      .prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
      .run();
  }
}

async function hashSeedPassword(password: string, salt: string) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(salt),
      iterations: 120_000,
    },
    material,
    256,
  );
  return `pbkdf2$120000$${toBase64(new TextEncoder().encode(salt))}$${toBase64(new Uint8Array(bits))}`;
}

function toBase64(value: Uint8Array) {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}
