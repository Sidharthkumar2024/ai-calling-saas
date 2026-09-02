/**
 * Call state machine and audio-format guards (architecture §7).
 *
 * These are the provider-independent parts of the realtime audio gateway: the
 * legal state transitions for a live call, and a validator that refuses
 * mismatched codec/sample-rate declarations — declaring 8 kHz mu-law as 16 kHz
 * PCM is the classic cause of choppy or garbled telephony audio.
 */
export type CallState =
  | 'new_call'
  | 'greeting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'handoff'
  | 'ended';

export type CallEvent =
  | 'greeting_started'
  | 'greeting_done'
  | 'speech_started'
  | 'transcript_final'
  | 'response_started'
  | 'response_done'
  | 'interrupted'
  | 'transfer_requested'
  | 'hangup';

const TRANSITIONS: Record<CallState, Partial<Record<CallEvent, CallState>>> = {
  new_call: { greeting_started: 'greeting', hangup: 'ended' },
  greeting: {
    greeting_done: 'listening',
    // Barge-in during the greeting goes straight back to listening.
    interrupted: 'listening',
    speech_started: 'listening',
    hangup: 'ended',
  },
  listening: {
    transcript_final: 'thinking',
    speech_started: 'listening',
    transfer_requested: 'handoff',
    hangup: 'ended',
  },
  thinking: {
    response_started: 'speaking',
    interrupted: 'listening',
    transfer_requested: 'handoff',
    hangup: 'ended',
  },
  speaking: {
    response_done: 'listening',
    interrupted: 'listening',
    speech_started: 'listening',
    transfer_requested: 'handoff',
    hangup: 'ended',
  },
  handoff: { hangup: 'ended' },
  ended: {},
};

export function nextCallState(
  state: CallState,
  event: CallEvent,
): CallState | null {
  return TRANSITIONS[state]?.[event] ?? null;
}

export function canTransition(state: CallState, event: CallEvent): boolean {
  return nextCallState(state, event) !== null;
}

/** A greeting must never be replayed once it has been played. */
export function shouldPlayGreeting(input: {
  state: CallState;
  greetingPlayed: boolean;
}): boolean {
  return input.state === 'new_call' && !input.greetingPlayed;
}

export type AudioEncoding = 'mulaw' | 'alaw' | 'linear16';

export type AudioFormat = {
  encoding: AudioEncoding;
  sampleRate: number;
  bytesPerSample: number;
};

const SUPPORTED_RATES: Record<AudioEncoding, number[]> = {
  mulaw: [8000],
  alaw: [8000],
  linear16: [8000, 16000, 24000],
};

export class AudioFormatError extends Error {}

/**
 * Validate what the telephony provider says it is sending. Rejecting a bad
 * declaration here is much cheaper than debugging distorted audio later.
 */
export function normalizeAudioFormat(declared: {
  encoding?: string | null;
  sampleRate?: number | string | null;
}): AudioFormat {
  const encodingRaw = String(declared.encoding ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const encoding: AudioEncoding | null =
    encodingRaw === 'mulaw' || encodingRaw === 'ulaw' || encodingRaw === 'pcmu'
      ? 'mulaw'
      : encodingRaw === 'alaw' || encodingRaw === 'pcma'
        ? 'alaw'
        : encodingRaw === 'linear16' ||
            encodingRaw === 'pcm' ||
            encodingRaw === 'l16' ||
            encodingRaw === 'slin'
          ? 'linear16'
          : null;
  if (!encoding)
    throw new AudioFormatError(
      `Unsupported audio encoding: ${String(declared.encoding ?? 'missing')}`,
    );
  const sampleRate = Number(declared.sampleRate);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0)
    throw new AudioFormatError('Sample rate is required.');
  if (!SUPPORTED_RATES[encoding].includes(sampleRate))
    throw new AudioFormatError(
      `${encoding} at ${sampleRate} Hz is not supported (allowed: ${SUPPORTED_RATES[encoding].join(', ')} Hz)`,
    );
  return {
    encoding,
    sampleRate,
    bytesPerSample: encoding === 'linear16' ? 2 : 1,
  };
}

/**
 * Cross-check a media frame against the declared format. A frame whose length
 * is impossible for the declared format means the declaration is wrong.
 */
export function assertFrameMatchesFormat(
  format: AudioFormat,
  frameByteLength: number,
): void {
  if (frameByteLength <= 0) throw new AudioFormatError('Empty media frame.');
  if (frameByteLength % format.bytesPerSample !== 0)
    throw new AudioFormatError(
      `Frame of ${frameByteLength} bytes is not aligned to ${format.bytesPerSample}-byte samples — the declared encoding is probably wrong.`,
    );
  const samples = frameByteLength / format.bytesPerSample;
  const durationMs = (samples / format.sampleRate) * 1000;
  // Telephony frames are normally 10-60 ms; anything far outside that at the
  // declared rate points at a sample-rate mismatch.
  if (durationMs > 400)
    throw new AudioFormatError(
      `Frame implies ${Math.round(durationMs)} ms of audio at ${format.sampleRate} Hz — check the declared sample rate.`,
    );
}
