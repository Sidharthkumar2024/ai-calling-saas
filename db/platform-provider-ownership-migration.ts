/** Customer-owned rows from before speech credentials became platform-owned. */
export const LEGACY_CUSTOMER_PLATFORM_INTEGRATION_TYPES = [
  'deepgram',
  'elevenlabs_voice',
  'cartesia',
  'cartesia_voice',
  'sarvam_voice',
] as const;

const LEGACY_TYPE_LIST = LEGACY_CUSTOMER_PLATFORM_INTEGRATION_TYPES.map(
  (type) => `'${type}'`,
).join(', ');

/**
 * Removes only the fixed legacy speech-provider rows and records a non-secret
 * audit event for every removal. D1 executes a batch transactionally, so a
 * deletion cannot commit without its audit marker.
 */
export async function removeLegacyCustomerPlatformIntegrations(db: D1Database) {
  await db.batch([
    db.prepare(`INSERT INTO audit_events
      (id, organization_id, actor_user_id, action, target_type, target_id,
       metadata_json)
      SELECT 'audit_legacy_platform_' || lower(hex(randomblob(16))),
             organization_id, NULL,
             'integration.legacy_platform_credential_removed',
             'integration', id,
             json_object(
               'source', 'platform_provider_ownership_migration',
               'type', type,
               'hadSecret', encrypted_secret IS NOT NULL
             )
      FROM integration_connections
      WHERE type IN (${LEGACY_TYPE_LIST})`),
    db.prepare(`DELETE FROM integration_connections
      WHERE type IN (${LEGACY_TYPE_LIST})`),
  ]);
}
