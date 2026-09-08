-- What visitors are being served, separate from what the editor is writing.
-- A lead form used to have one copy of itself, so editing a published popup
-- rewrote the running form.
ALTER TABLE lead_forms ADD published_fields_json TEXT;
ALTER TABLE lead_forms ADD published_settings_json TEXT;
ALTER TABLE lead_forms ADD published_domains_json TEXT;
ALTER TABLE lead_forms ADD published_version INTEGER;

-- Forms already live have no snapshot and would go dark without this. What
-- they are serving now is exactly the snapshot to take.
UPDATE lead_forms
SET published_fields_json = fields_json,
    published_settings_json = settings_json,
    published_domains_json = allowed_domains_json,
    published_version = version
WHERE status = 'active' AND published_fields_json IS NULL;
