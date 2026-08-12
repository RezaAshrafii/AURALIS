use std::{path::PathBuf, sync::Arc};

use super::audio_frame::{AudioFrameMeta, ChannelId, SessionId};

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("capture error: {0}")]
    Capture(String),
    #[error("spool error: {0}")]
    Spool(String),
    #[error("storage error: {0}")]
    Storage(String),
    #[error("invalid state: {0}")]
    InvalidState(String),
}

#[derive(Debug, Clone)]
pub struct CapturedFrame {
    pub meta: AudioFrameMeta,
    pub payload: Arc<[u8]>,
}

#[derive(Debug, Clone)]
pub struct ClosedAudioChunk {
    pub session_id: SessionId,
    pub channel_id: ChannelId,
    pub seq_start: u64,
    pub seq_end: u64,
    pub qpc_start_100ns: u64,
    pub qpc_end_100ns: u64,
    pub path: PathBuf,
    pub byte_length: u64,
    pub sha256_hex: String,
    pub discontinuity: bool,
}

pub trait AudioCapturePort: Send + Sync {
    fn start(&self, session_id: SessionId) -> Result<(), CoreError>;
    fn stop(&self) -> Result<(), CoreError>;
}

pub trait AudioSpoolPort: Send + Sync {
    fn append(&self, frame: CapturedFrame) -> Result<(), CoreError>;
    fn flush_channel(&self, channel_id: &ChannelId) -> Result<Option<ClosedAudioChunk>, CoreError>;
}

pub trait ClockPort: Send + Sync {
    fn utc_now_rfc3339(&self) -> String;
    fn monotonic_100ns(&self) -> u64;
}

pub trait HealthReporter: Send + Sync {
    fn component_transition(&self, component: &'static str, state: &'static str, detail: Option<&str>);
}


use super::speech::{FrozenSpeechSegment, TranscriptRevision};

pub trait VadPort: Send + Sync {
    fn observe(&self, frame: &CapturedFrame) -> Result<(), CoreError>;
}

pub trait AsrPort: Send + Sync {
    fn transcribe_segment(&self, segment: &FrozenSpeechSegment) -> Result<TranscriptRevision, CoreError>;
    fn cancel_segment(&self, segment_id: &str) -> Result<(), CoreError>;
}

pub trait TranscriptReconciler: Send + Sync {
    fn choose_final(&self, revisions: &[TranscriptRevision]) -> Result<TranscriptRevision, CoreError>;
}
