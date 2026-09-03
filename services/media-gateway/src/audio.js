/**
 * Telephony audio conversion.
 *
 * Carriers stream 8 kHz G.711 (mulaw or alaw); speech-to-text wants 16-bit PCM
 * in a WAV container. These are pure functions so every conversion is testable
 * without a socket or a provider.
 */

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

/** One mulaw byte to a signed 16-bit sample. */
export function mulawToPcm(byte) {
  const value = ~byte & 0xff;
  const sign = value & 0x80;
  const exponent = (value >> 4) & 0x07;
  const mantissa = value & 0x0f;
  let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  sample -= MULAW_BIAS;
  return sign ? -sample : sample;
}

/** One signed 16-bit sample to a mulaw byte. */
export function pcmToMulaw(sample) {
  let value = Math.max(-32768, Math.min(32767, Math.round(sample)));
  const sign = value < 0 ? 0x80 : 0;
  if (value < 0) value = -value;
  if (value > MULAW_CLIP) value = MULAW_CLIP;
  value += MULAW_BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (value & mask) === 0 && exponent > 0; mask >>= 1) {
    exponent -= 1;
  }
  const mantissa = (value >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

const ALAW_CLIP = 32635;

export function alawToPcm(byte) {
  let value = byte ^ 0x55;
  const sign = value & 0x80;
  if (sign) value &= 0x7f;
  const exponent = (value & 0x70) >> 4;
  const mantissa = value & 0x0f;
  const sample =
    exponent === 0
      ? (mantissa << 4) + 8
      : ((mantissa << 4) + 0x108) << (exponent - 1);
  return sign ? -sample : sample;
}

export function pcmToAlaw(sample) {
  let value = Math.max(-32768, Math.min(32767, Math.round(sample)));
  const sign = value < 0 ? 0x80 : 0;
  if (value < 0) value = -value;
  if (value > ALAW_CLIP) value = ALAW_CLIP;
  let exponent = 7;
  for (let mask = 0x4000; (value & mask) === 0 && exponent > 0; mask >>= 1) {
    exponent -= 1;
  }
  let encoded;
  if (exponent === 0) {
    encoded = sign | ((value >> 4) & 0x0f);
  } else {
    const mantissa = (value >> (exponent + 3)) & 0x0f;
    encoded = sign | (exponent << 4) | mantissa;
  }
  return (encoded ^ 0x55) & 0xff;
}

/** G.711 buffer to Int16Array. */
export function decodeG711(buffer, encoding) {
  const decode = encoding === 'alaw' ? alawToPcm : mulawToPcm;
  const out = new Int16Array(buffer.length);
  for (let index = 0; index < buffer.length; index += 1) {
    out[index] = decode(buffer[index]);
  }
  return out;
}

/** Int16Array to a G.711 buffer. */
export function encodeG711(samples, encoding) {
  const encode = encoding === 'alaw' ? pcmToAlaw : pcmToMulaw;
  const out = Buffer.allocUnsafe(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    out[index] = encode(samples[index]);
  }
  return out;
}

/**
 * Linear resample. Telephony is 8 kHz and providers prefer 16 kHz; linear
 * interpolation is adequate for speech at these ratios and costs nothing.
 */
export function resample(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const ratio = toRate / fromRate;
  const length = Math.max(1, Math.round(samples.length * ratio));
  const out = new Int16Array(length);
  for (let index = 0; index < length; index += 1) {
    const source = index / ratio;
    const left = Math.floor(source);
    const right = Math.min(samples.length - 1, left + 1);
    const weight = source - left;
    out[index] = Math.round(
      samples[left] * (1 - weight) + samples[right] * weight,
    );
  }
  return out;
}

/** Wraps PCM16 in a WAV container, which is what the STT adapters accept. */
export function pcmToWav(samples, sampleRate) {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.allocUnsafe(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples.length; index += 1) {
    buffer.writeInt16LE(samples[index], 44 + index * 2);
  }
  return buffer;
}

/** Reads a WAV buffer back to samples, so TTS output can be re-encoded. */
export function wavToPcm(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF')
    throw new Error('Not a RIFF/WAV buffer.');
  // Walk the chunks rather than assuming a 44-byte header: real encoders emit
  // LIST and fact chunks, and a fixed offset silently reads them as audio.
  let offset = 12;
  let sampleRate = 8000;
  let bitsPerSample = 16;
  let channels = 1;
  let dataStart = -1;
  let dataLength = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      channels = buffer.readUInt16LE(offset + 10);
      sampleRate = buffer.readUInt32LE(offset + 12);
      bitsPerSample = buffer.readUInt16LE(offset + 22);
    } else if (id === 'data') {
      dataStart = offset + 8;
      dataLength = Math.min(size, buffer.length - dataStart);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataStart < 0) throw new Error('WAV buffer has no data chunk.');
  if (bitsPerSample !== 16)
    throw new Error(`Only 16-bit WAV is supported, got ${bitsPerSample}-bit.`);
  const total = Math.floor(dataLength / 2);
  const interleaved = new Int16Array(total);
  for (let index = 0; index < total; index += 1) {
    interleaved[index] = buffer.readInt16LE(dataStart + index * 2);
  }
  if (channels <= 1) return { samples: interleaved, sampleRate };
  // Downmix to mono; a carrier leg is single channel.
  const frames = Math.floor(total / channels);
  const mono = new Int16Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += interleaved[frame * channels + channel];
    }
    mono[frame] = Math.round(sum / channels);
  }
  return { samples: mono, sampleRate };
}

/** Root-mean-square amplitude, 0..1. The basis for silence detection. */
export function rms(samples) {
  if (!samples.length) return 0;
  let total = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index] / 32768;
    total += value * value;
  }
  return Math.sqrt(total / samples.length);
}
