import { getRawDb } from '@/db/index';
import { decryptSecret } from '@/lib/security';
import {
  decodeProviderSecret,
  splitProviderConfig,
} from '@/lib/provider-secret-policy';

export async function readPlatformSecret(provider: string) {
  const db = getRawDb();
  // Both carriers share the one `provider_telephony` row, which is what the
  // admin panel's telephony kill-switch flips. Without `vobiz` here the switch
  // read as "no such provider, so not disabled" and Vobiz kept dialling.
  const rowId =
    provider === 'exotel' || provider === 'vobiz'
      ? 'provider_telephony'
      : `provider_${provider}`;
  const [row, control] = await Promise.all([
    db
      .prepare(
        'SELECT encrypted_secret, public_config_json FROM platform_provider_secrets WHERE provider = ? LIMIT 1',
      )
      .bind(provider)
      .first<{ encrypted_secret: string | null; public_config_json: string }>(),
    db
      .prepare('SELECT status FROM platform_providers WHERE id = ? LIMIT 1')
      .bind(rowId)
      .first<{ status: string }>(),
  ]);
  let publicValue: unknown = {};
  try {
    publicValue = JSON.parse(row?.public_config_json || '{}');
  } catch {
    /* No usable configuration. */
  }
  const legacy = splitProviderConfig(publicValue);
  const secrets = {
    ...legacy.secrets,
    ...(row?.encrypted_secret
      ? decodeProviderSecret(await decryptSecret(row.encrypted_secret))
      : {}),
  };
  return {
    apiKey: secrets.apiKey,
    secrets,
    config: legacy.config as Record<string, unknown>,
    disabled: control?.status === 'disabled',
  };
}
