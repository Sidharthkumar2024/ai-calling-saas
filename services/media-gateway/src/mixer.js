/**
 * Conference mixing and routing (§12, §13).
 *
 * A call is a room of legs. Each leg has a role and a mode, and those decide
 * who hears whom:
 *
 *  - `duplex`  full participant: hears everyone else, is heard by everyone
 *  - `listen`  silent monitor: hears everyone, is heard by nobody
 *  - `whisper` coaching: hears everyone, is heard only by `whisperTo`
 *
 * Pure functions — no sockets, no audio devices — so the routing rules that
 * decide whether a customer can hear a supervisor are testable directly.
 * Getting that wrong is not a glitch; it is a customer hearing coaching.
 */

export const LEG_MODES = ['duplex', 'listen', 'whisper'];
export const LEG_ROLES = ['agent', 'ai', 'customer', 'supervisor'];

/**
 * Whose audio should reach `receiver`, given every leg in the room.
 * Never includes the receiver itself: a leg must not hear its own voice.
 */
export function audibleTo(receiver, legs) {
  return legs.filter((leg) => {
    if (leg.id === receiver.id) return false;
    if (leg.mode === 'listen') return false; // monitors are silent
    if (leg.mode === 'whisper') return leg.whisperTo === receiver.id;
    return true;
  });
}

/**
 * Sums PCM from several legs into one frame, clamped.
 * Mixing by addition is correct for speech at these levels; dividing by the
 * number of legs would make everyone quieter as the room grows.
 */
export function mixFrames(frames, frameLength) {
  const out = new Int16Array(frameLength);
  if (!frames.length) return out;
  // Accumulate in 32-bit: summing straight into an Int16Array wraps at
  // assignment, so two loud speakers would produce a click instead of a
  // clamped peak — and clamping afterwards would already be too late.
  const sum = new Int32Array(frameLength);
  for (const frame of frames) {
    const length = Math.min(frameLength, frame.length);
    for (let index = 0; index < length; index += 1) {
      sum[index] += frame[index];
    }
  }
  for (let index = 0; index < frameLength; index += 1) {
    const value = sum[index];
    out[index] = value > 32767 ? 32767 : value < -32768 ? -32768 : value;
  }
  return out;
}

/** A room of legs for one call. */
export class Room {
  constructor(callId) {
    this.callId = callId;
    this.legs = new Map();
  }

  add(leg) {
    if (!LEG_ROLES.includes(leg.role))
      throw new Error(`Unknown leg role: ${leg.role}`);
    if (!LEG_MODES.includes(leg.mode))
      throw new Error(`Unknown leg mode: ${leg.mode}`);
    this.legs.set(leg.id, leg);
    return leg;
  }

  /**
   * Drops a leg, and reports whom that silenced.
   *
   * A supervisor whispering to a leg that just left has nobody to whisper to,
   * so they fall back to listening. That has to be *reported*, not just done:
   * the supervisor's screen is still saying "only the agent hears you", and
   * they will keep coaching an empty channel until something tells them
   * otherwise.
   */
  remove(legId) {
    const leg = this.legs.get(legId);
    this.legs.delete(legId);
    const demoted = [];
    for (const other of this.legs.values()) {
      if (other.whisperTo === legId) {
        other.mode = 'listen';
        other.whisperTo = null;
        demoted.push(other);
      }
    }
    return { leg: leg ?? null, demoted };
  }

  /**
   * Whom a supervisor would coach if they whispered right now.
   *
   * Only a human agent: whispering to the AI leg reaches nothing that can act
   * on it, and whispering to the customer is the one outcome this whole file
   * exists to prevent. Null means there is nobody to coach — the caller must
   * then say so rather than open a channel to nobody.
   */
  whisperTargetFor(legId) {
    const target = this.list().find(
      (leg) =>
        leg.id !== legId && leg.role === 'agent' && leg.mode !== 'listen',
    );
    return target ? target.id : null;
  }

  get size() {
    return this.legs.size;
  }

  list() {
    return [...this.legs.values()];
  }

  find(legId) {
    return this.legs.get(legId) ?? null;
  }

  byRole(role) {
    return this.list().filter((leg) => leg.role === role);
  }

  /**
   * Whether the AI should keep answering.
   *
   * The AI steps back only when a human has taken over *a customer's* call —
   * a human agent and a customer both present. A lone human agent is the
   * browser dialer talking to the AI on purpose, and silencing the AI there
   * makes the dialer useless.
   */
  aiShouldRespond() {
    const humanAgents = this.list().filter(
      (leg) => leg.role === 'agent' && leg.mode === 'duplex',
    );
    const customers = this.list().filter((leg) => leg.role === 'customer');
    return !(humanAgents.length > 0 && customers.length > 0);
  }

  /** A supervisor may only whisper to a leg that is actually in the room. */
  setMode(legId, mode, whisperTo = null) {
    const leg = this.legs.get(legId);
    if (!leg) return { ok: false, reason: 'leg_not_found' };
    if (!LEG_MODES.includes(mode)) return { ok: false, reason: 'unknown_mode' };
    if (mode === 'whisper') {
      if (!whisperTo) return { ok: false, reason: 'whisper_needs_target' };
      if (whisperTo === legId)
        return { ok: false, reason: 'cannot_whisper_to_self' };
      if (!this.legs.has(whisperTo))
        return { ok: false, reason: 'whisper_target_not_in_room' };
    }
    leg.mode = mode;
    leg.whisperTo = mode === 'whisper' ? whisperTo : null;
    return { ok: true, mode, whisperTo: leg.whisperTo };
  }
}

/** Rooms keyed by call id, so several calls can be bridged at once. */
export class RoomRegistry {
  constructor() {
    this.rooms = new Map();
  }

  open(callId) {
    let room = this.rooms.get(callId);
    if (!room) {
      room = new Room(callId);
      this.rooms.set(callId, room);
    }
    return room;
  }

  get(callId) {
    return this.rooms.get(callId) ?? null;
  }

  /** Drops a leg and closes the room when the last one leaves. */
  leave(callId, legId) {
    const room = this.rooms.get(callId);
    if (!room) return null;
    const { leg } = room.remove(legId);
    if (!room.size) this.rooms.delete(callId);
    return leg;
  }

  get size() {
    return this.rooms.size;
  }
}
