/**
 * Carrier protocol adapters.
 *
 * Twilio Media Streams and Exotel's bidirectional voicebot stream both send
 * JSON text frames with base64 audio, but with different envelopes. Keeping the
 * translation pure means a new carrier is one function, not a rewrite.
 */

export const CARRIERS = ['twilio', 'exotel'];

/**
 * Normalises an inbound carrier frame.
 * Returns `{kind, ...}` where kind is 'start' | 'media' | 'stop' | 'ignore'.
 */
export function parseInbound(carrier, raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return { kind: 'ignore', reason: 'not_json' };
  }

  if (carrier === 'twilio') {
    const event = message.event;
    if (event === 'start') {
      const start = message.start ?? {};
      const format = start.mediaFormat ?? {};
      return {
        kind: 'start',
        streamSid: start.streamSid ?? message.streamSid ?? null,
        callSid: start.callSid ?? null,
        // Twilio sends the Vaani call id through a custom parameter.
        callId: start.customParameters?.callId ?? null,
        encoding: format.encoding ?? 'mulaw',
        sampleRate: Number(format.sampleRate ?? 8000),
      };
    }
    if (event === 'media')
      return {
        kind: 'media',
        payload: message.media?.payload ?? '',
        track: message.media?.track ?? 'inbound',
      };
    if (event === 'stop') return { kind: 'stop' };
    return { kind: 'ignore', reason: event ?? 'unknown_event' };
  }

  if (carrier === 'exotel') {
    const event = message.event;
    if (event === 'start') {
      const start = message.start ?? {};
      return {
        kind: 'start',
        streamSid: start.stream_sid ?? message.stream_sid ?? null,
        callSid: start.call_sid ?? null,
        // Exotel echoes `customfield`, which startOutboundCall sets to the
        // Vaani call id.
        callId: start.custom_parameters?.callId ?? start.customfield ?? null,
        encoding: start.media_format?.encoding ?? 'mulaw',
        sampleRate: Number(start.media_format?.sample_rate ?? 8000),
      };
    }
    if (event === 'media')
      return { kind: 'media', payload: message.media?.payload ?? '', track: 'inbound' };
    if (event === 'stop' || event === 'dtmf')
      return event === 'stop'
        ? { kind: 'stop' }
        : { kind: 'ignore', reason: 'dtmf' };
    return { kind: 'ignore', reason: event ?? 'unknown_event' };
  }

  return { kind: 'ignore', reason: `unsupported_carrier:${carrier}` };
}

/** Builds an outbound media frame carrying agent audio. */
export function buildMedia(carrier, { streamSid, payload }) {
  if (carrier === 'twilio')
    return JSON.stringify({
      event: 'media',
      streamSid,
      media: { payload },
    });
  return JSON.stringify({
    event: 'media',
    stream_sid: streamSid,
    media: { payload },
  });
}

/**
 * Builds the frame that discards audio already queued at the carrier. This is
 * what makes barge-in feel instant: without it the caller keeps hearing the
 * agent's buffered speech after interrupting.
 */
export function buildClear(carrier, { streamSid }) {
  if (carrier === 'twilio')
    return JSON.stringify({ event: 'clear', streamSid });
  return JSON.stringify({ event: 'clear', stream_sid: streamSid });
}
