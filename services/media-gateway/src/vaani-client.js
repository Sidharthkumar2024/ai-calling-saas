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

  async post(path, body, { attempts = 1 } = {}) {
    let transportError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let response;
      try {
        response = await fetch(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-vaani-gateway-secret': this.secret,
          },
          body: JSON.stringify(body),
          // A restart retry gets a shorter deadline; it exists to bridge a
          // process recycle, not to make a caller wait another full turn.
          signal: AbortSignal.timeout(
            attempt === 1 ? this.timeoutMs : Math.min(this.timeoutMs, 10_000),
          ),
        });
      } catch (error) {
        transportError = error;
        if (attempt < attempts) {
          await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
          continue;
        }
        throw new Error(
          `Vaani transport failed after ${attempts} attempt${attempts === 1 ? '' : 's'}: ${String(error?.message ?? error)}`,
          { cause: error },
        );
      }

      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = { error: text.slice(0, 300) };
      }
      if (response.ok) return payload;

      // Retry a greeting only while the app is restarting or its upstream is
      // temporarily unavailable. 4xx is a real configuration/request problem.
      if (
        attempt < attempts &&
        [429, 500, 502, 503, 504].includes(response.status)
      ) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        continue;
      }
      const error = new Error(
        payload?.error ?? `Vaani returned HTTP ${response.status}.`,
      );
      error.status = response.status;
      throw error;
    }
    throw transportError ?? new Error('Vaani request failed.');
  }

  /** Greeting turn: no caller audio yet. */
  greeting(callId, languageCode) {
    return this.post(
      '/api/internal/voice-turn',
      {
        callId,
        greeting: true,
        languageCode,
      },
      { attempts: 2 },
    );
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
