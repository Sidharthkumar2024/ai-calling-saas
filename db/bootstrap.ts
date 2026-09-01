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
      role TEXT DEFAULT 'user' NOT NULL,
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
      status TEXT DEFAULT 'active' NOT NULL,
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

  await db.prepare('PRAGMA optimize').run();
}
