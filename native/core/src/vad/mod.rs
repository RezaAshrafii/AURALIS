//! Streaming neural-VAD boundary state machine.
//!
//! AURALIS keeps model inference behind `VadProbabilityPort`: Silero/ONNX is the
//! intended Windows production backend, while the boundary logic is deterministic
//! and testable without a model runtime. Audio must be resampled to 16 kHz mono
//! before probabilities are submitted to this module.

use crate::domain::ports::CoreError;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NeuralVadConfig {
    pub start_threshold: f32,
    pub end_threshold: f32,
    pub min_speech_ms: u32,
    pub min_silence_ms: u32,
    pub speech_pad_ms: u32,
    pub max_segment_ms: u32,
}

impl Default for NeuralVadConfig {
    fn default() -> Self {
        Self {
            start_threshold: 0.62,
            end_threshold: 0.42,
            min_speech_ms: 160,
            min_silence_ms: 420,
            speech_pad_ms: 160,
            max_segment_ms: 30_000,
        }
    }
}

impl NeuralVadConfig {
    pub fn validate(self) -> Result<Self, CoreError> {
        if !(0.0..=1.0).contains(&self.end_threshold)
            || !(0.0..=1.0).contains(&self.start_threshold)
            || self.start_threshold <= self.end_threshold
        {
            return Err(CoreError::InvalidState(
                "VAD thresholds require 0 <= end < start <= 1".into(),
            ));
        }
        if self.max_segment_ms < self.min_speech_ms || self.min_speech_ms == 0 {
            return Err(CoreError::InvalidState(
                "VAD max segment must cover non-zero minimum speech".into(),
            ));
        }
        Ok(self)
    }
}

pub trait VadProbabilityPort: Send {
    /// Returns speech probability in [0, 1] for sequential 16 kHz mono samples.
    fn probability_16khz_mono(&mut self, samples: &[f32]) -> Result<f32, CoreError>;
    fn reset(&mut self) -> Result<(), CoreError>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VadBoundary {
    SpeechStarted { pre_roll_ms: u32 },
    SpeechEnded { reason: VadEndpointReason, post_roll_ms: u32 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VadEndpointReason {
    Silence,
    MaxSegment,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VadState {
    Silence,
    Speech,
}

#[derive(Debug)]
pub struct NeuralVadStateMachine {
    config: NeuralVadConfig,
    state: VadState,
    candidate_speech_ms: u32,
    candidate_silence_ms: u32,
    segment_ms: u32,
}

impl NeuralVadStateMachine {
    pub fn new(config: NeuralVadConfig) -> Result<Self, CoreError> {
        Ok(Self {
            config: config.validate()?,
            state: VadState::Silence,
            candidate_speech_ms: 0,
            candidate_silence_ms: 0,
            segment_ms: 0,
        })
    }

    pub fn observe(
        &mut self,
        probability: f32,
        frame_ms: u32,
    ) -> Result<Option<VadBoundary>, CoreError> {
        if !(0.0..=1.0).contains(&probability) || frame_ms == 0 {
            return Err(CoreError::InvalidState(
                "invalid neural VAD observation".into(),
            ));
        }

        match self.state {
            VadState::Silence => {
                if probability >= self.config.start_threshold {
                    self.candidate_speech_ms = self.candidate_speech_ms.saturating_add(frame_ms);
                } else {
                    self.candidate_speech_ms = 0;
                }
                if self.candidate_speech_ms >= self.config.min_speech_ms {
                    self.state = VadState::Speech;
                    self.segment_ms = self.candidate_speech_ms;
                    self.candidate_silence_ms = 0;
                    return Ok(Some(VadBoundary::SpeechStarted {
                        pre_roll_ms: self.config.speech_pad_ms,
                    }));
                }
            }
            VadState::Speech => {
                self.segment_ms = self.segment_ms.saturating_add(frame_ms);
                if probability <= self.config.end_threshold {
                    self.candidate_silence_ms = self.candidate_silence_ms.saturating_add(frame_ms);
                } else {
                    self.candidate_silence_ms = 0;
                }

                if self.segment_ms >= self.config.max_segment_ms {
                    let event = VadBoundary::SpeechEnded {
                        reason: VadEndpointReason::MaxSegment,
                        post_roll_ms: self.config.speech_pad_ms,
                    };
                    self.reset();
                    return Ok(Some(event));
                }
                if self.candidate_silence_ms >= self.config.min_silence_ms {
                    let event = VadBoundary::SpeechEnded {
                        reason: VadEndpointReason::Silence,
                        post_roll_ms: self.config.speech_pad_ms,
                    };
                    self.reset();
                    return Ok(Some(event));
                }
            }
        }
        Ok(None)
    }

    pub fn reset(&mut self) {
        self.state = VadState::Silence;
        self.candidate_speech_ms = 0;
        self.candidate_silence_ms = 0;
        self.segment_ms = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hysteresis_starts_and_ends_without_chatter() {
        let mut vad = NeuralVadStateMachine::new(NeuralVadConfig {
            min_speech_ms: 60,
            min_silence_ms: 90,
            ..NeuralVadConfig::default()
        })
        .unwrap();
        assert_eq!(vad.observe(0.7, 30).unwrap(), None);
        assert!(matches!(
            vad.observe(0.8, 30).unwrap(),
            Some(VadBoundary::SpeechStarted { .. })
        ));
        assert_eq!(vad.observe(0.5, 30).unwrap(), None);
        assert_eq!(vad.observe(0.2, 30).unwrap(), None);
        assert_eq!(vad.observe(0.2, 30).unwrap(), None);
        assert!(matches!(
            vad.observe(0.2, 30).unwrap(),
            Some(VadBoundary::SpeechEnded {
                reason: VadEndpointReason::Silence,
                ..
            })
        ));
    }
}
