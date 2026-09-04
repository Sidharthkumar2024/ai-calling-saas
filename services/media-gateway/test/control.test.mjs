import { CallSession } from '../src/session.js';
import { RoomRegistry } from '../src/mixer.js';
import { encodeG711, pcmToWav } from '../src/audio.js';

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) pass++;
  else fail++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeClient() {
  const calls = { greeting: 0, turns: [] };
  const tone = () => {
    const samples = new Int16Array(1600);
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

const startFrame = (callId = 'call_ctl') =>
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

function leg({ client, rooms, role = 'agent', mode = 'duplex', room = null }) {
  const sent = [];
  const closed = [];
  const session = new CallSession({
    carrier: 'twilio',
    client,
    role,
    mode,
    room,
    openRoom: rooms ? (id) => (id ? rooms.open(id) : null) : null,
    send: (frame) => sent.push(JSON.parse(frame)),
    close: (code, reason) => closed.push({ code, reason }),
    log: () => {},
  });
  return { session, sent, closed };
}

console.log('a carrier leg joins a room');

{
  const rooms = new RoomRegistry();
  const { session } = leg({ client: fakeClient(), rooms });
  ok('no room before the start frame', session.room === null);
  await session.handle(startFrame());
  // THE GAP: the room used to be decided at connection time, before the
  // carrier's start frame revealed which Vaani call this is. So a real
  // customer call was never in a room, and nothing could join or control it.
  ok('a room exists once the call id is known', session.room !== null);
  ok('it is the room for that call id', rooms.open('call_ctl') === session.room);
  ok('the leg is in it', session.room.size === 1);
}

console.log('mute');

{
  const client = fakeClient();
  const { session } = leg({ client, rooms: new RoomRegistry() });
  await session.handle(startFrame());
  await sleep(60);
  const before = client.calls.turns.length;

  const result = session.applyControl({ action: 'mute' });
  ok('mute is accepted', result.ok === true && result.muted === true);

  await feed(session, 0.6, 30);
  await feed(session, 0.0, 40);
  await sleep(120);
  ok(
    'a muted leg drives no turn',
    client.calls.turns.length === before,
  );

  session.applyControl({ action: 'unmute' });
  ok('unmute clears it', session.muted === false);
  await feed(session, 0.6, 30);
  await feed(session, 0.0, 40);
  await sleep(150);
  ok('speech is heard again after unmute', client.calls.turns.length > before);
}

console.log('hold');

{
  const client = fakeClient();
  const { session, sent } = leg({ client, rooms: new RoomRegistry() });
  await session.handle(startFrame());
  await sleep(60);
  const before = client.calls.turns.length;

  const held = session.applyControl({ action: 'hold' });
  ok('hold is accepted', held.ok === true && held.held === true);

  const framesAtHold = sent.length;
  await feed(session, 0.7, 40);
  await feed(session, 0.0, 40);
  await sleep(150);
  ok('a held call produces no turn', client.calls.turns.length === before);
  ok(
    'and sends the caller no audio',
    sent.length === framesAtHold ||
      sent.slice(framesAtHold).every((f) => f.event !== 'media'),
  );
  // Buffering a parked caller would mean answering their words several
  // sentences later, out of context.
  ok('nothing said on hold is kept', session.bufferedSamples === 0);

  session.applyControl({ action: 'resume' });
  ok('resume clears it', session.held === false);
  await feed(session, 0.7, 40);
  await feed(session, 0.0, 40);
  await sleep(150);
  ok('the call works after resume', client.calls.turns.length > before);
}

console.log('supervisor monitoring on a carrier call');

{
  const rooms = new RoomRegistry();
  const client = fakeClient();
  const customer = leg({ client, rooms });
  await customer.session.handle(startFrame('call_shared'));
  const supervisor = leg({
    client,
    rooms,
    role: 'supervisor',
    mode: 'listen',
  });
  await supervisor.session.handle(startFrame('call_shared'));

  ok('both legs share one room', customer.session.room === supervisor.session.room);
  ok('the room has two legs', customer.session.room.size === 2);

  const before = supervisor.sent.length;
  await feed(customer.session, 0.6, 10);
  ok(
    'the supervisor hears the customer',
    supervisor.sent.length > before,
  );

  const heardByCustomer = customer.sent.length;
  await feed(supervisor.session, 0.6, 10);
  ok(
    'a listening supervisor is not heard',
    customer.sent.length === heardByCustomer,
  );

  const toWhisper = supervisor.session.applyControl({
    action: 'set_mode',
    mode: 'whisper',
    whisperTo: customer.session.legId,
  });
  ok('whisper is accepted with a target', toWhisper.ok === true);
  ok('the mode changed', supervisor.session.mode === 'whisper');

  const bad = supervisor.session.applyControl({
    action: 'set_mode',
    mode: 'whisper',
  });
  ok('whisper without a target is refused', bad.ok === false);
  ok('with the reason named', bad.reason === 'whisper_needs_target');
}

console.log('refusals');

{
  const { session } = leg({ client: fakeClient(), rooms: new RoomRegistry() });
  await session.handle(startFrame());
  const unknown = session.applyControl({ action: 'explode' });
  ok('an unknown action is refused', unknown.ok === false);
  ok('and named as such', unknown.reason === 'unknown_action');

  const noRoom = leg({ client: fakeClient() });
  await noRoom.session.handle(startFrame());
  const modeless = noRoom.session.applyControl({
    action: 'set_mode',
    mode: 'listen',
  });
  ok('set_mode outside a room is refused', modeless.ok === false);
}

console.log('hangup');

{
  const { session, closed } = leg({
    client: fakeClient(),
    rooms: new RoomRegistry(),
  });
  await session.handle(startFrame());
  const result = session.applyControl({ action: 'hangup' });
  ok('hangup is accepted', result.ok === true);
  ok('the socket is closed', closed.length === 1);
  ok('cleanly', closed[0].code === 1000);
  ok('the session is ended', session.ended === true);

  // A command arriving after the call is over must not look like it worked.
  const after = session.applyControl({ action: 'mute' });
  ok('a control after the call is refused', after.ok === false);
  ok('with the reason named', after.reason === 'call_ended');
}

console.log('THE DEADLOCK: interrupting a long greeting must not hang the call');

{
  // The server feeds every frame of a call through one serialised queue, and
  // `onStart` awaits the greeting playback. `stopPlayback` cleared the timer
  // without settling that promise, so interrupting a greeting left `play()`
  // pending for ever and the queue never drained: the socket stayed open and
  // the session went deaf. Only reachable with a greeting long enough to be
  // interrupted, which is why a 200 ms test greeting never found it.
  const client = fakeClient();
  const long = new Int16Array(8000 * 5); // five seconds
  for (let i = 0; i < long.length; i += 1)
    long[i] = Math.round(6000 * Math.sin((2 * Math.PI * 440 * i) / 8000));
  client.greeting = async () => ({
    replyText: 'a long greeting',
    audioBase64: pcmToWav(long, 8000).toString('base64'),
    contentType: 'audio/wav',
    endCall: false,
  });

  const { session } = leg({ client, rooms: new RoomRegistry() });
  // Exactly what the server does: await the start frame before the next one.
  const startDone = session.handle(startFrame('call_deadlock'));
  await sleep(200);
  session.applyControl({ action: 'hold' });

  const settled = await Promise.race([
    startDone.then(() => 'settled'),
    sleep(1500).then(() => 'still_pending'),
  ]);
  ok('the start frame finishes instead of blocking the queue', settled === 'settled');
  ok('and playback is no longer marked as speaking', session.detector.agentSpeaking === false);

  session.applyControl({ action: 'resume' });
  const before = client.calls.turns.length;
  await feed(session, 0.7, 40);
  await feed(session, 0.0, 40);
  await sleep(150);
  ok('the call still hears the caller afterwards', client.calls.turns.length > before);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
