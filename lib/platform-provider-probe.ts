import { deepgramSpeechPermissionProbe } from './deepgram-stt.ts';
import { CARTESIA_VOICES_URL } from './cartesia.ts';

export const PROBEABLE_PLATFORM_PROVIDERS = new Set([
  'deepgram',
  'elevenlabs',
  'cartesia',
  'sarvam',
]);

type ProbeInput = {
  provider: string;
  apiKey: string;
  config?: Record<string, unknown>;
};

export type PlatformProviderProbeResult = {
  provider: string;
  detail: string;
  status: number;
};

export type PlatformVoiceOption = {
  voiceId: string;
  name: string;
  category: string;
};

export const CARTESIA_API_VERSION = '2026-08-14';

function text(config: Record<string, unknown>, key: string) {
  return typeof config[key] === 'string' ? String(config[key]).trim() : '';
}

function errorDetail(raw: string) {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const candidate = parsed.error ?? parsed.detail ?? parsed.message;
    if (typeof candidate === 'string') return candidate.slice(0, 180);
    if (candidate && typeof candidate === 'object') {
      const nested = candidate as Record<string, unknown>;
      const value =
        typeof nested.message === 'string'
          ? nested.message
          : typeof nested.code === 'string'
            ? nested.code
            : '';
      return value.slice(0, 180);
    }
  } catch {
    // Keep the provider's non-JSON response below, with a strict length cap.
  }
  return raw.replace(/\s+/g, ' ').trim().slice(0, 180);
}

type CartesiaVoice = {
  id?: unknown;
  name?: unknown;
  language?: unknown;
  accent?: unknown;
  gender?: unknown;
  tagline?: unknown;
};

/** Lists voices using Cartesia's current cursor-page response contract. */
export async function listCartesiaVoices(
  input: Pick<ProbeInput, 'apiKey' | 'config'>,
  fetcher: typeof fetch = fetch,
): Promise<{ voices: PlatformVoiceOption[]; status: number }> {
  const config = input.config ?? {};
  const version = text(config, 'apiVersion') || CARTESIA_API_VERSION;
  const response = await fetcher(CARTESIA_VOICES_URL, {
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      'cartesia-version': version,
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const detail = errorDetail(await response.text());
    throw new Error(
      `cartesia rejected the connection (HTTP ${response.status})${detail ? `: ${detail}` : '.'}`,
    );
  }

  const payload = (await response.json()) as
    | CartesiaVoice[]
    | { data?: CartesiaVoice[] };
  const rawVoices = Array.isArray(payload) ? payload : payload.data;
  if (!Array.isArray(rawVoices))
    throw new Error('Cartesia responded without a voice list.');

  const voices = rawVoices
    .flatMap((voice): PlatformVoiceOption[] => {
      const voiceId = typeof voice.id === 'string' ? voice.id.trim() : '';
      if (!voiceId) return [];
      const name =
        typeof voice.name === 'string' && voice.name.trim()
          ? voice.name.trim()
          : voiceId;
      const descriptors = [voice.language, voice.accent, voice.gender]
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean);
      const tagline =
        typeof voice.tagline === 'string' ? voice.tagline.trim() : '';
      return [
        {
          voiceId,
          name,
          category: descriptors.join(' · ') || tagline,
        },
      ];
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  return { voices, status: response.status };
}

/**
 * Performs an actual credential check for a platform-owned speech provider.
 * Deepgram performs a real prerecorded STT request so a key without speech
 * permission cannot look connected. ElevenLabs and Cartesia verify the saved
 * voice against provider discovery. Sarvam creates the smallest useful Hindi
 * synthesis and verifies that audio came back.
 */
export async function probePlatformProvider(
  input: ProbeInput,
  fetcher: typeof fetch = fetch,
): Promise<PlatformProviderProbeResult> {
  const config = input.config ?? {};
  const timeout = AbortSignal.timeout(15_000);
  let response: Response;

  if (input.provider === 'deepgram') {
    const model = text(config, 'model') || 'nova-3';
    const verified = await deepgramSpeechPermissionProbe(
      input.apiKey,
      model,
      fetcher,
    );
    return {
      provider: input.provider,
      detail: `Credential and ${model} speech-to-text permission verified.`,
      status: verified.status,
    };
  } else if (input.provider === 'elevenlabs') {
    const voiceId = text(config, 'voiceId');
    if (!voiceId)
      throw new Error(
        'Choose and save a default ElevenLabs voice before testing.',
      );
    response = await fetcher('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': input.apiKey },
      signal: timeout,
    });
    if (response.ok) {
      const payload = (await response.clone().json()) as {
        voices?: Array<{ voice_id?: string }>;
      };
      if (!payload.voices?.some((voice) => voice.voice_id === voiceId))
        throw new Error(
          'The saved ElevenLabs voice ID is not available to this API key.',
        );
    }
  } else if (input.provider === 'cartesia') {
    const voiceId = text(config, 'voiceId');
    if (!voiceId)
      throw new Error('Save a default Cartesia voice ID before testing.');
    const result = await listCartesiaVoices(
      {
        apiKey: input.apiKey,
        config,
      },
      fetcher,
    );
    if (!result.voices.some((voice) => voice.voiceId === voiceId))
      throw new Error(
        'The saved Cartesia voice ID is not available to this API key.',
      );
    return {
      provider: input.provider,
      detail: 'Credential and saved voice configuration verified.',
      status: result.status,
    };
  } else if (input.provider === 'sarvam') {
    response = await fetcher('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: {
        'api-subscription-key': input.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        text: 'नमस्ते',
        language_code: 'hi-IN',
        speaker: text(config, 'speaker') || 'shubh',
        model: text(config, 'model') || 'bulbul:v3',
        output_audio_codec: 'wav',
        speech_sample_rate: 8000,
      }),
      signal: timeout,
    });
    if (response.ok) {
      const payload = (await response.clone().json()) as { audios?: unknown[] };
      if (!Array.isArray(payload.audios) || !payload.audios[0])
        throw new Error('Sarvam responded without synthesized audio.');
    }
  } else {
    throw new Error('This platform provider has no connection test.');
  }

  if (!response.ok) {
    const raw = await response.text();
    const detail = errorDetail(raw);
    throw new Error(
      `${input.provider} rejected the connection (HTTP ${response.status})${detail ? `: ${detail}` : '.'}`,
    );
  }

  return {
    provider: input.provider,
    detail:
      input.provider === 'sarvam'
        ? 'Credential and Hindi synthesis verified.'
        : 'Credential and saved voice configuration verified.',
    status: response.status,
  };
}
