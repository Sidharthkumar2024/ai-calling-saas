#!/usr/bin/env node
/**
 * Simulated carrier, for exercising the gateway without a telephony account.
 *
 * Connects as Twilio would, sends a start frame carrying a Vaani call id,
 * listens to the greeting, then speaks as the caller and waits for the reply.
 *
 *   VAANI_BASE_URL=http://localhost:3000 \
 *   MEDIA_GATEWAY_SECRET=... CALL_ID=call_xxx \
 *   node test-harness/carrier.mjs
 *
 * The "caller voice" is produced by Vaani's own text-to-speech, so this
 * exercises the real speech-to-text, reasoning and synthesis path end to end.
 */
import WebSocket from 'ws';

import { encodeG711, resample, wavToPcm } from '../src/audio.js';

const SECRET = process.env.MEDIA_GATEWAY_SECRET;
const BASE = process.env.VAANI_BASE_URL ?? 'http://localhost:3000';
const CALL_ID = process.env.CALL_ID;
const GATEWAY = process.env.GATEWAY_URL ?? 'ws://localhost:8787';
if (!SECRET || !CALL_ID) {
  console.error('MEDIA_GATEWAY_SECRET and CALL_ID are required.');
  process.exit(2);
}

/** Borrow Vaani's TTS to produce audio that sounds like a caller. */
async function callerSpeech() {
  const response = await fetch(`${BASE}/api/internal/voice-turn`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-vaani-gateway-secret': SECRET,
    },
    body: JSON.stringify({ callId: CALL_ID, greeting: true }),
  });
  const body = await response.json();
  if (!body.audioBase64)
    throw new Error(`no TTS audio: ${JSON.stringify(body).slice(0, 200)}`);
  return { audio: Buffer.from(body.audioBase64, 'base64'), contentType: body.contentType };
}

const received = { media: 0, clear: 0, bytes: 0 };
const socket = new WebSocket(
  `${GATEWAY}/?carrier=twilio&token=${encodeURIComponent(SECRET)}`,
);

socket.on('open', () => {
  socket.send(
    JSON.stringify({
      event: 'start',
      start: {
        streamSid: 'MZprobe',
        callSid: 'CAprobe',
        customParameters: { callId: CALL_ID },
        mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000 },
      },
    }),
  );
});

socket.on('message', (data) => {
  const frame = JSON.parse(data.toString());
  if (frame.event === 'media') {
    received.media += 1;
    received.bytes += Buffer.from(frame.media.payload, 'base64').length;
  }
  if (frame.event === 'clear') received.clear += 1;
});
socket.on('error', (error) => {
  console.error('socket error:', error.message);
  process.exit(1);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

setTimeout(async () => {
  console.log(JSON.stringify({ phase: 'after_greeting', ...received }));
  const { audio, contentType } = await callerSpeech();
  let samples;
  if (/wav/i.test(contentType ?? '')) {
    const decoded = wavToPcm(audio);
    samples = resample(decoded.samples, decoded.sampleRate, 8000);
  } else if (/basic|ulaw/i.test(contentType ?? '')) {
    // Already 8 kHz mulaw: replay the bytes as the carrier would.
    samples = null;
    for (let offset = 0; offset < audio.length; offset += 160) {
      socket.send(
        JSON.stringify({
          event: 'media',
          media: { payload: audio.subarray(offset, offset + 160).toString('base64') },
        }),
      );
      await sleep(5);
    }
  } else {
    throw new Error(`caller audio is ${contentType}; expected wav or mulaw`);
  }
  if (samples) {
    for (let offset = 0; offset < samples.length; offset += 160) {
      socket.send(
        JSON.stringify({
          event: 'media',
          media: {
            payload: encodeG711(
              samples.subarray(offset, offset + 160),
              'mulaw',
            ).toString('base64'),
          },
        }),
      );
      await sleep(5);
    }
  }
  // Then silence, so the turn detector closes the caller's turn.
  const silence = encodeG711(new Int16Array(160), 'mulaw').toString('base64');
  for (let index = 0; index < 45; index += 1) {
    socket.send(JSON.stringify({ event: 'media', media: { payload: silence } }));
    await sleep(5);
  }
  const before = received.media;
  await sleep(15_000);
  console.log(
    JSON.stringify({
      phase: 'after_caller_turn',
      replyFrames: received.media - before,
      ...received,
    }),
  );
  socket.send(JSON.stringify({ event: 'stop' }));
  socket.close();
  process.exit(0);
}, 6000);
