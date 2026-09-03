#!/usr/bin/env node
/**
 * Simulated dashboard tab, for exercising the browser dialer without a
 * microphone. Asks Vaani to start a call, connects to the gateway with the
 * short-lived token, plays synthesised speech in as the agent's voice, and
 * prints what came back.
 *
 *   VAANI_BASE_URL=http://localhost:3000 COOKIE=<session cookie> \
 *   node test-harness/browser-dialer.mjs
 */
import WebSocket from 'ws';

import { encodeG711, resample, wavToPcm } from '../src/audio.js';
import { summariseTransport } from '../../../lib/rtc-diagnostics.ts';

const BASE = process.env.VAANI_BASE_URL ?? 'http://localhost:3000';
const COOKIE = process.env.COOKIE ?? '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, body, method = 'POST') {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie: COOKIE },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const options = await api('/api/app/dialer', null, 'GET');
const agent = options.body?.agents?.[0];
if (!agent) {
  console.error('no agent available:', JSON.stringify(options.body).slice(0, 200));
  process.exit(2);
}
console.log(JSON.stringify({ step: 'options', gatewayConfigured: options.body.gatewayConfigured, agent: agent.name }));

const started = await api('/api/app/dialer', { action: 'start', agentId: agent.id });
if (started.status !== 200) {
  console.error('start failed:', JSON.stringify(started.body));
  process.exit(1);
}
const { callId, token, gatewayUrl } = started.body;
console.log(JSON.stringify({ step: 'started', callId, tokenLooksScoped: token.startsWith('v1.' + callId + '.'), note: started.body.note }));

/** Borrow Vaani's TTS as the agent's voice. */
async function speech() {
  const response = await fetch(`${BASE}/api/internal/voice-turn`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-vaani-gateway-secret': process.env.MEDIA_GATEWAY_SECRET ?? '',
    },
    body: JSON.stringify({ callId, greeting: true }),
  });
  const body = await response.json();
  if (!body.audioBase64) throw new Error('no audio: ' + JSON.stringify(body).slice(0, 200));
  return { audio: Buffer.from(body.audioBase64, 'base64'), contentType: body.contentType };
}

const received = { media: 0, bytes: 0, transcripts: [] };
// Mirrors what the real tab measures: arrival times, frames sent, and round
// trip over the audio socket itself.
const metrics = { framesSent: 0, arrivals: [], rtts: [], openedAt: 0 };
const socket = new WebSocket(`${gatewayUrl}/?carrier=browser&token=${encodeURIComponent(token)}`);

socket.on('open', () => {
  socket.send(JSON.stringify({ event: 'start', encoding: 'mulaw', sampleRate: 8000 }));
  metrics.openedAt = Date.now();
  socket.send(JSON.stringify({ event: 'ping', at: Date.now() }));
});
const pinger = setInterval(() => {
  if (socket.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify({ event: 'ping', at: Date.now() }));
}, 2000);
socket.on('message', (data) => {
  const frame = JSON.parse(data.toString());
  if (frame.event === 'pong') metrics.rtts.push(Date.now() - frame.at);
  if (frame.event === 'media') {
    received.media += 1;
    received.bytes += Buffer.from(frame.media.payload, 'base64').length;
    metrics.arrivals.push(performance.now());
  }
  if (frame.event === 'transcript') received.transcripts.push(frame);
});
socket.on('close', (code, reason) => {
  if (received.media === 0)
    console.log(JSON.stringify({ step: 'closed_early', code, reason: reason.toString() }));
});

await sleep(6000);
console.log(JSON.stringify({ step: 'after_greeting', mediaFrames: received.media, bytes: received.bytes }));

const { audio, contentType } = await speech();
let mulaw;
if (/basic|ulaw/i.test(contentType ?? '')) mulaw = audio;
else {
  const decoded = wavToPcm(audio);
  mulaw = encodeG711(resample(decoded.samples, decoded.sampleRate, 8000), 'mulaw');
}
for (let offset = 0; offset < mulaw.length; offset += 160) {
  socket.send(JSON.stringify({ event: 'media', media: { payload: mulaw.subarray(offset, offset + 160).toString('base64') } }));
  metrics.framesSent += 1;
  await sleep(5);
}
const silence = encodeG711(new Int16Array(160), 'mulaw').toString('base64');
for (let i = 0; i < 45; i += 1) {
  socket.send(JSON.stringify({ event: 'media', media: { payload: silence } }));
  metrics.framesSent += 1;
  await sleep(5);
}
const before = received.media;
await sleep(15_000);
console.log(JSON.stringify({
  step: 'after_turn',
  replyFrames: received.media - before,
  transcripts: received.transcripts.map((t) => ({ heard: t.heard?.slice(0, 40), reply: t.reply?.slice(0, 40), latency: t.latency })),
}));

clearInterval(pinger);
const transport = summariseTransport({
  frameMs: 20,
  frameBytes: 160,
  framesSent: metrics.framesSent,
  arrivalsMs: metrics.arrivals,
  socketRttsMs: metrics.rtts,
  durationMs: Date.now() - metrics.openedAt,
});
console.log(JSON.stringify({
  step: 'audio_path',
  socketRtts: metrics.rtts.length,
  socketRttMs: transport.socketRttMs,
  band: transport.band,
  score: transport.score,
  sendKbps: transport.sendKbps,
  receiveKbps: transport.receiveKbps,
  pacingJitterMs: transport.pacingJitterMs,
  underruns: transport.underruns,
}));

socket.send(JSON.stringify({ event: 'stop' }));
socket.close();
const ended = await api('/api/app/dialer', { action: 'end', callId, transport });
console.log(JSON.stringify({ step: 'ended', status: ended.status, ...ended.body }));
process.exit(0);
