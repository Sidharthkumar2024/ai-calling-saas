import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import {
  LEGACY_CUSTOMER_PLATFORM_INTEGRATION_TYPES,
  removeLegacyCustomerPlatformIntegrations,
} from '../db/platform-provider-ownership-migration.ts';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`
  CREATE TABLE integration_connections (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    public_config_json TEXT NOT NULL DEFAULT '{}',
    encrypted_secret TEXT
  );
  CREATE TABLE audit_events (
    id TEXT PRIMARY KEY,
    organization_id TEXT,
    actor_user_id TEXT,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE platform_provider_secrets (
    provider TEXT PRIMARY KEY,
    encrypted_secret TEXT
  );
`);

const insert = sqlite.prepare(`INSERT INTO integration_connections
  (id, organization_id, type, name, encrypted_secret)
  VALUES (?, ?, ?, ?, ?)`);
for (const [
  index,
  type,
] of LEGACY_CUSTOMER_PLATFORM_INTEGRATION_TYPES.entries())
  insert.run(
    `legacy_${index}`,
    index % 2 ? 'org_two' : 'org_one',
    type,
    `Legacy ${type}`,
    `encrypted-${type}`,
  );
insert.run(
  'customer_twilio',
  'org_one',
  'telephony_twilio',
  'Twilio',
  'encrypted-customer-key',
);
insert.run(
  'customer_unknown',
  'org_one',
  'custom_future_provider',
  'Unknown',
  'encrypted-unknown-key',
);
sqlite
  .prepare(
    `INSERT INTO platform_provider_secrets (provider, encrypted_secret)
     VALUES ('cartesia', 'encrypted-platform-key')`,
  )
  .run();

let batches = 0;
const database = {
  prepare(sql) {
    return { sql };
  },
  async batch(statements) {
    batches += 1;
    sqlite.exec('BEGIN');
    try {
      const results = statements.map((statement) =>
        sqlite.prepare(statement.sql).run(),
      );
      sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  },
};

assert.deepEqual(LEGACY_CUSTOMER_PLATFORM_INTEGRATION_TYPES, [
  'deepgram',
  'elevenlabs_voice',
  'cartesia',
  'cartesia_voice',
  'sarvam_voice',
]);
await removeLegacyCustomerPlatformIntegrations(database);
assert.equal(batches, 1);
assert.equal(
  sqlite
    .prepare(
      `SELECT count(*) AS n FROM integration_connections
       WHERE id LIKE 'legacy_%'`,
    )
    .get().n,
  0,
);
assert.deepEqual(
  sqlite
    .prepare(`SELECT id, type FROM integration_connections ORDER BY id`)
    .all()
    .map((row) => ({ ...row })),
  [
    { id: 'customer_twilio', type: 'telephony_twilio' },
    { id: 'customer_unknown', type: 'custom_future_provider' },
  ],
);
assert.equal(
  sqlite.prepare(`SELECT encrypted_secret FROM platform_provider_secrets`).get()
    .encrypted_secret,
  'encrypted-platform-key',
);
const audits = sqlite
  .prepare(
    `SELECT actor_user_id, action, target_type, target_id, metadata_json
     FROM audit_events ORDER BY target_id`,
  )
  .all();
assert.equal(audits.length, 5);
for (const audit of audits) {
  assert.equal(audit.actor_user_id, null);
  assert.equal(audit.action, 'integration.legacy_platform_credential_removed');
  assert.equal(audit.target_type, 'integration');
  const metadata = JSON.parse(audit.metadata_json);
  assert.equal(metadata.source, 'platform_provider_ownership_migration');
  assert.equal(
    LEGACY_CUSTOMER_PLATFORM_INTEGRATION_TYPES.includes(metadata.type),
    true,
  );
  assert.equal(metadata.hadSecret, 1);
  assert.equal('encryptedSecret' in metadata, false);
}

await removeLegacyCustomerPlatformIntegrations(database);
assert.equal(batches, 2);
assert.equal(
  sqlite.prepare(`SELECT count(*) AS n FROM audit_events`).get().n,
  5,
);

sqlite.close();
console.log('Legacy customer platform-provider cleanup assertions passed.');
