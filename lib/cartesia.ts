/**
 * Cartesia credentials are platform-owned, so every credential-bearing request
 * is pinned to the provider's official HTTPS origin. Admin-editable or legacy
 * stored configuration must never be able to redirect the platform key.
 */
export const CARTESIA_API_ORIGIN = 'https://api.cartesia.ai';
export const CARTESIA_VOICES_URL = `${CARTESIA_API_ORIGIN}/voices?limit=100`;
export const CARTESIA_TTS_URL = `${CARTESIA_API_ORIGIN}/tts/bytes`;
