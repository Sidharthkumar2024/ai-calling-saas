/**
 * Real transport statistics for the paths Vaani actually uses (§6).
 *
 * Two different things are measured here, and keeping them apart is the whole
 * point — conflating them is how call diagnostics start lying:
 *
 *  1. `summariseTransport` reads the **live audio socket the browser dialer
 *     really uses**. Frame pacing, dropouts and socket round trip are genuine
 *     measurements of the media path, taken while a call is in progress.
 *  2. `classifyIceCandidates` and `summariseRtcStats` read a **WebRTC probe**:
 *     an RTCPeerConnection built only to ask the browser and the network the
 *     questions they can actually answer — which codec gets negotiated, what
 *     bitrate the encoder produces, whether UDP leaves this network at all.
 *     It carries no call audio, and nothing here pretends otherwise.
 *
 * Pure functions, so every threshold is testable without a browser.
 */

// The extension is explicit so the Node test runner resolves this without a
// bundler: `npm test` runs these modules through --experimental-strip-types.
import { jitterOf, medianOf, type QualityBand } from './call-quality.ts';

export type IceVerdict = 'direct' | 'relay_required' | 'blocked' | 'untested';

export type IceSummary = {
  candidateTypes: string[];
  protocols: string[];
  hasHost: boolean;
  hasReflexive: boolean;
  hasRelay: boolean;
  /** null when nothing could test it — not the same as false. */
  udpEgress: boolean | null;
  verdict: IceVerdict;
  reason: string;
};

/**
 * Parses one SDP candidate line:
 * `candidate:1 1 udp 2122260223 192.168.1.5 54321 typ host ...`
 */
export function parseCandidate(line: string) {
  const text = String(line ?? '')
    .replace(/^a=/, '')
    .replace(/^candidate:/, '')
    .trim();
  if (!text) return null;
  const parts = text.split(/\s+/);
  const typIndex = parts.indexOf('typ');
  if (parts.length < 8 || typIndex < 0) return null;
  const type = parts[typIndex + 1];
  const protocol = parts[2]?.toLowerCase();
  if (!type || !protocol) return null;
  return {
    type,
    protocol,
    address: parts[4] ?? null,
    port: Number(parts[5]) || null,
  };
}

/**
 * Turns gathered candidates into the one answer an agent's network admin needs:
 * can media leave this network directly, only through a relay, or not at all.
 *
 * Without a STUN or TURN server there is nothing to reflect off, so the verdict
 * is `untested` — reporting "blocked" there would blame the network for a
 * missing setting.
 */
export function classifyIceCandidates(
  lines: string[],
  options: { stunConfigured?: boolean } = {},
): IceSummary {
  const parsed = (lines ?? [])
    .map((line) => parseCandidate(line))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const candidateTypes = [...new Set(parsed.map((c) => c.type))].sort();
  const protocols = [...new Set(parsed.map((c) => c.protocol))].sort();
  const hasHost = candidateTypes.includes('host');
  const hasReflexive =
    candidateTypes.includes('srflx') || candidateTypes.includes('prflx');
  const hasRelay = candidateTypes.includes('relay');
  const base = { candidateTypes, protocols, hasHost, hasReflexive, hasRelay };

  if (!parsed.length)
    return {
      ...base,
      udpEgress: false,
      verdict: 'blocked',
      reason:
        'The browser produced no ICE candidates at all, so WebRTC cannot start on this machine.',
    };
  if (!options.stunConfigured)
    return {
      ...base,
      udpEgress: null,
      verdict: 'untested',
      reason:
        'Only local candidates were gathered. No STUN or TURN server is configured, so whether media can leave this network was not tested.',
    };
  if (hasReflexive)
    return {
      ...base,
      udpEgress: true,
      verdict: 'direct',
      reason:
        'A server-reflexive candidate came back, so UDP leaves this network and media can take a direct path.',
    };
  if (hasRelay)
    return {
      ...base,
      udpEgress: false,
      verdict: 'relay_required',
      reason:
        'Only relay candidates were gathered. Media will work but must go through TURN, which adds latency and bandwidth cost.',
    };
  return {
    ...base,
    udpEgress: false,
    verdict: 'blocked',
    reason:
      'STUN was reachable but returned no reflexive candidate, so UDP is being blocked. A TURN server on TCP/443 is needed on this network.',
  };
}

export type RtcStatLike = Record<string, unknown>;

export type RtcProbeSummary = {
  codec: string | null;
  clockRateHz: number | null;
  channels: number | null;
  sendBitrateKbps: number | null;
  packetsSent: number | null;
  packetsReceived: number | null;
  packetsLost: number | null;
  lossPercent: number | null;
  jitterMs: number | null;
  roundTripMs: number | null;
  /** What these numbers traversed. `loopback` never left the machine. */
  scope: 'loopback' | 'relayed' | 'unknown';
};

const num = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function findStat(
  reports: RtcStatLike[],
  predicate: (r: RtcStatLike) => boolean,
) {
  return reports.find((report) => predicate(report)) ?? null;
}

const isAudio = (report: RtcStatLike) =>
  report.kind === 'audio' || report.mediaType === 'audio' || !report.kind;

/**
 * Reads an `RTCStatsReport` (flattened to an array) into the figures §6 asks
 * for. `scope` records where they came from, because the same jitter number
 * means something very different on a loopback than on a relayed path.
 */
export function summariseRtcStats(
  reports: RtcStatLike[],
  options: { elapsedMs?: number; scope?: RtcProbeSummary['scope'] } = {},
): RtcProbeSummary {
  const list = reports ?? [];
  const outbound = findStat(
    list,
    (r) => r.type === 'outbound-rtp' && isAudio(r),
  );
  const inbound = findStat(list, (r) => r.type === 'inbound-rtp' && isAudio(r));
  const codecStat =
    findStat(
      list,
      (r) => r.type === 'codec' && !!outbound && r.id === outbound.codecId,
    ) ?? findStat(list, (r) => r.type === 'codec');
  const pair =
    findStat(list, (r) => r.type === 'candidate-pair' && r.selected === true) ??
    findStat(
      list,
      (r) =>
        r.type === 'candidate-pair' &&
        r.state === 'succeeded' &&
        r.nominated === true,
    ) ??
    findStat(
      list,
      (r) => r.type === 'candidate-pair' && r.state === 'succeeded',
    );

  const mimeType =
    typeof codecStat?.mimeType === 'string' ? codecStat.mimeType : null;
  const elapsedMs = num(options.elapsedMs);
  const bytesSent = num(outbound?.bytesSent);
  const sendBitrateKbps =
    bytesSent !== null && elapsedMs !== null && elapsedMs > 0
      ? Math.round(((bytesSent * 8) / (elapsedMs / 1000) / 1000) * 10) / 10
      : null;

  const packetsReceived = num(inbound?.packetsReceived);
  const packetsLost = num(inbound?.packetsLost);
  const delivered =
    packetsReceived !== null && packetsLost !== null
      ? packetsReceived + Math.max(0, packetsLost)
      : null;
  const lossPercent =
    delivered !== null && delivered > 0 && packetsLost !== null
      ? Math.round((Math.max(0, packetsLost) / delivered) * 1000) / 10
      : null;

  const jitterSeconds = num(inbound?.jitter);
  const rttSeconds = num(pair?.currentRoundTripTime);

  return {
    codec: mimeType ? mimeType.replace(/^audio\//i, '') : null,
    clockRateHz: num(codecStat?.clockRate),
    channels: num(codecStat?.channels),
    sendBitrateKbps,
    packetsSent: num(outbound?.packetsSent),
    packetsReceived,
    packetsLost,
    lossPercent,
    jitterMs:
      jitterSeconds === null ? null : Math.round(jitterSeconds * 10000) / 10,
    roundTripMs:
      rttSeconds === null ? null : Math.round(rttSeconds * 10000) / 10,
    scope: options.scope ?? 'unknown',
  };
}

export type TransportSamples = {
  /** Audio each media frame carries, in ms — 20 for G.711 at 8 kHz. */
  frameMs: number;
  /** Payload bytes in one frame — 160 for 20 ms of mulaw. */
  frameBytes: number;
  framesSent: number;
  /** Monotonic arrival times of received media frames, oldest first. */
  arrivalsMs: number[];
  /** Round trips measured over the audio socket itself, not over HTTP. */
  socketRttsMs: number[];
  /** How long the socket has been carrying audio. */
  durationMs: number;
};

export type TransportSummary = {
  framesSent: number;
  framesReceived: number;
  sendKbps: number;
  receiveKbps: number;
  /** How far frame arrivals stray from the expected cadence. */
  pacingJitterMs: number;
  /** The worst gap that counted as a dropout, in ms. */
  worstGapMs: number;
  /** Gaps mid-speech long enough for the agent to hear audio cut out. */
  underruns: number;
  /**
   * The longest quiet stretch, whatever the cause. Reported separately because
   * a long one is usually the far side thinking, not a fault.
   */
  longestSilenceMs: number;
  socketRttMs: number;
  socketJitterMs: number;
  score: number;
  band: QualityBand;
  warnings: Array<{ code: string; message: string }>;
  primaryIssue: string | null;
};

/**
 * Scores the live dialer socket. Unlike the pre-call HTTP probe, every number
 * here comes from audio that was actually carried, which is why an underrun
 * counts for more than a slow round trip: the agent heard that one.
 */
export function summariseTransport(
  samples: TransportSamples,
): TransportSummary {
  const frameMs = samples.frameMs > 0 ? samples.frameMs : 20;
  const frameBytes = samples.frameBytes > 0 ? samples.frameBytes : 160;
  const arrivals = (samples.arrivalsMs ?? []).filter((value) =>
    Number.isFinite(value),
  );
  const framesReceived = arrivals.length;
  const framesSent = Math.max(0, samples.framesSent ?? 0);
  const durationSeconds = Math.max(0.001, (samples.durationMs ?? 0) / 1000);

  const gaps: number[] = [];
  for (let index = 1; index < arrivals.length; index += 1)
    gaps.push(arrivals[index] - arrivals[index - 1]);
  const longestSilenceMs = gaps.length ? Math.round(Math.max(...gaps)) : 0;
  // A gap is only a dropout inside a stretch of speech. Beyond a second, the
  // far side simply is not talking — while the agent thinks, or between turns —
  // and counting that as lost audio makes a healthy call look broken. This was
  // real: a 4.3 s pause for reasoning was being reported as a network stall.
  const stallThreshold = frameMs * 3;
  const silenceThreshold = 1000;
  const stalls = gaps.filter(
    (gap) => gap > stallThreshold && gap <= silenceThreshold,
  );
  const underruns = stalls.length;
  const worstGapMs = stalls.length ? Math.round(Math.max(...stalls)) : 0;
  // Pacing is measured over the gaps that were neither stalls nor silence. A
  // dropout already counts as an underrun, and letting it inflate the jitter
  // figure too would report one problem twice and bury the metric that names
  // it — a stalled call would blame "choppy pacing" instead of the gaps heard.
  const cadenceGaps = gaps.filter((gap) => gap <= stallThreshold);
  const pacingJitterMs = cadenceGaps.length
    ? Math.round(
        (cadenceGaps.reduce((sum, gap) => sum + Math.abs(gap - frameMs), 0) /
          cadenceGaps.length) *
          10,
      ) / 10
    : 0;

  const kbps = (frames: number) =>
    Math.round(((frames * frameBytes * 8) / durationSeconds / 1000) * 10) / 10;
  const rtts = (samples.socketRttsMs ?? []).filter(
    (value) => Number.isFinite(value) && value >= 0,
  );
  const socketRttMs = Math.round(medianOf(rtts));
  const socketJitterMs = Math.round(jitterOf(rtts));

  const penalties: Array<{ code: string; cost: number; message: string }> = [];
  if (!framesReceived)
    penalties.push({
      code: 'no_downstream_audio',
      cost: 100,
      message:
        'No audio came back over the call socket, so the agent heard nothing at all.',
    });
  else {
    if (underruns > 6)
      penalties.push({
        code: 'underruns_severe',
        cost: 45,
        message: `Audio stalled ${underruns} times during the call. The caller heard gaps — use a wired connection.`,
      });
    else if (underruns > 0)
      penalties.push({
        code: 'underruns_present',
        cost: 18,
        message: `Audio stalled ${underruns} time${underruns === 1 ? '' : 's'} (worst gap ${worstGapMs} ms).`,
      });

    if (pacingJitterMs > 40)
      penalties.push({
        code: 'pacing_severe',
        cost: 30,
        message: `Frames arrived ${pacingJitterMs} ms off cadence. Speech will sound choppy.`,
      });
    else if (pacingJitterMs > 15)
      penalties.push({
        code: 'pacing_uneven',
        cost: 12,
        message: `Frame pacing drifted by ${pacingJitterMs} ms.`,
      });
  }

  if (rtts.length) {
    if (socketRttMs > 400)
      penalties.push({
        code: 'socket_rtt_severe',
        cost: 35,
        message: `The call socket round trip is ${socketRttMs} ms. Replies will land visibly late.`,
      });
    else if (socketRttMs > 200)
      penalties.push({
        code: 'socket_rtt_high',
        cost: 15,
        message: `The call socket round trip is ${socketRttMs} ms.`,
      });
  }

  if (framesSent > 0 && framesReceived > 0 && framesSent > framesReceived * 40)
    penalties.push({
      code: 'downstream_starved',
      cost: 20,
      message:
        'Far more audio was sent than received. The agent side is fine but replies are barely arriving.',
    });

  penalties.sort((a, b) => b.cost - a.cost);
  const score = Math.max(
    0,
    Math.min(100, 100 - penalties.reduce((sum, item) => sum + item.cost, 0)),
  );
  return {
    framesSent,
    framesReceived,
    sendKbps: kbps(framesSent),
    receiveKbps: kbps(framesReceived),
    pacingJitterMs,
    worstGapMs,
    underruns,
    longestSilenceMs,
    socketRttMs,
    socketJitterMs,
    score,
    band:
      score >= 85
        ? 'excellent'
        : score >= 65
          ? 'good'
          : score >= 40
            ? 'fair'
            : 'poor',
    warnings: penalties.map(({ code, message }) => ({ code, message })),
    primaryIssue: penalties[0]?.code ?? null,
  };
}

/** Validates operator-supplied ICE servers before a browser is handed them. */
export function normaliseIceServers(input: unknown) {
  const raw = Array.isArray(input) ? input : [];
  const servers: Array<{
    urls: string[];
    username?: string;
    credential?: string;
  }> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const urls = (Array.isArray(record.urls) ? record.urls : [record.urls])
      .filter((url): url is string => typeof url === 'string')
      .map((url) => url.trim())
      .filter((url) => /^(stuns?|turns?):[^\s]+$/i.test(url));
    if (!urls.length) continue;
    const server: { urls: string[]; username?: string; credential?: string } = {
      urls,
    };
    if (typeof record.username === 'string' && record.username)
      server.username = record.username;
    if (typeof record.credential === 'string' && record.credential)
      server.credential = record.credential;
    servers.push(server);
  }
  return servers;
}
