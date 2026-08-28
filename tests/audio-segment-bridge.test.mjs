import assert from "node:assert/strict";
import test from "node:test";

import {
  AudioSegmentBridgeError,
  buildMonoPcm16Wav,
  inferSampleFormat,
  materializeAsrWav,
  rawInterleavedToMonoPcm16,
} from "../core/audio-segment-bridge.mjs";

test("native PCM16 stereo is downmixed to a valid mono PCM16 WAV", () => {
  const raw = Buffer.alloc(8);
  raw.writeInt16LE(0, 0);
  raw.writeInt16LE(16_384, 2);
  raw.writeInt16LE(-32_768, 4);
  raw.writeInt16LE(0, 6);
  const result = materializeAsrWav(raw, {
    sample_rate: 48_000,
    channels: 2,
    block_align: 4,
    bits_per_sample: 16,
    valid_bits_per_sample: 16,
    sample_format: "pcm-i16",
  });

  assert.equal(result.frameCount, 2);
  assert.equal(result.pcm.length, 4);
  assert.equal(result.pcm.readInt16LE(0), 8_192);
  assert.equal(result.pcm.readInt16LE(2), -16_384);
  assert.equal(result.wav.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(result.wav.subarray(8, 12).toString("ascii"), "WAVE");
  assert.equal(result.wav.readUInt16LE(22), 1);
  assert.equal(result.wav.readUInt32LE(24), 48_000);
  assert.equal(result.wav.readUInt16LE(34), 16);
  assert.equal(result.wav.readUInt32LE(40), 4);
});

test("right-channel-only audio remains audible after safe downmix", () => {
  const raw = Buffer.alloc(4);
  raw.writeFloatLE(0.8, 0);
  const out = rawInterleavedToMonoPcm16(raw, {
    sampleRate: 44_100,
    channels: 1,
    blockAlign: 4,
    bitsPerSample: 32,
    sampleFormat: "float32",
  });
  assert.ok(out.pcm.readInt16LE(0) > 26_000);
  assert.ok(out.peak > 0.79);
});

test("format can be inferred from canonical WAVE tags", () => {
  assert.equal(inferSampleFormat({ format_tag: 1, bits_per_sample: 24 }), "pcm-i24");
  assert.equal(inferSampleFormat({ format_tag: 3, bits_per_sample: 32 }), "float32");
});

test("misaligned or unsupported native data fails closed", () => {
  assert.throws(
    () =>
      rawInterleavedToMonoPcm16(Buffer.from([1, 2, 3]), {
        sampleRate: 48_000,
        channels: 2,
        blockAlign: 4,
        bitsPerSample: 16,
        sampleFormat: "pcm-i16",
      }),
    (error) => error instanceof AudioSegmentBridgeError && error.code === "AUDIO_PAYLOAD_MISALIGNED"
  );
  assert.throws(
    () => inferSampleFormat({ format_tag: 85, bits_per_sample: 16 }),
    (error) => error instanceof AudioSegmentBridgeError && error.code === "AUDIO_FORMAT_UNSUPPORTED"
  );
  assert.throws(() => buildMonoPcm16Wav(Buffer.alloc(1), 48_000), AudioSegmentBridgeError);
});
