#!/usr/bin/env node
/**
 * Two legs in one room: an agent and a supervisor.
 *
 * Proves the routing rule that matters most — a supervisor's whisper reaches
 * the agent and nobody else — against the real gateway rather than only the
 * unit tests.
 */
import WebSocket from 'ws';

import { encodeG711 } from '../src/audio.js';
import { mintDialerToken } from '../src/dialer-token.js';

const SECRET = process.env.MEDIA_GATEWAY_SECRET;
const GATEWAY = process.env.GATEWAY_URL ?? 'ws://localhost:8787';
const CALL_ID = process.env.CALL_ID;
if (!SECRET || !CALL_ID) {
  console.error('MEDIA_GATEWAY_SECRET and CALL_ID are required.');
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tone = (amplitude) => {
  const samples = new Int16Array(160);
  for (let i = 0; i < 160; i += 1)
    samples[i] = Math.round(amplitude * Math.sin((2 * Math.PI * 440 * i) / 8000));
  return encodeG711(samples, 'mulaw').toString('base64');
};

async function connect(label, { role, mode }) {
  const token = await mintDialerToken({ callId: CALL_ID, secret: SECRET, role, mode });
  const socket = new WebSocket(`${GATEWAY}/?carrier=browser&token=${encodeURIComponent(token)}`);
  const seen = { media: 0, closed: null };
  socket.on('message', (data) => {
    const frame = JSON.parse(data.toString());
    if (frame.event === 'media') seen.media += 1;
  });
  socket.on('close', (code, reason) => {
    seen.closed = { code, reason: reason.toString() };
  });
  await new Promise((resolve, reject) => {
    socket.on('open', resolve);
    socket.on('error', reject);
    setTimeout(() => reject(new Error(`${label} never opened`)), 5000);
  });
  socket.send(JSON.stringify({ event: 'start', encoding: 'mulaw', sampleRate: 8000 }));
  return { label, socket, seen };
}

const agent = await connect('agent', { role: 'agent', mode: 'duplex' });
// Let the greeting finish so its frames are not counted as forwarded audio.
await sleep(7000);

const supervisor = await connect('supervisor', { role: 'supervisor', mode: 'listen' });
await sleep(1500);
const supervisorBaseline = supervisor.seen.media;
const agentBaseline = agent.seen.media;

// The agent speaks: a silent monitor must hear it.
for (let i = 0; i < 25; i += 1) {
  agent.socket.send(JSON.stringify({ event: 'media', media: { payload: tone(9000) } }));
  await sleep(8);
}
await sleep(600);
const heardByMonitor = supervisor.seen.media - supervisorBaseline;

// The silent monitor speaks: the agent must hear nothing.
const beforeMonitorSpeaks = agent.seen.media;
for (let i = 0; i < 25; i += 1) {
  supervisor.socket.send(JSON.stringify({ event: 'media', media: { payload: tone(9000) } }));
  await sleep(8);
}
await sleep(600);
const leakedFromMonitor = agent.seen.media - beforeMonitorSpeaks;

console.log(
  JSON.stringify({
    agentAudioReachedMonitor: heardByMonitor > 0,
    monitorAudioLeakedToAgent: leakedFromMonitor > 0,
    frames: { heardByMonitor, leakedFromMonitor, agentBaseline },
    supervisorClosed: supervisor.seen.closed,
  }),
);

agent.socket.send(JSON.stringify({ event: 'stop' }));
supervisor.socket.send(JSON.stringify({ event: 'stop' }));
agent.socket.close();
supervisor.socket.close();
process.exit(0);
