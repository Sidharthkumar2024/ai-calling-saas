import {
  parseCandidate,
  classifyIceCandidates,
  summariseRtcStats,
  summariseTransport,
  normaliseIceServers,
} from '../lib/rtc-diagnostics.ts';

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) pass++;
  else fail++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
};

console.log('candidate parsing:');
const host = parseCandidate(
  'candidate:1 1 udp 2122260223 192.168.1.5 54321 typ host generation 0',
);
ok('host candidate parsed', host?.type === 'host' && host.protocol === 'udp');
const srflx = parseCandidate(
  'a=candidate:842163049 1 udp 1677729535 203.0.113.4 41234 typ srflx raddr 192.168.1.5 rport 54321',
);
ok('srflx parsed through the a= prefix', srflx?.type === 'srflx');
ok(
  'reflexive address is the public one, not the private raddr',
  srflx?.address === '203.0.113.4',
);
const relay = parseCandidate(
  'candidate:9 1 tcp 41819902 198.51.100.7 443 typ relay raddr 0.0.0.0 rport 0',
);
ok(
  'relay over tcp parsed',
  relay?.type === 'relay' && relay.protocol === 'tcp',
);
ok('garbage rejected', parseCandidate('not a candidate') === null);
ok('empty rejected', parseCandidate('') === null);
ok(
  'truncated line rejected',
  parseCandidate('candidate:1 1 udp 21222') === null,
);

console.log('ICE classification:');
const untested = classifyIceCandidates([
  'candidate:1 1 udp 2122260223 192.168.1.5 54321 typ host generation 0',
]);
ok(
  'no STUN configured → untested, not blocked',
  untested.verdict === 'untested',
);
ok(
  'HONEST: udpEgress is null when nothing tested it, not false',
  untested.udpEgress === null,
);
const direct = classifyIceCandidates(
  [
    'candidate:1 1 udp 2122260223 192.168.1.5 54321 typ host',
    'candidate:2 1 udp 1677729535 203.0.113.4 41234 typ srflx raddr 192.168.1.5 rport 54321',
  ],
  { stunConfigured: true },
);
ok('reflexive candidate → direct', direct.verdict === 'direct');
ok('direct implies UDP egress', direct.udpEgress === true);
const relayOnly = classifyIceCandidates(
  [
    'candidate:1 1 udp 2122260223 192.168.1.5 54321 typ host',
    'candidate:9 1 tcp 41819902 198.51.100.7 443 typ relay raddr 0.0.0.0 rport 0',
  ],
  { stunConfigured: true },
);
ok('relay only → relay_required', relayOnly.verdict === 'relay_required');
const blocked = classifyIceCandidates(
  ['candidate:1 1 udp 2122260223 192.168.1.5 54321 typ host'],
  { stunConfigured: true },
);
ok(
  'STUN configured but no reflexive → blocked (the corporate firewall case)',
  blocked.verdict === 'blocked',
);
ok('blocked names TURN on 443 as the fix', /TURN/.test(blocked.reason));
const none = classifyIceCandidates([], { stunConfigured: true });
ok('no candidates at all → blocked', none.verdict === 'blocked');

console.log('RTCStats reading:');
const reports = [
  {
    type: 'outbound-rtp',
    kind: 'audio',
    codecId: 'C1',
    bytesSent: 24000,
    packetsSent: 500,
  },
  {
    type: 'inbound-rtp',
    kind: 'audio',
    packetsReceived: 495,
    packetsLost: 5,
    jitter: 0.0032,
  },
  {
    type: 'codec',
    id: 'C1',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    type: 'candidate-pair',
    state: 'succeeded',
    nominated: true,
    currentRoundTripTime: 0.042,
  },
];
const stats = summariseRtcStats(reports, {
  elapsedMs: 10000,
  scope: 'loopback',
});
ok('codec read from the matching codec stat', stats.codec === 'opus');
ok('clock rate read', stats.clockRateHz === 48000);
ok('bitrate = bytes×8 over elapsed', stats.sendBitrateKbps === 19.2);
ok('loss computed against delivered+lost', stats.lossPercent === 1);
ok('jitter converted from seconds to ms', stats.jitterMs === 3.2);
ok('round trip converted from seconds to ms', stats.roundTripMs === 42);
ok('scope is carried, not guessed', stats.scope === 'loopback');
const empty = summariseRtcStats([], {});
ok(
  'HONEST: nothing measured returns null, never zero',
  empty.codec === null && empty.jitterMs === null && empty.lossPercent === null,
);
ok(
  'bitrate needs elapsed time',
  summariseRtcStats(reports, {}).sendBitrateKbps === null,
);
const wrongCodec = summariseRtcStats(
  [
    { type: 'outbound-rtp', kind: 'audio', codecId: 'C9', bytesSent: 100 },
    { type: 'codec', id: 'C1', mimeType: 'audio/PCMU', clockRate: 8000 },
  ],
  { elapsedMs: 1000 },
);
ok('falls back to the only codec stat present', wrongCodec.codec === 'PCMU');

console.log('live socket transport:');
const clean = [];
for (let i = 0; i < 200; i += 1) clean.push(i * 20);
const good = summariseTransport({
  frameMs: 20,
  frameBytes: 160,
  framesSent: 200,
  arrivalsMs: clean,
  socketRttsMs: [30, 32, 29, 31],
  durationMs: 4000,
});
ok('clean 20ms cadence scores excellent', good.band === 'excellent');
ok('no underruns on clean cadence', good.underruns === 0);
ok('64 kbps for mulaw at 20ms frames', good.receiveKbps === 64);
ok('pacing jitter ~0 on perfect cadence', good.pacingJitterMs === 0);
ok('median socket RTT reported', good.socketRttMs === 31);

const stalled = [0, 20, 40, 400, 420, 440, 900, 920];
const bad = summariseTransport({
  frameMs: 20,
  frameBytes: 160,
  framesSent: 100,
  arrivalsMs: stalled,
  socketRttsMs: [],
  durationMs: 1000,
});
ok('two mid-speech stalls counted as underruns', bad.underruns === 2);
ok('worst gap is the biggest stall, not the average', bad.worstGapMs === 460);
ok(
  'underruns are named as the primary issue',
  bad.primaryIssue === 'underruns_present',
);
ok(
  'NOT DOUBLE-COUNTED: a stall inflates the underrun count, not the pacing figure',
  bad.pacingJitterMs === 0,
);

// A pause while the AI reasons is not a lost packet. This was measured on a
// live call: a 4.3-second thinking gap was being reported as a network stall.
const thinking = summariseTransport({
  frameMs: 20,
  frameBytes: 160,
  framesSent: 300,
  arrivalsMs: [0, 20, 40, 60, 4360, 4380, 4400, 4420],
  socketRttsMs: [30],
  durationMs: 6000,
});
ok(
  'THE FALSE POSITIVE: a 4.3s thinking pause is not counted as a dropout',
  thinking.underruns === 0,
);
ok(
  'the pause is still reported, as silence',
  thinking.longestSilenceMs === 4300,
);
ok(
  'a call that only paused to think stays excellent',
  thinking.band === 'excellent',
);
ok(
  'a long silence does not distort the pacing figure either',
  thinking.pacingJitterMs === 0,
);

const silent = summariseTransport({
  frameMs: 20,
  frameBytes: 160,
  framesSent: 300,
  arrivalsMs: [],
  socketRttsMs: [40],
  durationMs: 6000,
});
ok(
  'THE ONE THAT MATTERS: audio sent but none received scores poor',
  silent.band === 'poor' && silent.primaryIssue === 'no_downstream_audio',
);
ok('silence does not report a fake receive bitrate', silent.receiveKbps === 0);

const slow = summariseTransport({
  frameMs: 20,
  frameBytes: 160,
  framesSent: 200,
  arrivalsMs: clean,
  socketRttsMs: [520, 540, 500],
  durationMs: 4000,
});
ok(
  'a slow socket is flagged even when pacing is clean',
  slow.primaryIssue === 'socket_rtt_severe',
);
ok('a slow socket is still usable, not poor', slow.band === 'good');

console.log('ICE server validation:');
const servers = normaliseIceServers([
  { urls: 'stun:stun.example.net:3478' },
  {
    urls: ['turn:turn.example.net:443?transport=tcp'],
    username: 'u',
    credential: 'p',
  },
  { urls: 'http://evil.example.net' },
  { urls: '' },
  'not an object',
  null,
]);
ok('two valid servers kept', servers.length === 2);
ok(
  'turn credentials preserved',
  servers[1].username === 'u' && servers[1].credential === 'p',
);
ok(
  'a non-ICE scheme is dropped, so no browser is pointed at http',
  !JSON.stringify(servers).includes('evil'),
);
ok('urls always normalised to an array', Array.isArray(servers[0].urls));
ok(
  'garbage input yields an empty list',
  normaliseIceServers('nope').length === 0,
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
