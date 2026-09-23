import {
  decodeG711,
  encodeG711,
  mulawToPcm,
  pcmToMulaw,
  pcmToWav,
  resample,
  rms,
  wavToPcm,
} from '../src/audio.js';
import { TurnDetector, frameDurationMs } from '../src/turn-detector.js';
import {
  buildCheckpoint,
  buildClear,
  buildMedia,
  buildPong,
  isProbeFrame,
  parseInbound,
} from '../src/protocol.js';

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) pass++;
  else fail++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
};

console.log('G.711 codec:');
ok(
  "mulaw round-trips every byte except the codec's alternate zero",
  (() => {
    // G.711 mulaw has two encodings of zero (0x7F and 0xFF). Both decode to 0,
    // and 0xFF is the canonical silence byte, so 0x7F cannot round-trip. That
    // is the codec, not a conversion bug.
    for (let byte = 0; byte < 256; byte += 1) {
      if (byte === 0x7f) continue;
      if (pcmToMulaw(mulawToPcm(byte)) !== byte) return false;
    }
    return true;
  })(),
);
ok(
  'both mulaw zeros decode to silence, and silence encodes to 0xFF',
  mulawToPcm(0x7f) === 0 && mulawToPcm(0xff) === 0 && pcmToMulaw(0) === 0xff,
);
ok('mulaw silence decodes near zero', Math.abs(mulawToPcm(0xff)) < 16);
ok(
  'a loud sample survives the round trip within mulaw quantisation',
  (() => {
    const original = 12000;
    const back = mulawToPcm(pcmToMulaw(original));
    return Math.abs(back - original) / original < 0.06;
  })(),
);
ok(
  'alaw round-trips every byte value',
  (() => {
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const samples = decodeG711(bytes, 'alaw');
    const again = encodeG711(samples, 'alaw');
    return Buffer.compare(bytes, again) === 0;
  })(),
);
ok(
  'buffer decode length matches input length',
  decodeG711(Buffer.alloc(160, 0x7f), 'mulaw').length === 160,
);

console.log('resampling:');
ok(
  '8k to 16k doubles the sample count',
  resample(new Int16Array(160), 8000, 16000).length === 320,
);
ok(
  '16k to 8k halves it',
  resample(new Int16Array(320), 16000, 8000).length === 160,
);
ok(
  'same rate returns the input untouched',
  (() => {
    const input = new Int16Array([1, 2, 3]);
    return resample(input, 8000, 8000) === input;
  })(),
);
ok(
  'a constant signal stays constant through resampling',
  (() => {
    const input = new Int16Array(160).fill(5000);
    const out = resample(input, 8000, 16000);
    return out[80] === 5000 && out[out.length - 2] === 5000;
  })(),
);

console.log('WAV container:');
ok(
  'PCM round-trips through a WAV header',
  (() => {
    const samples = new Int16Array([0, 1000, -1000, 32767, -32768]);
    const { samples: back, sampleRate } = wavToPcm(pcmToWav(samples, 16000));
    return (
      sampleRate === 16000 &&
      back.length === samples.length &&
      back.every((value, index) => value === samples[index])
    );
  })(),
);
ok(
  'a WAV with an extra LIST chunk before data still parses',
  (() => {
    const base = pcmToWav(new Int16Array([7, 8, 9]), 8000);
    const list = Buffer.alloc(12);
    list.write('LIST', 0, 'ascii');
    list.writeUInt32LE(4, 4);
    list.write('INFO', 8, 'ascii');
    // Splice the extra chunk between fmt and data, and fix the RIFF size.
    const withList = Buffer.concat([
      base.subarray(0, 36),
      list,
      base.subarray(36),
    ]);
    withList.writeUInt32LE(withList.length - 8, 4);
    const { samples } = wavToPcm(withList);
    return samples.length === 3 && samples[1] === 8;
  })(),
);
ok(
  'a stereo WAV is downmixed to mono',
  (() => {
    const stereo = pcmToWav(new Int16Array([100, 300, 200, 400]), 8000);
    stereo.writeUInt16LE(2, 22); // channels
    const { samples } = wavToPcm(stereo);
    return samples.length === 2 && samples[0] === 200 && samples[1] === 300;
  })(),
);
ok(
  'a non-WAV buffer is rejected',
  (() => {
    try {
      wavToPcm(Buffer.from('not audio at all, definitely not riff'));
      return false;
    } catch {
      return true;
    }
  })(),
);

console.log('levels:');
ok('silence has zero RMS', rms(new Int16Array(160)) === 0);
ok('a loud signal has high RMS', rms(new Int16Array(160).fill(20000)) > 0.5);
ok('an empty frame is zero, not NaN', rms(new Int16Array(0)) === 0);
ok(
  'a 160-byte 8kHz frame is 20ms',
  Math.round(frameDurationMs(160, 8000)) === 20,
);

console.log('turn detection:');
const feed = (detector, { level, frames }) => {
  let event = null;
  for (let index = 0; index < frames; index += 1) {
    event = detector.push({ level, durationMs: 20 }) ?? event;
  }
  return event;
};
ok(
  'silence alone never ends a turn',
  (() => {
    const d = new TurnDetector();
    return feed(d, { level: 0, frames: 100 }) === null;
  })(),
);
ok(
  'speech then enough silence ends the turn',
  (() => {
    const d = new TurnDetector();
    feed(d, { level: 0.2, frames: 20 }); // 400ms speech
    return feed(d, { level: 0, frames: 40 }) === 'turn_end'; // 800ms silence
  })(),
);
ok(
  'speech then brief silence does not end the turn',
  (() => {
    const d = new TurnDetector();
    feed(d, { level: 0.2, frames: 20 });
    return feed(d, { level: 0, frames: 10 }) === null; // 200ms
  })(),
);
ok(
  'a click too short to be speech is discarded, not sent',
  (() => {
    const d = new TurnDetector();
    feed(d, { level: 0.3, frames: 5 }); // 100ms, under minSpeechMs
    return feed(d, { level: 0, frames: 50 }) === null;
  })(),
);
ok(
  'a very long turn is cut off rather than growing forever',
  (() => {
    const d = new TurnDetector({ maxTurnMs: 400 });
    return feed(d, { level: 0.2, frames: 30 }) === 'turn_max';
  })(),
);

console.log('barge-in:');
ok(
  'sustained speech over the agent triggers barge-in',
  (() => {
    const d = new TurnDetector();
    d.setAgentSpeaking(true);
    return feed(d, { level: 0.3, frames: 12 }) === 'barge_in'; // 240ms
  })(),
);
ok(
  'a short blip over the agent does not (likely echo of our own audio)',
  (() => {
    const d = new TurnDetector();
    d.setAgentSpeaking(true);
    return feed(d, { level: 0.3, frames: 4 }) === null; // 80ms
  })(),
);
ok(
  'no turn_end fires while the agent is speaking',
  (() => {
    const d = new TurnDetector();
    d.setAgentSpeaking(true);
    return feed(d, { level: 0, frames: 100 }) === null;
  })(),
);

console.log('carrier protocol:');
ok(
  'twilio start carries the Vaani call id from custom parameters',
  (() => {
    const parsed = parseInbound(
      'twilio',
      JSON.stringify({
        event: 'start',
        start: {
          streamSid: 'MZ1',
          callSid: 'CA1',
          customParameters: { callId: 'call_abc' },
          mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000 },
        },
      }),
    );
    return (
      parsed.kind === 'start' &&
      parsed.callId === 'call_abc' &&
      parsed.streamSid === 'MZ1'
    );
  })(),
);
ok(
  'exotel start reads customfield as the call id',
  (() => {
    const parsed = parseInbound(
      'exotel',
      JSON.stringify({
        event: 'start',
        start: { stream_sid: 'S1', customfield: 'call_xyz' },
      }),
    );
    return parsed.kind === 'start' && parsed.callId === 'call_xyz';
  })(),
);
ok(
  'vobiz start reads its stream id and carrier call id',
  (() => {
    const parsed = parseInbound(
      'vobiz',
      JSON.stringify({
        event: 'start',
        streamId: 'vobiz_stream_1',
        start: {
          callUUID: 'vobiz_call_1',
          mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000 },
        },
      }),
    );
    return (
      parsed.kind === 'start' &&
      parsed.callId === 'vobiz_call_1' &&
      parsed.streamSid === 'vobiz_stream_1'
    );
  })(),
);
ok(
  'media frames yield their payload',
  parseInbound(
    'twilio',
    JSON.stringify({ event: 'media', media: { payload: 'AAA' } }),
  ).payload === 'AAA',
);
ok(
  'stop is recognised on both carriers',
  parseInbound('twilio', '{"event":"stop"}').kind === 'stop' &&
    parseInbound('exotel', '{"event":"stop"}').kind === 'stop',
);
ok(
  'malformed JSON is ignored, not thrown',
  parseInbound('twilio', 'not json').kind === 'ignore',
);
ok(
  'an unknown carrier is ignored explicitly',
  parseInbound('nextel', '{"event":"start"}').reason ===
    'unsupported_carrier:nextel',
);
ok(
  "outbound media uses each carrier's own stream key",
  JSON.parse(buildMedia('twilio', { streamSid: 'S', payload: 'P' }))
    .streamSid === 'S' &&
    JSON.parse(buildMedia('exotel', { streamSid: 'S', payload: 'P' }))
      .stream_sid === 'S',
);
ok(
  'vobiz playback uses the documented playAudio event',
  (() => {
    const frame = JSON.parse(
      buildMedia('vobiz', { streamSid: 'S', payload: 'P' }),
    );
    return (
      frame.event === 'playAudio' &&
      frame.streamId === 'S' &&
      frame.media?.contentType === 'audio/x-mulaw' &&
      frame.media?.sampleRate === 8000 &&
      frame.media?.payload === 'P'
    );
  })(),
);
ok(
  'vobiz checkpoint identifies the active stream and utterance',
  (() => {
    const frame = JSON.parse(
      buildCheckpoint('vobiz', { streamSid: 'S', name: 'response-3' }),
    );
    return (
      frame.event === 'checkpoint' &&
      frame.streamId === 'S' &&
      frame.name === 'response-3'
    );
  })(),
);
ok(
  'non-Vobiz carriers do not receive Vobiz checkpoint commands',
  buildCheckpoint('twilio', { streamSid: 'S', name: 'response-3' }) === null,
);
ok(
  'clear frames are built for both carriers',
  JSON.parse(buildClear('twilio', { streamSid: 'S' })).event === 'clear' &&
    JSON.parse(buildClear('exotel', { streamSid: 'S' })).event === 'clear',
);
ok(
  'vobiz barge-in clears playback using its stream id',
  JSON.parse(buildClear('vobiz', { streamSid: 'S' })).event === 'clearAudio' &&
    JSON.parse(buildClear('vobiz', { streamSid: 'S' })).streamId === 'S',
);
ok(
  'a dialer ping is parsed with its own clock value',
  parseInbound('browser', '{"event":"ping","at":1737000000123}').at ===
    1737000000123,
);
ok(
  "the pong echoes the tab's clock untouched, so the tab does the arithmetic",
  JSON.parse(buildPong('browser', { at: 42 })).at === 42,
);
ok(
  'carriers get no pong — they offer no application round trip on the stream',
  buildPong('twilio', { at: 42 }) === null &&
    buildPong('exotel', { at: 42 }) === null,
);
ok(
  'a ping on a carrier stream is ignored, not answered',
  parseInbound('twilio', '{"event":"ping","at":1}').kind === 'ignore',
);
ok(
  'a ping is recognised as a probe, so it can skip the media queue',
  isProbeFrame('browser', '{"event":"ping","at":1}') === true,
);
ok(
  'THE MEASUREMENT BUG: media frames are not probes, so audio keeps its order',
  isProbeFrame(
    'browser',
    '{"event":"media","media":{"payload":"f39/f39/f39/fw=="}}',
  ) === false,
);
ok(
  'a carrier frame is never treated as a probe',
  isProbeFrame('twilio', '{"event":"ping","at":1}') === false,
);
ok(
  'the probe check does not parse JSON to say no',
  isProbeFrame('browser', 'not json at all') === false,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
