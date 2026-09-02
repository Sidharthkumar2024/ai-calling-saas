import { getRawDb } from './index';

let bootstrapPromise: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  bootstrapPromise ??= bootstrap();
  return bootstrapPromise;
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

  // Distinguish real telephony from playground conversations in call history.
  await ensureColumn(
    db,
    'call_records',
    'channel',
    "TEXT DEFAULT 'phone' NOT NULL",
  );
  await ensureColumn(db, 'call_records', 'intelligence_status', "TEXT");

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

  await db.prepare('PRAGMA optimize').run();
}

async function seedLocalDemo(db: D1Database) {
  const adminHash = await hashSeedPassword(
    'VaaniAdmin#2026',
    'vaani-admin-local',
  );
  const ownerHash = await hashSeedPassword(
    'VaaniUser#2026',
    'vaani-owner-local',
  );

  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO organizations (id, slug, name, status)
      VALUES ('org_vaani_demo', 'urbannest-realty', 'UrbanNest Realty', 'active')`),
    db
      .prepare(`INSERT OR IGNORE INTO app_users
      (id, organization_id, name, email, password_hash, role, status)
      VALUES ('user_vaani_admin', NULL, 'Vaani Platform Admin', 'admin@vaani.local', ?, 'platform_admin', 'active')`)
      .bind(adminHash),
    db
      .prepare(`INSERT OR IGNORE INTO app_users
      (id, organization_id, name, email, password_hash, role, status)
      VALUES ('user_vaani_owner', 'org_vaani_demo', 'Sidharth Kumar', 'owner@vaani.local', ?, 'customer_owner', 'active')`)
      .bind(ownerHash),
    db.prepare(`INSERT OR IGNORE INTO organization_members
      (id, organization_id, user_id, email, role)
      VALUES ('member_vaani_owner', 'org_vaani_demo', 'user_vaani_owner', 'owner@vaani.local', 'admin')`),
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
    db
      .prepare(`INSERT OR IGNORE INTO lead_forms
      (id, organization_id, name, public_key, fields_json, allowed_domains_json, status)
      VALUES ('form_demo_popup', 'org_vaani_demo', 'Project enquiry popup', 'form_urbannest', ?, '["http://localhost:3000"]', 'active')`)
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
      VALUES ('number_demo_active', 'org_vaani_demo', '+911244982201', 'IN', 'local', 'platform_provided', 'Vaani Connect', 'Sara · Sales', 'inbound_outbound', 'approved', 'active', 49900)`),
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
      VALUES ('org_vaani_demo', '+919876500001', 'sales', 'hi-IN', 'complete', CURRENT_TIMESTAMP)`),
    db.prepare(`INSERT OR IGNORE INTO voice_agents
      (id, organization_id, name, use_case, status, welcome_message, system_prompt,
       primary_language, voice_name, intelligence_profile, temperature, max_tokens,
       endpointing_ms, interrupt_words, tools_json, extractions_json, calling_config_json,
       cost_per_minute)
      VALUES (
        'agent_demo_maya', 'org_vaani_demo', 'Sara', 'commerce_sales', 'active',
        'नमस्ते, मैं Sara बोल रही हूँ. क्या अभी दो मिनट बात कर सकते हैं?',
        'You are a concise multilingual revenue agent. Understand intent, explain the product, confirm consent, and use approved tools for WhatsApp, payment links, appointments, or human transfer.',
        'hi-IN', 'Vaani Tara', 'Vaani Sense Balanced', 20, 250, 250, 2,
        '["send_whatsapp","create_payment_link","schedule_follow_up","book_appointment","transfer_human"]',
        '["language","intent","product","amount","payment_timing","next_action"]',
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
    db.prepare(`UPDATE plans SET included_credits = 100,
      features_json = '["100 trial credits","1 AI agent","CRM lite","API sandbox"]'
      WHERE id = 'plan_free'`),
    db.prepare(`INSERT OR IGNORE INTO auth_provider_settings
      (provider, display_name, button_visible, enabled, status, public_config_json)
      VALUES ('google', 'Google', 1, 0, 'admin_disabled', '{"required":["GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","GOOGLE_REDIRECT_URI"]}')`),
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
      VALUES ('provider_razorpay', 'Razorpay', 'Vaani Payments', 'payments',
       '["RAZORPAY_KEY_ID","RAZORPAY_KEY_SECRET","RAZORPAY_WEBHOOK_SECRET"]', 'optional', 'sandbox', 'Payment links, subscriptions and webhook status', 0)`),
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
      VALUES ('provider_storage', 'Cloudflare R2 / S3', 'Vaani Vault', 'storage',
       '["R2_BUCKET","R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY"]', 'required_for_recordings', 'local_demo', 'Encrypted call recordings and exports', 0)`),
    db.prepare(`INSERT OR IGNORE INTO platform_providers
      (id, internal_name, public_name, category, required_credentials_json, status, health, usage_note, customer_visible)
      VALUES ('provider_google_oauth', 'Google OAuth', 'Google sign-in', 'identity',
       '["GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","GOOGLE_REDIRECT_URI"]', 'planned', 'admin_disabled', 'Customer account sign-in; button visible but inactive', 1)`),
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
    db.prepare(`INSERT OR IGNORE INTO workflows
      (id, organization_id, name, trigger_type, status, steps_json, run_count, failure_count, last_run_at)
      VALUES ('workflow_demo_payment', 'org_vaani_demo', 'Payment follow-up', 'call.payment_requested',
       'active', '["confirm_consent","create_payment_link","wait_until_requested_time","send_whatsapp","update_crm"]',
       83, 2, CURRENT_TIMESTAMP)`),
    db.prepare(`INSERT OR IGNORE INTO workflows
      (id, organization_id, name, trigger_type, status, steps_json, run_count, failure_count, last_run_at)
      VALUES ('workflow_demo_no_answer', 'org_vaani_demo', 'No-answer recovery', 'call.no_answer',
       'active', '["wait_2_hours","retry_call","if_failed_add_retargeting_audience"]',
       214, 7, CURRENT_TIMESTAMP)`),
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
