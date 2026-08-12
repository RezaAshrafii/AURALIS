use serde::{Deserialize, Serialize};

use super::audio_frame::{ChannelId, SessionId};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FrozenSpeechSegment {
    pub id: String,
    pub session_id: SessionId,
    pub channel_id: ChannelId,
    pub seq_start: u64,
    pub seq_end: u64,
    pub qpc_start_100ns: u64,
    pub qpc_end_100ns: u64,
    pub endpoint_reason: String,
    pub audio_ref: String,
}

impl FrozenSpeechSegment {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.seq_end <= self.seq_start { return Err("empty segment range"); }
        if self.audio_ref.trim().is_empty() { return Err("segment must retain audio reference"); }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TranscriptRevision {
    pub segment_id: String,
    pub revision: u32,
    pub provider: String,
    pub provider_model: String,
    pub text_raw: String,
    pub text_normalized: String,
    pub language: String,
    pub is_final: bool,
}
