import {
  decodeG711,
  encodeG711,
  pcmToWav,
  resample,
  rms,
  wavToPcm,
} from './audio.js';
import { TurnDetector, frameDurationMs } from './turn-detector.js';
import {
  buildClear,
  buildMedia,
  buildMode,
  buildPong,
  parseInbound,
} from './protocol.js';
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
    openRoom = null,
  }) {
    this.carrier = carrier;
    // One leg of a room. A supervisor leg listens or whispers and must never
    // drive the AI; only a participant leg does.
    this.legId = `leg_${Math.random().toString(36).slice(2, 10)}`;
    this.role = role;
    this.mode = mode;
    this.room = room;
    /**
     * Opens (or finds) the room for a call id learned from a start frame.
     *
     * A browser leg is authenticated for one call before the socket opens, so
     * its room is handed in. A *carrier* leg only learns which Vaani call it
     * is on when the carrier's start frame arrives — and the room used to be
     * decided before that, which meant a real customer call was never in a
     * room at all. Nothing could join it and nothing could be controlled: no
     * supervisor monitoring, no mute, no hold on the one kind of call that
     * matters most.
     */
    this.openRoom = openRoom;
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
    /** Settles the promise `play()` awaits, so stopping playback unblocks it. */
    this.playbackDone = null;
    /** This leg's microphone is off: it contributes no audio and drives no turn. */
    this.muted = false;
    /**
     * The call is parked. Distinct from muted: hold suspends the AI as well, and
     * discards inbound audio rather than buffering it, so a caller talking to a
     * held line is not transcribed and answered later out of context.
     */
    this.held = false;
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
    // A carrier leg's call id arrives here, not at connection time, so this is
    // the earliest point at which its room can exist.
    if (!this.room && this.openRoom) this.room = this.openRoom(this.callId);
    if (this.room) {
      this.room.add({
        id: this.legId,
        role: this.role,
        mode: this.mode,
        whisperTo: null,
        session: this,
      });
      // A leg that joins whispering has no target yet, and a whisper with no
      // target is routed to nobody — the supervisor's microphone was open,
      // frames were flowing, and not one of them reached a human. Resolve the
      // target here, or say plainly that there is nobody to coach.
      if (this.mode === 'whisper') {
        const target = this.room.whisperTargetFor(this.legId);
        if (target) {
          this.room.setMode(this.legId, 'whisper', target);
          this.announceMode({ whisperTo: target });
        } else {
          this.room.setMode(this.legId, 'listen');
          this.mode = 'listen';
          this.announceMode({ reason: 'no_agent_to_whisper_to' });
        }
      } else if (this.role === 'supervisor') {
        this.announceMode({});
      }
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

    // A held call is parked: nothing this leg says is carried, and nothing it
    // says is kept. Buffering it would mean the caller's words are transcribed
    // and answered whenever hold ends, several sentences out of context.
    if (this.held) {
      this.resetBuffer();
      this.detector.reset();
      return null;
    }

    // Send this leg's audio to whoever is allowed to hear it, unless muted.
    if (!this.muted) this.forwardToRoom(samples);

    // Only buffer while the agent is not speaking; the rest is echo.
    if (!this.detector.agentSpeaking && !this.muted) {
      this.buffer.push(samples);
      this.bufferedSamples += samples.length;
    }

    // A supervisor never triggers an AI turn, and once a human has joined as a
    // participant the AI stops answering — that is what transfer means here.
    const aiOwnsTurn =
      this.role !== 'supervisor' &&
      !this.muted &&
      !this.held &&
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
      // Held so `stopPlayback` can settle this promise. Without it, clearing
      // the timer left `play()` pending for ever — and because the server
      // feeds frames through one serialised queue, `onStart`'s
      // `await this.play(greeting)` then blocked every later frame on that
      // call. The session stayed open and went deaf. It survived because the
      // tests use a 200 ms greeting that always finishes on its own, while a
      // real greeting runs several seconds and anything interrupting it —
      // barge-in, and now hold — stopped the call dead.
      this.playbackDone = () => {
        this.playbackDone = null;
        this.playbackTimer = null;
        this.detector.setAgentSpeaking(false);
        resolve();
      };
      const tick = () => {
        if (this.ended || offset >= samples.length) {
          this.playbackDone?.();
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
    // Settle the pending `play()` as well as stopping the timer, or whoever
    // awaited it waits for ever.
    this.playbackDone?.();
    this.detector.setAgentSpeaking(false);
  }

  /**
   * Applies a control command to this leg (§4).
   *
   * The gateway could always *carry* mute, hold and monitoring — the mixer has
   * had listen and whisper from the start — but nothing could reach a live
   * session to ask for them. This is the missing half: one entry point, one
   * allow-list, and a state snapshot back so the caller learns what actually
   * happened rather than assuming the command landed.
   */
  applyControl({ action, mode, whisperTo } = {}) {
    if (this.ended) return { ok: false, reason: 'call_ended' };
    switch (action) {
      case 'mute':
      case 'unmute':
        this.muted = action === 'mute';
        // Whatever was captured before a mute is not carried afterwards.
        if (this.muted) {
          this.resetBuffer();
          this.detector.reset();
        }
        break;
      case 'hold':
      case 'resume':
        this.held = action === 'hold';
        if (this.held) {
          // Stop the reply that is mid-playback: continuing to talk to a caller
          // who has just been parked is worse than silence.
          this.stopPlayback();
          this.resetBuffer();
          this.detector.reset();
        }
        break;
      case 'set_mode': {
        if (!this.room) return { ok: false, reason: 'not_in_a_room' };
        // Delegated so listen and whisper stay decided in one place, including
        // the rule that a supervisor cannot whisper to a leg that has left.
        const result = this.room.setMode(this.legId, mode, whisperTo ?? null);
        if (!result.ok) return result;
        this.mode = result.mode;
        this.announceMode({ whisperTo: result.whisperTo });
        break;
      }
      case 'hangup':
        this.onStop();
        this.close(1000, 'Ended by the workspace');
        break;
      default:
        return { ok: false, reason: 'unknown_action' };
    }
    this.log('control_applied', {
      callId: this.callId,
      legId: this.legId,
      action,
      muted: this.muted,
      held: this.held,
      mode: this.mode,
    });
    return { ok: true, ...this.controlState() };
  }

  /**
   * Sends this leg's effective mode to its browser.
   *
   * The mode a supervisor asks for and the mode the room grants are not always
   * the same, and the gap is the dangerous part: believing you are whispering
   * when you are silent, or that you are silent when you are not.
   */
  /**
   * The room changed this leg's mode without being asked — the leg it was
   * whispering to left. The session's own `mode` has to follow, or the next
   * control snapshot reports a whisper that is no longer happening.
   */
  modeChangedByRoom(mode, reason) {
    this.mode = mode;
    this.announceMode({ reason });
  }

  announceMode({ whisperTo = null, reason = null } = {}) {
    const frame = buildMode(this.carrier, {
      mode: this.mode,
      whisperTo,
      reason,
    });
    if (frame) this.send(frame);
  }

  controlState() {
    return {
      legId: this.legId,
      callId: this.callId,
      role: this.role,
      mode: this.mode,
      muted: this.muted,
      held: this.held,
      ended: this.ended,
    };
  }

  onStop() {
    this.ended = true;
    this.stopPlayback();
    if (this.room) {
      const { demoted } = this.room.remove(this.legId);
      // Whoever was coaching this leg is now talking to nobody. Their browser
      // is still showing "only the agent hears you" until it is told.
      for (const other of demoted)
        other.session?.modeChangedByRoom?.(other.mode, 'whisper_target_left');
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
