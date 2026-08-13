export const targetFutureContract = Object.freeze({
  classification: 'TARGET/FUTURE',
  current: false,
  capabilities: Object.freeze([
    'WebSocket delivery',
    'audio.level',
    'segment.started',
    'transcript.partial',
    'answer.partial',
    'gap.detected',
    'device.changed',
    'production Rust WASAPI audio core',
    'neural VAD',
    'streaming ASR',
  ]),
});
