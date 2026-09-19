/**
 * Carrier protocol adapters.
 *
 * Twilio Media Streams and Exotel's bidirectional voicebot stream both send
 * JSON text frames with base64 audio, but with different envelopes. Keeping the
 * translation pure means a new carrier is one function, not a rewrite.
 */

/**
 * 'browser' is the dashboard dialer: the same envelope, but the audio comes
 * from an agent's tab rather than a carrier. It authenticates with a
 * short-lived per-call token, never the gateway secret.
 */
export const CARRIERS = ['twilio', 'exotel', 'vobiz', 'browser'];

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

  if (carrier === 'browser') {
    const event = message.event;
    if (event === 'start')
      return {
        kind: 'start',
        streamSid: message.streamSid ?? 'browser',
        callSid: null,
        // The call id is not taken from the frame: it comes from the verified
        // token, so a tab cannot claim someone else's call.
        callId: null,
        encoding: message.encoding ?? 'mulaw',
        sampleRate: Number(message.sampleRate ?? 8000),
      };
    if (event === 'media')
      return {
        kind: 'media',
        payload: message.media?.payload ?? '',
        track: 'inbound',
      };
    // The dialer measures round trip over the audio socket itself rather than
    // over HTTP, because that is the path the call's voice actually takes. The
    // gateway echoes the tab's own clock back untouched; it never interprets it.
    if (event === 'ping') return { kind: 'ping', at: Number(message.at) || 0 };
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
      return {
        kind: 'media',
        payload: message.media?.payload ?? '',
        track: 'inbound',
      };
    if (event === 'stop' || event === 'dtmf')
      return event === 'stop'
        ? { kind: 'stop' }
        : { kind: 'ignore', reason: 'dtmf' };
    return { kind: 'ignore', reason: event ?? 'unknown_event' };
  }

  // Vobiz deliberately uses the same familiar event names as other media
  // streams, but its ids and playback commands are different. Treating it as
  // Twilio/Exotel means a call can connect while every reply is silently
  // discarded, so its contract stays explicit here.
  if (carrier === 'vobiz') {
    const event = message.event;
    if (event === 'start') {
      const start = message.start ?? {};
      return {
        kind: 'start',
        streamSid: message.streamId ?? start.streamId ?? null,
        callSid: message.callId ?? start.callId ?? start.callUUID ?? null,
        callId: message.callId ?? start.callId ?? start.callUUID ?? null,
        encoding: start.mediaFormat?.encoding ?? 'audio/x-mulaw',
        sampleRate: Number(start.mediaFormat?.sampleRate ?? 8000),
      };
    }
    if (event === 'media')
      return {
        kind: 'media',
        payload: message.media?.payload ?? '',
        track: message.media?.track ?? 'inbound',
      };
    if (event === 'stop') return { kind: 'stop' };
    // `playedStream` and `clearedAudio` are acknowledgements from Vobiz. The
    // gateway paces its own output and needs no state transition for either.
    return { kind: 'ignore', reason: event ?? 'unknown_event' };
  }

  return { kind: 'ignore', reason: `unsupported_carrier:${carrier}` };
}

/** Builds an outbound media frame carrying agent audio. */
export function buildMedia(carrier, { streamSid, payload }) {
  if (carrier === 'browser')
    return JSON.stringify({ event: 'media', media: { payload } });
  if (carrier === 'twilio')
    return JSON.stringify({
      event: 'media',
      streamSid,
      media: { payload },
    });
  if (carrier === 'vobiz')
    return JSON.stringify({
      event: 'playAudio',
      media: {
        contentType: 'audio/x-mulaw',
        sampleRate: 8000,
        payload,
      },
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
  if (carrier === 'browser') return JSON.stringify({ event: 'clear' });
  if (carrier === 'twilio')
    return JSON.stringify({ event: 'clear', streamSid });
  if (carrier === 'vobiz')
    return JSON.stringify({ event: 'clearAudio', streamId: streamSid });
  return JSON.stringify({ event: 'clear', stream_sid: streamSid });
}

/**
 * Echoes a dialer ping. Only the browser carrier has one — carriers do not
 * offer an application-level round trip on the media stream.
 */
export function buildPong(carrier, { at }) {
  if (carrier !== 'browser') return null;
  return JSON.stringify({ event: 'pong', at });
}

/**
 * Whether a frame is a transport probe that may be answered ahead of the media
 * queue. Cheap on purpose: media frames arrive fifty times a second, so this
 * must not parse JSON to say "no".
 */
export function isProbeFrame(carrier, raw) {
  return (
    carrier === 'browser' && typeof raw === 'string' && raw.includes('"ping"')
  );
}

/**
 * Tells a browser leg what mode it is *actually* in.
 *
 * A supervisor asks for a mode and the room decides — there may be no human
 * agent to whisper to, or the one being coached may have hung up. Without this
 * frame the browser goes on displaying what it asked for, which is how a
 * supervisor ends up coaching a channel nobody is listening to. Browser only:
 * a carrier has no use for it and would log it as an unknown event.
 */
export function buildMode(carrier, { mode, whisperTo = null, reason = null }) {
  if (carrier !== 'browser') return null;
  return JSON.stringify({ event: 'mode', mode, whisperTo, reason });
}
