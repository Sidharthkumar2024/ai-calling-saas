/**
 * Talks to Vaani. Provider keys and tenant state live there, so the gateway
 * never holds a customer credential — it holds one shared secret.
 */
export class VaaniClient {
  constructor({ baseUrl, secret, timeoutMs = 30_000 }) {
    if (!baseUrl) throw new Error('VAANI_BASE_URL is required.');
    if (!secret) throw new Error('MEDIA_GATEWAY_SECRET is required.');
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.secret = secret;
    this.timeoutMs = timeoutMs;
  }

  async post(path, body) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-vaani-gateway-secret': this.secret,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { error: text.slice(0, 300) };
    }
    if (!response.ok) {
      const error = new Error(
        payload?.error ?? `Vaani returned HTTP ${response.status}.`,
      );
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  /** Greeting turn: no caller audio yet. */
  greeting(callId, languageCode) {
    return this.post('/api/internal/voice-turn', {
      callId,
      greeting: true,
      languageCode,
    });
  }

  /** Caller turn: WAV audio in, agent audio out. */
  turn(callId, wavBuffer, languageCode) {
    return this.post('/api/internal/voice-turn', {
      callId,
      audioBase64: wavBuffer.toString('base64'),
      contentType: 'audio/wav',
      languageCode,
    });
  }
}
