/**
 * Endpointing and barge-in.
 *
 * Decides when the caller has finished speaking (so a turn can be sent for
 * transcription) and when the caller has started speaking over the agent (so
 * playback must stop immediately). Pure state machine — no audio I/O — so the
 * timing rules are testable frame by frame.
 */

export const DEFAULTS = {
  /** RMS above this counts as speech. Telephony noise floors sit well below. */
  speechThreshold: 0.02,
  /** Silence needed to close a caller turn. */
  silenceToEndMs: 700,
  /** Speech needed before a turn is considered real, to reject clicks. */
  minSpeechMs: 250,
  /** Speech needed while the agent is talking before we treat it as barge-in. */
  bargeInMs: 200,
  /** A single turn is cut off here rather than growing without bound. */
  maxTurnMs: 30_000,
};

export class TurnDetector {
  constructor(options = {}) {
    this.config = { ...DEFAULTS, ...options };
    this.reset();
  }

  reset() {
    this.speechMs = 0;
    this.silenceMs = 0;
    this.turnMs = 0;
    this.inSpeech = false;
    this.agentSpeaking = false;
    this.bargeInMs = 0;
  }

  /** Call when agent playback starts or stops. */
  setAgentSpeaking(speaking) {
    this.agentSpeaking = speaking;
    this.bargeInMs = 0;
  }

  /**
   * Feed one frame. Returns an event:
   *  - `barge_in`  the caller talked over the agent; stop playback now
   *  - `turn_end`  the caller finished; send the buffered audio
   *  - `turn_max`  the turn hit the cap; send what we have
   *  - null        keep buffering
   */
  push({ level, durationMs }) {
    const speech = level >= this.config.speechThreshold;

    if (this.agentSpeaking) {
      // While the agent talks, only sustained speech counts — a short blip is
      // usually the carrier echoing our own audio back.
      this.bargeInMs = speech ? this.bargeInMs + durationMs : 0;
      if (this.bargeInMs >= this.config.bargeInMs) {
        this.bargeInMs = 0;
        return 'barge_in';
      }
      return null;
    }

    if (speech) {
      this.inSpeech = true;
      this.speechMs += durationMs;
      this.silenceMs = 0;
    } else if (this.inSpeech) {
      this.silenceMs += durationMs;
    }
    if (this.inSpeech) this.turnMs += durationMs;

    if (this.turnMs >= this.config.maxTurnMs) return 'turn_max';
    if (
      this.inSpeech &&
      this.speechMs >= this.config.minSpeechMs &&
      this.silenceMs >= this.config.silenceToEndMs
    )
      return 'turn_end';
    // Silence after a blip too short to be speech: drop it and keep waiting.
    if (
      this.inSpeech &&
      this.speechMs < this.config.minSpeechMs &&
      this.silenceMs >= this.config.silenceToEndMs
    ) {
      this.inSpeech = false;
      this.speechMs = 0;
      this.silenceMs = 0;
      this.turnMs = 0;
    }
    return null;
  }
}

/** Duration in ms of a G.711 frame at 8 kHz. */
export function frameDurationMs(byteLength, sampleRate = 8000) {
  return (byteLength / sampleRate) * 1000;
}
