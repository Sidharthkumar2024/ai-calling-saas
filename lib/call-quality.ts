/**
 * Connection quality scoring (§6, §16).
 *
 * Turns raw network samples into a 0-100 score, a band, and — the part that
 * actually helps an agent — *which* metric is dragging it down. A bare
 * "Poor" tells someone nothing they can act on.
 *
 * Pure functions: no browser APIs, so every threshold is testable.
 */

export type QualitySamples = {
  /** Round-trip times in ms, oldest first. */
  rtts: number[];
  /** Probes that never came back, as a fraction 0..1. */
  lossRatio: number;
  /** Microphone input level 0..1, if measured. */
  micLevel?: number | null;
};

export type QualityBand = 'excellent' | 'good' | 'fair' | 'poor';

export type QualityVerdict = {
  score: number;
  band: QualityBand;
  rttMs: number;
  jitterMs: number;
  lossPercent: number;
  /** Ordered worst-first, each with something the agent can do. */
  warnings: Array<{ code: string; message: string }>;
  /** The single biggest contributor, for the tooltip. */
  primaryIssue: string | null;
};

/** Mean absolute difference between consecutive round trips. */
export function jitterOf(rtts: number[]) {
  if (rtts.length < 2) return 0;
  let total = 0;
  for (let index = 1; index < rtts.length; index += 1) {
    total += Math.abs(rtts[index] - rtts[index - 1]);
  }
  return total / (rtts.length - 1);
}

export function medianOf(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Each metric costs points; the worst one is named as the primary issue. */
export function scoreQuality(samples: QualitySamples): QualityVerdict {
  const rtts = samples.rtts.filter(
    (value) => Number.isFinite(value) && value >= 0,
  );
  const rttMs = Math.round(medianOf(rtts));
  const jitterMs = Math.round(jitterOf(rtts));
  const lossPercent =
    Math.round(Math.min(1, Math.max(0, samples.lossRatio)) * 1000) / 10;

  const penalties: Array<{ code: string; cost: number; message: string }> = [];

  if (!rtts.length) {
    penalties.push({
      code: 'no_samples',
      cost: 100,
      message: 'No connection samples were collected — the test could not run.',
    });
  } else if (rttMs > 400)
    penalties.push({
      code: 'rtt_severe',
      cost: 45,
      message: `Round trip is ${rttMs} ms. Calls will feel like a walkie-talkie — switch network or move closer to the router.`,
    });
  else if (rttMs > 200)
    penalties.push({
      code: 'rtt_high',
      cost: 25,
      message: `Round trip is ${rttMs} ms. Expect noticeable delay before the caller hears you.`,
    });
  else if (rttMs > 120)
    penalties.push({
      code: 'rtt_elevated',
      cost: 10,
      message: `Round trip is ${rttMs} ms, a little high but usable.`,
    });

  if (jitterMs > 60)
    penalties.push({
      code: 'jitter_severe',
      cost: 30,
      message: `Jitter is ${jitterMs} ms. Audio will break up — a wired connection fixes this most reliably.`,
    });
  else if (jitterMs > 30)
    penalties.push({
      code: 'jitter_high',
      cost: 15,
      message: `Jitter is ${jitterMs} ms. Audio may stutter under load.`,
    });

  if (lossPercent >= 5)
    penalties.push({
      code: 'loss_severe',
      cost: 40,
      message: `${lossPercent}% of probes were lost. Words will drop out of the call.`,
    });
  else if (lossPercent >= 1)
    penalties.push({
      code: 'loss_present',
      cost: 18,
      message: `${lossPercent}% packet loss detected.`,
    });

  const mic = samples.micLevel;
  if (typeof mic === 'number') {
    if (mic <= 0.005)
      penalties.push({
        code: 'mic_silent',
        cost: 50,
        message:
          'No sound is reaching the microphone. Check it is not muted and that the right device is selected.',
      });
    else if (mic < 0.03)
      penalties.push({
        code: 'mic_quiet',
        cost: 20,
        message:
          'The microphone is very quiet. Move it closer or raise the input level.',
      });
    else if (mic > 0.92)
      penalties.push({
        code: 'mic_clipping',
        cost: 20,
        message:
          'The microphone is clipping. Lower the input level or move it further away.',
      });
  }

  penalties.sort((a, b) => b.cost - a.cost);
  const score = Math.max(
    0,
    Math.min(100, 100 - penalties.reduce((sum, item) => sum + item.cost, 0)),
  );
  const band: QualityBand =
    score >= 85
      ? 'excellent'
      : score >= 65
        ? 'good'
        : score >= 40
          ? 'fair'
          : 'poor';

  return {
    score,
    band,
    rttMs,
    jitterMs,
    lossPercent,
    warnings: penalties.map(({ code, message }) => ({ code, message })),
    primaryIssue: penalties[0]?.code ?? null,
  };
}

export type ReadinessInput = {
  microphonePermission: 'granted' | 'denied' | 'prompt' | 'unsupported';
  hasInputDevice: boolean;
  micLevel?: number | null;
  quality?: QualityVerdict | null;
};

export type Readiness = {
  state: 'ready' | 'warn' | 'blocked';
  reasons: string[];
};

/**
 * The gate before an agent may go Available (§21). Blocked means calls cannot
 * work at all; warn means they will work badly and the agent should know.
 */
export function evaluateReadiness(input: ReadinessInput): Readiness {
  const reasons: string[] = [];
  if (input.microphonePermission === 'denied')
    return {
      state: 'blocked',
      reasons: [
        'Microphone access is blocked. Allow it in the browser’s site settings, then run the test again.',
      ],
    };
  if (input.microphonePermission === 'unsupported')
    return {
      state: 'blocked',
      reasons: [
        'This browser does not expose microphone access. Use a current Chrome, Edge, Firefox or Safari.',
      ],
    };
  if (input.microphonePermission === 'prompt')
    reasons.push('Microphone access has not been granted yet.');
  if (!input.hasInputDevice)
    return {
      state: 'blocked',
      reasons: [...reasons, 'No microphone was found on this machine.'],
    };
  if (typeof input.micLevel === 'number' && input.micLevel <= 0.005)
    return {
      state: 'blocked',
      reasons: [
        ...reasons,
        'The selected microphone is picking up no sound at all.',
      ],
    };

  const quality = input.quality;
  if (quality) {
    if (quality.band === 'poor')
      return {
        state: 'blocked',
        reasons: [...reasons, ...quality.warnings.map((w) => w.message)],
      };
    if (quality.band === 'fair')
      reasons.push(...quality.warnings.map((w) => w.message));
  } else {
    reasons.push('Connection quality has not been measured yet.');
  }

  if (input.microphonePermission === 'prompt')
    return { state: 'blocked', reasons };
  return { state: reasons.length ? 'warn' : 'ready', reasons };
}

/** Short, readable id an agent can quote to support. */
export function supportCode(seed = crypto.randomUUID()) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  let code = '';
  for (let index = 0; index < 6; index += 1) {
    code += alphabet[hash % alphabet.length];
    hash = Math.floor(hash / alphabet.length) + index * 7919;
  }
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}
