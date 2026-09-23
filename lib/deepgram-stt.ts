import { fetchProviderWithRetry } from './provider-http.ts';

function silentWav(sampleRate = 16_000, durationMs = 250) {
  const samples = Math.round((sampleRate * durationMs) / 1000);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1)
      view.setUint8(offset + index, value.charCodeAt(index));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples * 2, true);
  return buffer;
}

/**
 * Proves the key can use the exact Speech-to-Text API, not merely list its
 * Deepgram projects. A project-scoped key can pass `/v1/projects` while lacking
 * `speech_to_text`; that produced a green admin badge and silent live calls.
 */
export async function deepgramSpeechPermissionProbe(
  apiKey: string,
  model = 'nova-3',
  fetcher: typeof fetch = fetch,
) {
  const params = new URLSearchParams({
    model,
    smart_format: 'true',
    detect_language: 'true',
  });
  const response = await fetchProviderWithRetry('Deepgram STT probe', () =>
    fetcher(`https://api.deepgram.com/v1/listen?${params}`, {
      method: 'POST',
      headers: {
        authorization: `Token ${apiKey}`,
        'content-type': 'audio/wav',
      },
      body: silentWav(),
      signal: AbortSignal.timeout(15_000),
    }),
  );
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 180);
    throw new Error(
      `Deepgram speech-to-text probe failed (HTTP ${response.status})${detail ? `: ${detail}` : '.'}`,
    );
  }
  return { status: response.status };
}

/** Buffered transcription adapter. This is not the streaming media gateway. */
export async function deepgramTranscript(
  input: { audio: ArrayBuffer; contentType?: string; languageCode?: string },
  apiKey: string,
  model = 'nova-3',
) {
  const language = input.languageCode?.split('-')[0].toLowerCase();
  const params = new URLSearchParams({ model, smart_format: 'true' });
  if (language && !['auto', 'unknown'].includes(language))
    params.set('language', language);
  else params.set('detect_language', 'true');
  const started = Date.now();
  const response = await fetchProviderWithRetry('Deepgram STT', () =>
    fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: 'POST',
      headers: {
        authorization: `Token ${apiKey}`,
        'content-type': input.contentType || 'audio/webm',
      },
      body: input.audio,
      signal: AbortSignal.timeout(25_000),
    }),
  );
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 180);
    throw new Error(
      `Deepgram transcription failed (${response.status})${detail ? `: ${detail}` : '.'}`,
    );
  }
  const result = (await response.json()) as {
    metadata?: { request_id?: string; duration?: number };
    results?: {
      channels?: Array<{
        alternatives?: Array<{ transcript?: string }>;
        detected_language?: string;
      }>;
    };
  };
  const transcript =
    result.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  if (typeof transcript !== 'string')
    throw new Error('Deepgram returned no transcript.');
  return {
    transcript: transcript.trim(),
    providerReference: result.metadata?.request_id ?? null,
    languageCode:
      result.results?.channels?.[0]?.detected_language ?? language ?? 'unknown',
    latencyMs: Date.now() - started,
    durationSeconds: result.metadata?.duration,
  };
}
