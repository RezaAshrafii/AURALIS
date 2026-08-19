use std::{path::PathBuf, sync::Arc};

use super::{
    audio_frame::{AudioFrameMeta, ChannelId, SessionId},
    ledger::{AudioChannel, AudioChunk, Gap, LifecycleTransition, Session},
    speech::{FrozenSpeechSegment, TranscriptRevision},
};

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureHandoffError {
    Full,
    Closed,
}

/// Non-blocking boundary used by the WASAPI event callback.
///
/// Implementations must return immediately. A `Full` result is observable loss
/// and must be converted into a durable `Gap` by the persistence side.
pub trait CaptureHandoffPort: Send + Sync {
    fn try_submit(&self, frame: CapturedFrame) -> Result<(), CaptureHandoffError>;
    fn capacity(&self) -> usize;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpoolContract {
    pub root: PathBuf,
    pub chunk_frames: u64,
    pub sync_on_finalize: bool,
}

impl SpoolContract {
    pub fn validate(&self) -> Result<(), CoreError> {
        if self.root.as_os_str().is_empty() {
            return Err(CoreError::InvalidState("spool root is required".into()));
        }
        if self.chunk_frames == 0 {
            return Err(CoreError::InvalidState(
                "spool chunk frame count must be non-zero".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SpoolAppendResult {
    Staged(Box<AudioChunk>),
    ReadyToFinalize(Box<AudioChunk>),
}

/// Raw-spool ownership boundary. Implementations persist every frame, including
/// silence, and finalize immutable chunks before the ledger accepts them.
pub trait AudioSpoolPort: Send {
    fn append(&mut self, frame: CapturedFrame) -> Result<SpoolAppendResult, CoreError>;
    fn finalize_channel(&mut self, channel_id: &ChannelId)
    -> Result<Option<AudioChunk>, CoreError>;
}

/// Durable audio-ledger boundary owned by the persistence worker, never by the
/// capture callback. A forward sequence jump is invalid unless the same commit
/// includes the exact `Gap` that explains it.
pub trait AudioLedgerPort: Send {
    fn create_session(&mut self, session: &Session) -> Result<(), CoreError>;
    fn register_channel(&mut self, channel: &AudioChannel) -> Result<(), CoreError>;
    fn stage_chunk(&mut self, chunk: &AudioChunk) -> Result<(), CoreError>;
    fn commit_chunk(
        &mut self,
        chunk: &AudioChunk,
        preceding_gap: Option<&Gap>,
    ) -> Result<(), CoreError>;
    fn record_gap(&mut self, gap: &Gap) -> Result<(), CoreError>;
    fn record_lifecycle(&mut self, transition: &LifecycleTransition) -> Result<(), CoreError>;
}

pub trait AudioCapturePort: Send + Sync {
    fn start(&self, session_id: SessionId) -> Result<(), CoreError>;
    fn stop(&self) -> Result<(), CoreError>;
}

pub trait ClockPort: Send + Sync {
    fn utc_now_rfc3339(&self) -> String;
    fn monotonic_100ns(&self) -> u64;
}

pub trait HealthReporter: Send + Sync {
    fn component_transition(
        &self,
        component: &'static str,
        state: &'static str,
        detail: Option<&str>,
    );
}

pub trait VadPort: Send + Sync {
    fn observe(&self, frame: &CapturedFrame) -> Result<(), CoreError>;
}

pub trait AsrPort: Send + Sync {
    fn transcribe_segment(
        &self,
        segment: &FrozenSpeechSegment,
    ) -> Result<TranscriptRevision, CoreError>;
    fn cancel_segment(&self, segment_id: &str) -> Result<(), CoreError>;
}

pub trait TranscriptReconciler: Send + Sync {
    fn choose_final(
        &self,
        revisions: &[TranscriptRevision],
    ) -> Result<TranscriptRevision, CoreError>;
}
