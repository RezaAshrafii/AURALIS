const SUPPORTED_SAMPLE_FORMATS = new Set([
  'pcm-u8',
  'pcm-i16',
  'pcm-i24',
  'pcm-i32',
  'float32'
]);

export class AudioSegmentBridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AudioSegmentBridgeError';
    this.code = code;
  }
}

function finiteInteger(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new AudioSegmentBridgeError('AUDIO_FORMAT_INVALID', `${name} is outside the supported range`);
  }
  return parsed;
}

export function inferSampleFormat(descriptor = {}) {
  const declared = String(descriptor.sampleFormat || descriptor.sample_format || '').trim().toLowerCase();
  if (SUPPORTED_SAMPLE_FORMATS.has(declared)) return declared;

  const tag = Number(descriptor.formatTag ?? descriptor.format_tag);
  const bits = Number(descriptor.bitsPerSample ?? descriptor.bits_per_sample);
  if (tag === 3 && bits === 32) return 'float32';
  if (tag === 1 && bits === 8) return 'pcm-u8';
  if (tag === 1 && bits === 16) return 'pcm-i16';
  if (tag === 1 && bits === 24) return 'pcm-i24';
  if (tag === 1 && bits === 32) return 'pcm-i32';
  throw new AudioSegmentBridgeError(
    'AUDIO_FORMAT_UNSUPPORTED',
    `unsupported native sample format: ${declared || `tag=${tag},bits=${bits}`}`
  );
}

export function validateRawAudioDescriptor(descriptor = {}) {
  const sampleRate = finiteInteger(
    descriptor.sampleRate ?? descriptor.sample_rate,
    'sample rate',
    8_000,
    384_000
  );
  const channels = finiteInteger(descriptor.channels, 'channel count', 1, 32);
  const bitsPerSample = finiteInteger(
    descriptor.bitsPerSample ?? descriptor.bits_per_sample,
    'bits per sample',
    8,
    64
  );
  const validBitsPerSample = finiteInteger(
    descriptor.validBitsPerSample ?? descriptor.valid_bits_per_sample ?? bitsPerSample,
    'valid bits per sample',
    1,
    bitsPerSample
  );
  const blockAlign = finiteInteger(
    descriptor.blockAlign ?? descriptor.block_align,
    'block alignment',
    1,
    4_096
  );
  const sampleFormat = inferSampleFormat(descriptor);
  const bytesPerSample = Math.ceil(bitsPerSample / 8);
  if (blockAlign < channels * bytesPerSample) {
    throw new AudioSegmentBridgeError(
      'AUDIO_FORMAT_INVALID',
      'block alignment is smaller than one interleaved frame'
    );
  }
  const expectedBits = {
    'pcm-u8': 8,
    'pcm-i16': 16,
    'pcm-i24': 24,
    'pcm-i32': 32,
    float32: 32
  }[sampleFormat];
  if (bitsPerSample !== expectedBits) {
    throw new AudioSegmentBridgeError(
      'AUDIO_FORMAT_INVALID',
      `${sampleFormat} requires a ${expectedBits}-bit container`
    );
  }
  return Object.freeze({
    sampleRate,
    channels,
    bitsPerSample,
    validBitsPerSample,
    blockAlign,
    bytesPerSample,
    sampleFormat
  });
}

function decodeSample(bytes, offset, sampleFormat) {
  switch (sampleFormat) {
    case 'pcm-u8':
      return (bytes[offset] - 128) / 128;
    case 'pcm-i16':
      return bytes.readInt16LE(offset) / 32_768;
    case 'pcm-i24': {
      let value = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
      if (value & 0x80_0000) value |= 0xff00_0000;
      return value / 8_388_608;
    }
    case 'pcm-i32':
      return bytes.readInt32LE(offset) / 2_147_483_648;
    case 'float32': {
      const value = bytes.readFloatLE(offset);
      return Number.isFinite(value) ? value : 0;
    }
    default:
      throw new AudioSegmentBridgeError('AUDIO_FORMAT_UNSUPPORTED', sampleFormat);
  }
}

function toPcm16(value) {
  const clamped = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
  return clamped < 0 ? Math.round(clamped * 32_768) : Math.round(clamped * 32_767);
}

export function rawInterleavedToMonoPcm16(rawBytes, descriptor = {}) {
  const format = validateRawAudioDescriptor(descriptor);
  const raw = Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes || []);
  if (raw.length === 0) {
    throw new AudioSegmentBridgeError('AUDIO_PAYLOAD_EMPTY', 'native audio chunk is empty');
  }
  if (raw.length % format.blockAlign !== 0) {
    throw new AudioSegmentBridgeError(
      'AUDIO_PAYLOAD_MISALIGNED',
      `native chunk has ${raw.length % format.blockAlign} trailing byte(s)`
    );
  }

  const frameCount = raw.length / format.blockAlign;
  const pcm = Buffer.allocUnsafe(frameCount * 2);
  let peak = 0;
  let squareSum = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameOffset = frame * format.blockAlign;
    let mixed = 0;
    for (let channel = 0; channel < format.channels; channel += 1) {
      mixed += decodeSample(raw, frameOffset + channel * format.bytesPerSample, format.sampleFormat);
    }
    mixed /= format.channels;
    const bounded = Math.max(-1, Math.min(1, mixed));
    peak = Math.max(peak, Math.abs(bounded));
    squareSum += bounded * bounded;
    pcm.writeInt16LE(toPcm16(bounded), frame * 2);
  }
  return {
    pcm,
    frameCount,
    durationMs: Math.max(1, Math.round((frameCount * 1_000) / format.sampleRate)),
    peak,
    rms: Math.sqrt(squareSum / frameCount),
    format
  };
}

export function buildMonoPcm16Wav(pcmBytes, sampleRate) {
  const pcm = Buffer.isBuffer(pcmBytes) ? pcmBytes : Buffer.from(pcmBytes || []);
  const rate = finiteInteger(sampleRate, 'sample rate', 8_000, 384_000);
  if (pcm.length === 0 || pcm.length % 2 !== 0) {
    throw new AudioSegmentBridgeError('PCM_PAYLOAD_INVALID', 'PCM16 payload must contain complete samples');
  }
  if (pcm.length > 0xffff_ffff - 36) {
    throw new AudioSegmentBridgeError('PCM_PAYLOAD_TOO_LARGE', 'WAV payload exceeds the RIFF size limit');
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 4, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 4, 'ascii');
  header.write('fmt ', 12, 4, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 4, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function materializeAsrWav(rawBytes, descriptor = {}) {
  const converted = rawInterleavedToMonoPcm16(rawBytes, descriptor);
  return {
    ...converted,
    wav: buildMonoPcm16Wav(converted.pcm, converted.format.sampleRate)
  };
}
