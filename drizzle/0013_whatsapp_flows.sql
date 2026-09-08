-- Flows: a form the customer fills in without leaving WhatsApp.
CREATE TABLE IF NOT EXISTS whatsapp_flows (
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
);

-- One row per send. The token is what Meta echoes back with the answers, so it
-- is how a reply is matched to the flow that asked and the person asked.
CREATE TABLE IF NOT EXISTS whatsapp_flow_responses (
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
);
