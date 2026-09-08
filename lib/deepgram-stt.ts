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
  const response = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: 'POST',
    headers: {
      authorization: `Token ${apiKey}`,
      'content-type': input.contentType || 'audio/webm',
    },
    body: input.audio,
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok)
    throw new Error(`Deepgram transcription failed (${response.status}).`);
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
