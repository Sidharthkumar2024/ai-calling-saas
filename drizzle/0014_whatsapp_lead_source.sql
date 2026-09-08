-- Somewhere for a WhatsApp form's answers to land. Without a row here, an
-- existing workspace's first filled-in form fails on "Lead source is not
-- configured" — after the customer has already answered it.
INSERT INTO lead_sources (id, organization_id, type, name, status)
SELECT 'src_wa_' || o.id, o.id, 'whatsapp', 'WhatsApp Form', 'connected'
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM lead_sources s
  WHERE s.organization_id = o.id AND s.type = 'whatsapp'
);
