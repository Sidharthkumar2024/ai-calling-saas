const PRIVATE_FIELDS = new Set([
  'webhookSecret',
  'appSecret',
  'verifyToken',
  'apiSecret',
  'accessToken',
  'secretAccessKey',
  'clientSecret',
]);
export function splitProviderConfig(value: unknown) {
  const config: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { config, secrets };
  for (const [key, item] of Object.entries(value)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,60}$/.test(key) || typeof item !== 'string')
      continue;
    const text = item.trim().slice(0, 4000);
    if (
      PRIVATE_FIELDS.has(key) ||
      /secret|token|password|api.?key/i.test(key)
    ) {
      if (text) secrets[key] = text;
    } else config[key] = text;
  }
  return { config, secrets };
}
export function decodeProviderSecret(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      );
  } catch {
    /* Legacy encrypted values contained a raw API key. */
  }
  return { apiKey: value };
}
