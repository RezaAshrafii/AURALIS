export const VadState = Object.freeze({ SILENCE: 'SILENCE', SPEECH: 'SPEECH' });

export function validateVadConfig(input = {}) {
  const cfg = {
    startThreshold: Number(input.startThreshold ?? 0.62),
    endThreshold: Number(input.endThreshold ?? 0.42),
    minSpeechMs: Number(input.minSpeechMs ?? 160),
    minSilenceMs: Number(input.minSilenceMs ?? 420),
    speechPadMs: Number(input.speechPadMs ?? 160),
    maxSegmentMs: Number(input.maxSegmentMs ?? 30_000)
  };
  if (!(cfg.startThreshold > cfg.endThreshold && cfg.startThreshold <= 1 && cfg.endThreshold >= 0)) {
    throw new TypeError('VAD thresholds require 0 <= end < start <= 1');
  }
  for (const key of ['minSpeechMs','minSilenceMs','speechPadMs','maxSegmentMs']) {
    if (!Number.isFinite(cfg[key]) || cfg[key] < 0) throw new TypeError(`invalid ${key}`);
  }
  if (cfg.maxSegmentMs < cfg.minSpeechMs) throw new TypeError('maxSegmentMs must cover minSpeechMs');
  return Object.freeze(cfg);
}

/**
 * Streaming hysteresis state machine for neural VAD probabilities.
 * It deliberately owns boundaries only; model inference is injected separately.
 */
export class NeuralVadStateMachine {
  #cfg;
  #state = VadState.SILENCE;
  #candidateSpeechMs = 0;
  #candidateSilenceMs = 0;
  #segmentMs = 0;

  constructor(config = {}) { this.#cfg = validateVadConfig(config); }
  get state() { return this.#state; }
  get config() { return this.#cfg; }

  observe(probability, frameMs) {
    const p = Number(probability), ms = Number(frameMs);
    if (!Number.isFinite(p) || p < 0 || p > 1) throw new TypeError('VAD probability must be within [0,1]');
    if (!Number.isFinite(ms) || ms <= 0) throw new TypeError('frameMs must be positive');
    const events = [];

    if (this.#state === VadState.SILENCE) {
      if (p >= this.#cfg.startThreshold) this.#candidateSpeechMs += ms;
      else this.#candidateSpeechMs = 0;
      if (this.#candidateSpeechMs >= this.#cfg.minSpeechMs) {
        this.#state = VadState.SPEECH;
        this.#segmentMs = this.#candidateSpeechMs;
        this.#candidateSilenceMs = 0;
        events.push({ type:'speech_started', preRollMs:this.#cfg.speechPadMs });
      }
      return events;
    }

    this.#segmentMs += ms;
    if (p <= this.#cfg.endThreshold) this.#candidateSilenceMs += ms;
    else this.#candidateSilenceMs = 0;

    if (this.#segmentMs >= this.#cfg.maxSegmentMs) {
      events.push({ type:'speech_ended', reason:'max_segment', postRollMs:this.#cfg.speechPadMs });
      this.reset();
      return events;
    }
    if (this.#candidateSilenceMs >= this.#cfg.minSilenceMs) {
      events.push({ type:'speech_ended', reason:'silence', postRollMs:this.#cfg.speechPadMs });
      this.reset();
    }
    return events;
  }

  reset() {
    this.#state = VadState.SILENCE;
    this.#candidateSpeechMs = 0;
    this.#candidateSilenceMs = 0;
    this.#segmentMs = 0;
  }
}
