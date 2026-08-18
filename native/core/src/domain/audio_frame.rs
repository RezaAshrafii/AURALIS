use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SessionId(pub u128);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ChannelId(pub String);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SampleFormat {
    PcmI16,
    PcmI24,
    PcmI32,
    Float32,
    Extensible,
    Unknown(u16),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DiscontinuityReason {
    WasapiDataDiscontinuity,
    TimestampError,
    DevicePositionGap,
    QueueOverflow,
    DeviceInvalidated,
    SpoolWriteFailure,
    Reconnect,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct FrameFlags {
    pub silent: bool,
    pub timestamp_error: bool,
    pub data_discontinuity: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioFrameMeta {
    pub session_id: SessionId,
    pub channel_id: ChannelId,
    pub sequence_start: u64,
    pub sample_count_per_channel: u32,
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub channel_mask: Option<u32>,
    pub sample_format: SampleFormat,
    pub qpc_start_100ns: u64,
    pub qpc_end_100ns: u64,
    pub device_position: Option<u64>,
    pub flags: FrameFlags,
    pub discontinuity: Option<DiscontinuityReason>,
}

impl AudioFrameMeta {
    pub fn sequence_end(&self) -> u64 {
        self.sequence_start + u64::from(self.sample_count_per_channel)
    }

    pub fn validates_after(&self, expected_sequence: u64) -> Result<(), SequenceGap> {
        if self.sequence_start == expected_sequence {
            Ok(())
        } else {
            Err(SequenceGap {
                expected_sequence,
                observed_sequence: self.sequence_start,
            })
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SequenceGap {
    pub expected_sequence: u64,
    pub observed_sequence: u64,
}
