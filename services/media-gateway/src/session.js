import {
  decodeG711,
  encodeG711,
  pcmToWav,
  resample,
  rms,
  wavToPcm,
} from './audio.js';
import { TurnDetector, frameDurationMs } from './turn-detector.js';
import { buildClear, buildMedia, buildPong, parseInbound } from './protocol.js';
import { audibleTo } from './mixer.js';

/** Providers transcribe better at 16 kHz than at the telephony 8 kHz. */
const STT_RATE = 16_000;
/** One 20 ms frame at 8 kHz. */
const OUT_FRAME_SAMPLES = 160;

/**
 * One call. Owns the audio buffer, the turn state machine and playback,
 * and calls Vaani for each turn. Deliberately transport-agnostic: it is handed
 * `send` and `close`, so it can be driven by a real socket or by a test.
 */
export class CallSession {
  constructor({
    carrier,
    client,
    send,
    close,
    log = () => {},
    callId = null,
    role = 'agent',
    mode = 'duplex',
    room = null,
  }) {
    this.carrier = carrier;
    // One leg of a room. A supervisor leg listens or whispers and must never
    // drive the AI; only a participant leg does.
    this.legId = `leg_${Math.random().toString(36).slice(2, 10)}`;
    this.role = role;
    this.mode = mode;
    this.room = room;
    this.client = client;
    this.send = send;
    this.close = close;
    this.log = log;
    this.detector = new TurnDetector();
    this.buffer = [];
    this.bufferedSamples = 0;
    this.format = { encoding: 'mulaw', sampleRate: 8000 };
    this.streamSid = null;
    // A browser leg arrives already authenticated for one call, so the id is
    // set here rather than read from a frame the tab controls.
    this.callId = callId;
    this.preauthorized = Boolean(callId);
    this.started = false;
    this.busy = false;
    this.ended = false;
    this.playbackTimer = null;
    this.stats = { turns: 0, bargeIns: 0, errors: 0 };
  }

  async handle(raw) {
    const frame = parseInbound(this.carrier, raw);
    if (frame.kind === 'start') return this.onStart(frame);
    if (frame.kind === 'media') return this.onMedia(frame);
    if (frame.kind === 'stop') return this.onStop();
    if (frame.kind === 'ping') {
      const pong = buildPong(this.carrier, { at: frame.at });
      if (pong) this.send(pong);
      return null;
    }
    return null;
  }

  async onStart(frame) {
    this.streamSid = frame.streamSid;
    if (!this.preauthorized) this.callId = frame.callId;
    this.format = {
      encoding: /alaw|pcma/i.test(frame.encoding) ? 'alaw' : 'mulaw',
      sampleRate: Number(frame.sampleRate) || 8000,
    };
    if (!this.callId) {
      // Without the Vaani call id there is no agent, no tenant and no
      // telemetry — refuse rather than answering as nobody.
      this.log('start_without_call_id', { streamSid: this.streamSid });
      this.close(1008, 'Missing callId');
      return null;
    }
    this.started = true;
    if (this.room) {
      this.room.add({
        id: this.legId,
        role: this.role,
        mode: this.mode,
        whisperTo: null,
        session: this,
      });
      this.log('leg_joined', {
        callId: this.callId,
        legId: this.legId,
        role: this.role,
        mode: this.mode,
        legs: this.room.size,
      });
    }
    this.log('call_started', { callId: this.callId, ...this.format });
    if (this.role === 'supervisor') {
      // A monitor joins an existing conversation; it must not make the agent
      // greet again, and it has no turn of its own.
      return null;
    }
    try {
      const greeting = await this.client.greeting(this.callId);
      await this.play(greeting);
    } catch (error) {
      this.stats.errors += 1;
      this.log('greeting_failed', { error: String(error.message ?? error) });
      this.close(1011, 'Greeting failed');
    }
    return null;
  }

  onMedia(frame) {
    if (!this.started || this.ended || !frame.payload) return null;
    const bytes = Buffer.from(frame.payload, 'base64');
    if (!bytes.length) return null;
    const samples = decodeG711(bytes, this.format.encoding);
    const event = this.detector.push({
      level: rms(samples),
      durationMs: frameDurationMs(bytes.length, this.format.sampleRate),
    });

    if (event === 'barge_in') {
      this.stats.bargeIns += 1;
      this.log('barge_in', { callId: this.callId });
      this.stopPlayback();
      // Drop whatever the carrier still has queued, or the caller keeps
      // hearing the agent after interrupting.
      this.send(buildClear(this.carrier, { streamSid: this.streamSid }));
      this.detector.setAgentSpeaking(false);
      this.detector.reset();
      this.resetBuffer();
      return null;
    }

    // Send this leg's audio to whoever is allowed to hear it.
    this.forwardToRoom(samples);

    // Only buffer while the agent is not speaking; the rest is echo.
    if (!this.detector.agentSpeaking) {
      this.buffer.push(samples);
      this.bufferedSamples += samples.length;
    }

    // A supervisor never triggers an AI turn, and once a human has joined as a
    // participant the AI stops answering — that is what transfer means here.
    const aiOwnsTurn =
      this.role !== 'supervisor' &&
      (!this.room || this.room.aiShouldRespond());
    if (!aiOwnsTurn) {
      if (event === 'turn_end' || event === 'turn_max') {
        this.drainBuffer();
        this.detector.reset();
      }
      return null;
    }

    if (event === 'turn_end' || event === 'turn_max') {
      const audio = this.drainBuffer();
      this.detector.reset();
      if (audio) void this.runTurn(audio, event);
    }
    return null;
  }

  /** Passes this leg's audio to every leg permitted to hear it. */
  forwardToRoom(samples) {
    if (!this.room || this.room.size < 2) return;
    const me = this.room.find(this.legId);
    if (!me) return;
    const payload = encodeG711(samples, this.format.encoding).toString(
      'base64',
    );
    for (const other of this.room.list()) {
      if (other.id === this.legId) continue;
      // Ask from the receiver's point of view, so listen and whisper rules
      // are applied exactly once, in one place.
      if (!audibleTo(other, [me]).length) continue;
      other.session?.send(
        buildMedia(other.session.carrier, {
          streamSid: other.session.streamSid,
          payload,
        }),
      );
    }
  }

  resetBuffer() {
    this.buffer = [];
    this.bufferedSamples = 0;
  }

  drainBuffer() {
    if (!this.bufferedSamples) return null;
    const merged = new Int16Array(this.bufferedSamples);
    let offset = 0;
    for (const chunk of this.buffer) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this.resetBuffer();
    return merged;
  }

  async runTurn(samples, reason) {
    if (this.busy || this.ended) return;
    this.busy = true;
    try {
      const upsampled = resample(samples, this.format.sampleRate, STT_RATE);
      const wav = pcmToWav(upsampled, STT_RATE);
      const result = await this.client.turn(this.callId, wav);
      if (result?.keepListening) {
        this.log('silence_ignored', { callId: this.callId });
        return;
      }
      this.stats.turns += 1;
      if (this.carrier === 'browser')
        this.send(
          JSON.stringify({
            event: 'transcript',
            heard: result?.transcript ?? '',
            reply: result?.replyText ?? '',
            toolCalls: result?.toolCalls ?? [],
            latency: result?.latency ?? null,
          }),
        );
      this.log('turn', {
        callId: this.callId,
        reason,
        heard: result?.transcript?.slice(0, 60),
        latency: result?.latency,
      });
      await this.play(result);
      if (result?.endCall) {
        this.log('agent_ended_call', { callId: this.callId });
        this.close(1000, 'Agent ended the call');
      }
    } catch (error) {
      this.stats.errors += 1;
      this.log('turn_failed', { error: String(error.message ?? error) });
    } finally {
      this.busy = false;
    }
  }

  /**
   * Streams agent audio back in real-time-sized frames. Sending it all at once
   * would make barge-in useless: the carrier would already hold the whole reply.
   */
  async play(result) {
    if (!result?.audioBase64 || this.ended) return;
    const raw = Buffer.from(result.audioBase64, 'base64');
    const contentType = String(result.contentType ?? '').toLowerCase();
    let samples;
    // Vaani asks the voice provider for 8 kHz mulaw, which is exactly what the
    // carrier streams — forward those bytes untouched rather than decoding and
    // re-encoding them. WAV is handled for providers that only emit WAV.
    if (/basic|ulaw|mulaw|pcmu/.test(contentType)) {
      samples = decodeG711(raw, 'mulaw');
      if (this.format.sampleRate !== 8000)
        samples = resample(samples, 8000, this.format.sampleRate);
    } else if (/wav|x-wav|wave/.test(contentType)) {
      try {
        const decoded = wavToPcm(raw);
        samples = resample(
          decoded.samples,
          decoded.sampleRate,
          this.format.sampleRate,
        );
      } catch (error) {
        this.stats.errors += 1;
        this.log('playback_decode_failed', {
          error: String(error.message ?? error),
        });
        return;
      }
    } else {
      // Never guess at an unknown container: silence is better than noise, and
      // the log names exactly what arrived.
      this.stats.errors += 1;
      this.log('playback_unsupported_format', {
        contentType: result.contentType ?? 'missing',
        hint: 'Vaani should request ulaw_8000 for a telephony leg.',
      });
      return;
    }
    this.log('playback_start', {
      contentType: result.contentType ?? 'missing',
      samples: samples.length,
    });
    this.detector.setAgentSpeaking(true);
    await new Promise((resolve) => {
      let offset = 0;
      const tick = () => {
        if (this.ended || offset >= samples.length) {
          this.playbackTimer = null;
          this.detector.setAgentSpeaking(false);
          resolve();
          return;
        }
        const slice = samples.subarray(offset, offset + OUT_FRAME_SAMPLES);
        offset += OUT_FRAME_SAMPLES;
        this.send(
          buildMedia(this.carrier, {
            streamSid: this.streamSid,
            payload: encodeG711(slice, this.format.encoding).toString('base64'),
          }),
        );
        this.playbackTimer = setTimeout(tick, 20);
      };
      tick();
    });
  }

  stopPlayback() {
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer);
      this.playbackTimer = null;
    }
    this.detector.setAgentSpeaking(false);
  }

  onStop() {
    this.ended = true;
    this.stopPlayback();
    if (this.room) {
      this.room.remove(this.legId);
      this.log('leg_left', {
        callId: this.callId,
        legId: this.legId,
        legs: this.room.size,
      });
    }
    this.log('call_stopped', { callId: this.callId, stats: this.stats });
    return null;
  }
}
