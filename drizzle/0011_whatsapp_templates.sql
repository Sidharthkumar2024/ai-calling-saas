-- Message templates, per workspace. The only thing WhatsApp accepts once the
-- customer's 24-hour reply window has closed.
CREATE TABLE IF NOT EXISTS whatsapp_templates (
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
);
