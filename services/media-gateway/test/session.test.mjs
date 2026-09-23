import { CallSession } from '../src/session.js';
import { encodeG711, pcmToWav } from '../src/audio.js';

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) pass++;
  else fail++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A Vaani that answers instantly with a short beep, recording what it heard. */
function fakeClient({ replyMs = 200, keepListening = false } = {}) {
  const calls = { greeting: 0, turns: [] };
  const tone = () => {
    const samples = new Int16Array(Math.round(8000 * (replyMs / 1000)));
    for (let i = 0; i < samples.length; i += 1)
      samples[i] = Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / 8000));
    return pcmToWav(samples, 8000).toString('base64');
  };
  return {
    calls,
    async greeting() {
      calls.greeting += 1;
      return {
        replyText: 'greeting',
        audioBase64: tone(),
        contentType: 'audio/wav',
        endCall: false,
      };
    },
    async turn(callId, wav) {
      calls.turns.push({ callId, wavBytes: wav.length });
      if (keepListening) return { keepListening: true };
      return {
        transcript: 'हाँ जी',
        replyText: 'ठीक है',
        audioBase64: tone(),
        contentType: 'audio/wav',
        endCall: false,
      };
    },
  };
}

function harness(client, carrier = 'twilio') {
  const sent = [];
  const closed = [];
  const logs = [];
  const session = new CallSession({
    carrier,
    client,
    send: (frame) => sent.push(JSON.parse(frame)),
    close: (code, reason) => closed.push({ code, reason }),
    log: (event, fields) => logs.push({ event, ...fields }),
  });
  return { session, sent, closed, logs };
}

const startFrame = (callId = 'call_test') =>
  JSON.stringify({
    event: 'start',
    start: {
      streamSid: 'MZ1',
      callSid: 'CA1',
      customParameters: { callId },
      mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000 },
    },
  });

const mediaFrame = (level) => {
  const samples = new Int16Array(160).fill(Math.round(level * 32767));
  return JSON.stringify({
    event: 'media',
    media: { payload: encodeG711(samples, 'mulaw').toString('base64') },
  });
};

const feed = async (session, level, frames) => {
  for (let i = 0; i < frames; i += 1) await session.handle(mediaFrame(level));
};

console.log('call start:');
{
  const client = fakeClient();
  const { session, sent, closed, logs } = harness(client);
  await session.handle(startFrame());
  ok('a start frame greets the caller', client.calls.greeting === 1);
  ok('greeting audio is streamed as media frames', sent.length > 1);
  ok(
    'frames are 20ms each, not one big blob',
    sent.every((f) => f.event === 'media') &&
      Buffer.from(sent[0].media.payload, 'base64').length === 160,
  );
  ok('the call was not closed', closed.length === 0);
  ok(
    'playback telemetry is attributable to the call',
    logs.some(
      (entry) =>
        entry.event === 'playback_start' && entry.callId === 'call_test',
    ),
  );
}

console.log('Vobiz acknowledgements:');
{
  const client = fakeClient();
  const { session, logs } = harness(client, 'vobiz');
  session.callId = 'call_vobiz_ack';
  await session.handle(JSON.stringify({ event: 'playedStream' }));
  ok(
    'Vobiz playback acknowledgement is attributable to the call',
    logs.some(
      (entry) =>
        entry.event === 'carrier_ack' &&
        entry.callId === 'call_vobiz_ack' &&
        entry.acknowledgement === 'playedStream',
    ),
  );
}

console.log('missing call id:');
{
  const client = fakeClient();
  const { session, closed } = harness(client);
  await session.handle(
    JSON.stringify({ event: 'start', start: { streamSid: 'MZ1' } }),
  );
  ok(
    'a stream with no Vaani call id is refused rather than answered',
    closed.length === 1 &&
      closed[0].code === 1008 &&
      client.calls.greeting === 0,
  );
}

console.log('caller turn:');
{
  const client = fakeClient({ replyMs: 60 });
  const { session, sent } = harness(client);
  await session.handle(startFrame());
  await sleep(200); // let the greeting finish playing
  const before = sent.length;
  await feed(session, 0.4, 20); // 400ms speech
  await feed(session, 0, 40); // 800ms silence -> turn_end
  await sleep(400);
  ok('the caller turn reached Vaani', client.calls.turns.length === 1);
  ok(
    'audio was sent as a WAV with a real payload',
    client.calls.turns[0].wavBytes > 44,
  );
  ok('the reply was streamed back', sent.length > before);
}

console.log('silence handling:');
{
  const client = fakeClient({ keepListening: true });
  const { session } = harness(client);
  await session.handle(startFrame());
  await sleep(200);
  await feed(session, 0.4, 20);
  await feed(session, 0, 40);
  await sleep(200);
  ok(
    'a turn Vaani could not transcribe does not end the call',
    client.calls.turns.length === 1,
  );
}

console.log('barge-in:');
{
  const client = fakeClient({ replyMs: 2000 }); // long reply to interrupt
  const { session, sent } = harness(client);
  // Fire and forget, exactly as the socket handler does: playback must not
  // block inbound frames, or the caller could never interrupt.
  void session.handle(startFrame());
  await sleep(120); // greeting is still playing
  ok(
    'the agent is marked as speaking',
    session.detector.agentSpeaking === true,
  );
  await feed(session, 0.5, 15); // 300ms of speech over the agent
  ok('barge-in was detected', session.stats.bargeIns === 1);
  ok(
    'a clear frame was sent so queued audio is discarded',
    sent.some((f) => f.event === 'clear'),
  );
  const afterBarge = sent.length;
  await sleep(150);
  ok('playback stopped instead of continuing', sent.length === afterBarge);
  ok(
    'the agent is no longer marked as speaking',
    session.detector.agentSpeaking === false,
  );
}

console.log('failure handling:');
{
  const client = {
    calls: { greeting: 0 },
    async greeting() {
      this.calls.greeting += 1;
      return {
        replyText: 'hi',
        audioBase64: 'not-valid-audio',
        contentType: 'audio/wav',
        endCall: false,
      };
    },
    async turn() {
      throw new Error('Vaani is down');
    },
  };
  const { session, closed } = harness(client);
  await session.handle(startFrame());
  ok(
    'undecodable greeting audio is reported, not crashed on',
    session.stats.errors === 1 && closed.length === 0,
  );
  await feed(session, 0.4, 20);
  await feed(session, 0, 40);
  await sleep(120);
  ok(
    'a failed turn is counted and the call stays up',
    session.stats.errors === 2 && closed.length === 0,
  );
}

console.log('greeting provider failure:');
{
  const client = {
    async greeting() {
      throw new Error('primary TTS timed out');
    },
    async turn() {
      return { keepListening: true };
    },
  };
  const { session, closed } = harness(client);
  await session.handle(startFrame());
  ok(
    'a failed greeting is reported without closing the carrier stream',
    session.stats.errors === 1 && closed.length === 0 && session.started,
  );
}

console.log('end of call:');
{
  const client = fakeClient();
  const { session } = harness(client);
  await session.handle(startFrame());
  await session.handle(JSON.stringify({ event: 'stop' }));
  ok('a stop frame ends the session', session.ended === true);
  const before = client.calls.turns.length;
  await feed(session, 0.4, 30);
  ok('no audio is processed after stop', client.calls.turns.length === before);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
