import { getRawDb } from '@/db/index';
import { decryptSecret } from '@/lib/security';

/** OAuth app credentials are one tuple; never combine credentials from two apps. */
export async function googleAuthConfig() {
  const row = await getRawDb()
    .prepare(
      "SELECT public_config_json, encrypted_secret FROM auth_provider_settings WHERE provider = 'google'",
    )
    .first<{ public_config_json: string; encrypted_secret: string | null }>();
  try {
    const config = JSON.parse(row?.public_config_json || '{}') as {
      clientId?: unknown;
      redirectUri?: unknown;
    };
    if (row?.encrypted_secret || config.clientId || config.redirectUri) {
      if (
        typeof config.clientId !== 'string' ||
        typeof config.redirectUri !== 'string' ||
        !row?.encrypted_secret
      )
        return null;
      const clientSecret = await decryptSecret(row.encrypted_secret);
      if (!config.clientId.trim() || !clientSecret.trim()) return null;
      const redirect = new URL(config.redirectUri);
      if (!['https:', 'http:'].includes(redirect.protocol)) return null;
      return {
        clientId: config.clientId,
        clientSecret,
        redirectUri: config.redirectUri,
      };
    }
  } catch {
    return null;
  }
  const {
    GOOGLE_CLIENT_ID: clientId,
    GOOGLE_CLIENT_SECRET: clientSecret,
    GOOGLE_REDIRECT_URI: redirectUri,
  } = process.env;
  return clientId && clientSecret && redirectUri
    ? { clientId, clientSecret, redirectUri }
    : null;
}
