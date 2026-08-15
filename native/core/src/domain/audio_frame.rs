use serde::{Deserialize, Serialize};

use super::ledger::SourceKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SessionId(pub u128);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ChannelId(pub String);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SampleFormat {
    PcmU8,
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
    pub source_kind: SourceKind,
    pub sequence_start: u64,
    pub sample_count_per_channel: u32,
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub channel_mask: Option<u32>,
    pub sample_format: SampleFormat,
    pub bits_per_sample: u16,
    pub valid_bits_per_sample: u16,
    pub block_align: u16,
    pub qpc_start_100ns: u64,
    pub qpc_end_100ns: u64,
    pub device_position: Option<u64>,
    pub flags: FrameFlags,
    pub discontinuity: Option<DiscontinuityReason>,
}

impl std::fmt::Display for SessionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:032x}", self.0)
    }
}

impl std::str::FromStr for SessionId {
    type Err = std::num::ParseIntError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        u128::from_str_radix(value, 16).map(Self)
    }
}

impl std::fmt::Display for ChannelId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl SampleFormat {
    pub fn as_storage_value(self) -> String {
        match self {
            Self::PcmU8 => "pcm-u8".into(),
            Self::PcmI16 => "pcm-i16".into(),
            Self::PcmI24 => "pcm-i24".into(),
            Self::PcmI32 => "pcm-i32".into(),
            Self::Float32 => "float32".into(),
            Self::Extensible => "extensible".into(),
            Self::Unknown(tag) => format!("unknown:{tag}"),
        }
    }

    pub fn from_storage_value(value: &str) -> Result<Self, &'static str> {
        match value {
            "pcm-u8" => Ok(Self::PcmU8),
            "pcm-i16" => Ok(Self::PcmI16),
            "pcm-i24" => Ok(Self::PcmI24),
            "pcm-i32" => Ok(Self::PcmI32),
            "float32" => Ok(Self::Float32),
            "extensible" => Ok(Self::Extensible),
            _ => value
                .strip_prefix("unknown:")
                .ok_or("unknown sample format storage value")?
                .parse::<u16>()
                .map(Self::Unknown)
                .map_err(|_| "invalid unknown sample format tag"),
        }
    }
}

impl AudioFrameMeta {
    pub fn sequence_end(&self) -> Option<u64> {
        self.sequence_start
            .checked_add(u64::from(self.sample_count_per_channel))
    }

    pub fn validate(&self) -> Result<(), &'static str> {
        if self.channel_id.0.trim().is_empty() {
            return Err("frame channel id is required");
        }
        if self.sample_count_per_channel == 0 {
            return Err("frame sample count must be non-zero");
        }
        if self.sample_rate_hz == 0 || self.channels == 0 {
            return Err("frame format is invalid");
        }
        if self.bits_per_sample == 0
            || self.valid_bits_per_sample == 0
            || self.valid_bits_per_sample > self.bits_per_sample
            || self.block_align == 0
        {
            return Err("frame sample layout is invalid");
        }
        if self.qpc_end_100ns < self.qpc_start_100ns {
            return Err("frame QPC range is reversed");
        }
        if self.sequence_end().is_none() {
            return Err("frame sequence range overflowed");
        }
        Ok(())
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
