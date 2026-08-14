use std::path::{Component, PathBuf};

use serde::{Deserialize, Serialize};

use super::audio_frame::{ChannelId, SampleFormat, SessionId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SourceKind {
    UserMic,
    SystemLoopback,
    ProcessLoopback,
}

impl SourceKind {
    pub fn as_storage_str(self) -> &'static str {
        match self {
            Self::UserMic => "user-mic",
            Self::SystemLoopback => "system-loopback",
            Self::ProcessLoopback => "process-loopback",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CaptureState {
    Idle,
    Starting,
    Capturing,
    Stopping,
    Stopped,
    Recovering,
    Failed,
}

impl CaptureState {
    pub fn as_storage_str(self) -> &'static str {
        match self {
            Self::Idle => "IDLE",
            Self::Starting => "STARTING",
            Self::Capturing => "CAPTURING",
            Self::Stopping => "STOPPING",
            Self::Stopped => "STOPPED",
            Self::Recovering => "RECOVERING",
            Self::Failed => "FAILED",
        }
    }

    pub fn can_transition_to(self, next: Self) -> bool {
        self == next
            || matches!(
                (self, next),
                (Self::Idle, Self::Starting)
                    | (
                        Self::Starting,
                        Self::Capturing | Self::Stopped | Self::Failed
                    )
                    | (
                        Self::Capturing,
                        Self::Stopping | Self::Recovering | Self::Failed
                    )
                    | (Self::Stopping, Self::Stopped | Self::Failed)
                    | (Self::Stopped, Self::Starting | Self::Recovering)
                    | (
                        Self::Recovering,
                        Self::Starting | Self::Capturing | Self::Stopped | Self::Failed
                    )
                    | (Self::Failed, Self::Recovering | Self::Stopped)
            )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DeviceState {
    Unknown,
    Available,
    DefaultChanged,
    Invalidated,
    Disconnected,
    Reconnecting,
    Suspended,
    Resuming,
}

impl DeviceState {
    pub fn as_storage_str(self) -> &'static str {
        match self {
            Self::Unknown => "UNKNOWN",
            Self::Available => "AVAILABLE",
            Self::DefaultChanged => "DEFAULT_CHANGED",
            Self::Invalidated => "INVALIDATED",
            Self::Disconnected => "DISCONNECTED",
            Self::Reconnecting => "RECONNECTING",
            Self::Suspended => "SUSPENDED",
            Self::Resuming => "RESUMING",
        }
    }

    pub fn can_transition_to(self, next: Self) -> bool {
        self == next
            || matches!(
                (self, next),
                (
                    Self::Unknown,
                    Self::Available | Self::Disconnected | Self::Invalidated
                ) | (
                    Self::Available,
                    Self::DefaultChanged | Self::Invalidated | Self::Disconnected | Self::Suspended
                ) | (
                    Self::DefaultChanged,
                    Self::Available | Self::Reconnecting | Self::Disconnected
                ) | (Self::Invalidated, Self::Reconnecting | Self::Disconnected)
                    | (Self::Disconnected, Self::Reconnecting)
                    | (
                        Self::Reconnecting,
                        Self::Available | Self::Invalidated | Self::Disconnected
                    )
                    | (Self::Suspended, Self::Resuming | Self::Disconnected)
                    | (
                        Self::Resuming,
                        Self::Available | Self::Reconnecting | Self::Disconnected
                    )
            )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RecoveryState {
    Clean,
    ScanRequired,
    Scanning,
    Recoverable,
    Recovered,
    ManualIntervention,
}

impl RecoveryState {
    pub fn as_storage_str(self) -> &'static str {
        match self {
            Self::Clean => "CLEAN",
            Self::ScanRequired => "SCAN_REQUIRED",
            Self::Scanning => "SCANNING",
            Self::Recoverable => "RECOVERABLE",
            Self::Recovered => "RECOVERED",
            Self::ManualIntervention => "MANUAL_INTERVENTION",
        }
    }

    pub fn can_transition_to(self, next: Self) -> bool {
        self == next
            || matches!(
                (self, next),
                (Self::Clean, Self::ScanRequired)
                    | (Self::ScanRequired, Self::Scanning)
                    | (
                        Self::Scanning,
                        Self::Recoverable | Self::Recovered | Self::ManualIntervention
                    )
                    | (
                        Self::Recoverable,
                        Self::Recovered | Self::ManualIntervention
                    )
                    | (Self::Recovered, Self::Clean | Self::ScanRequired)
                    | (Self::ManualIntervention, Self::ScanRequired)
            )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AudioChunkState {
    Staging,
    Finalized,
    Incomplete,
    Quarantined,
}

impl AudioChunkState {
    pub fn as_storage_str(self) -> &'static str {
        match self {
            Self::Staging => "STAGING",
            Self::Finalized => "FINALIZED",
            Self::Incomplete => "INCOMPLETE",
            Self::Quarantined => "QUARANTINED",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GapReason {
    WasapiDataDiscontinuity,
    TimestampError,
    DevicePositionGap,
    QueueOverflow,
    DeviceInvalidated,
    SpoolWriteFailure,
    Reconnect,
    RecoveryTruncation,
    Unknown,
}

impl GapReason {
    pub fn as_storage_str(self) -> &'static str {
        match self {
            Self::WasapiDataDiscontinuity => "WASAPI_DATA_DISCONTINUITY",
            Self::TimestampError => "TIMESTAMP_ERROR",
            Self::DevicePositionGap => "DEVICE_POSITION_GAP",
            Self::QueueOverflow => "QUEUE_OVERFLOW",
            Self::DeviceInvalidated => "DEVICE_INVALIDATED",
            Self::SpoolWriteFailure => "SPOOL_WRITE_FAILURE",
            Self::Reconnect => "RECONNECT",
            Self::RecoveryTruncation => "RECOVERY_TRUNCATION",
            Self::Unknown => "UNKNOWN",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GapStatus {
    Open,
    Explained,
    Resolved,
}

impl GapStatus {
    pub fn as_storage_str(self) -> &'static str {
        match self {
            Self::Open => "OPEN",
            Self::Explained => "EXPLAINED",
            Self::Resolved => "RESOLVED",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Session {
    pub id: SessionId,
    pub started_at_utc: String,
    pub ended_at_utc: Option<String>,
    pub app_version: String,
    pub schema_version: u32,
    pub capture_state: CaptureState,
    pub recovery_state: RecoveryState,
    pub config_snapshot_json: String,
}

impl Session {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.id.0 == 0 {
            return Err("session id must be non-zero");
        }
        if self.started_at_utc.trim().is_empty() || self.app_version.trim().is_empty() {
            return Err("session timestamp and app version are required");
        }
        validate_json(
            &self.config_snapshot_json,
            "session config must be valid JSON",
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AudioChannel {
    pub id: ChannelId,
    pub session_id: SessionId,
    pub source_kind: SourceKind,
    pub device_id: Option<String>,
    pub device_generation: u32,
    pub native_sample_rate: u32,
    pub native_channels: u16,
    pub channel_mask: Option<u32>,
    pub sample_format: SampleFormat,
    pub capture_state: CaptureState,
    pub device_state: DeviceState,
    pub recovery_state: RecoveryState,
    pub last_sequence: u64,
    pub last_qpc_100ns: Option<u64>,
    pub last_device_position: Option<u64>,
}

impl AudioChannel {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.id.0.trim().is_empty() {
            return Err("channel id is required");
        }
        if self.session_id.0 == 0 {
            return Err("channel session id must be non-zero");
        }
        if self.native_sample_rate == 0 {
            return Err("sample rate must be non-zero");
        }
        if self.native_channels == 0 {
            return Err("channel count must be non-zero");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AudioChunk {
    pub id: String,
    pub session_id: SessionId,
    pub channel_id: ChannelId,
    pub seq_start: u64,
    pub seq_end: u64,
    pub qpc_start_100ns: u64,
    pub qpc_end_100ns: u64,
    pub device_position_start: Option<u64>,
    pub device_position_end: Option<u64>,
    pub sample_rate: u32,
    pub channels: u16,
    pub channel_mask: Option<u32>,
    pub sample_format: SampleFormat,
    pub path: PathBuf,
    pub byte_length: u64,
    pub sha256_hex: String,
    pub discontinuity: Option<GapReason>,
    pub state: AudioChunkState,
    pub created_at_utc: String,
}

impl AudioChunk {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.id.trim().is_empty() {
            return Err("chunk id is required");
        }
        if self.seq_end <= self.seq_start {
            return Err("chunk sequence range must be non-empty");
        }
        if self.qpc_end_100ns < self.qpc_start_100ns {
            return Err("chunk QPC range is reversed");
        }
        if matches!(
            (self.device_position_start, self.device_position_end),
            (Some(start), Some(end)) if end < start
        ) {
            return Err("chunk device-position range is reversed");
        }
        if self.sample_rate == 0 || self.channels == 0 {
            return Err("chunk format is invalid");
        }
        if self.byte_length == 0 {
            return Err("chunk payload must be non-empty");
        }
        if self.sha256_hex.len() != 64
            || !self.sha256_hex.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err("chunk SHA-256 must be 64 hexadecimal characters");
        }
        if self.path.as_os_str().is_empty()
            || self.path.components().any(|component| {
                matches!(
                    component,
                    Component::Prefix(_) | Component::RootDir | Component::ParentDir
                )
            })
        {
            return Err("chunk path must be a safe spool-relative path");
        }
        if self.created_at_utc.trim().is_empty() {
            return Err("chunk creation timestamp is required");
        }
        Ok(())
    }

    pub fn validate_for_commit(&self) -> Result<(), &'static str> {
        self.validate()?;
        if self.state != AudioChunkState::Finalized {
            return Err("only finalized chunks may enter the durable ledger");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Gap {
    pub id: String,
    pub session_id: SessionId,
    pub channel_id: ChannelId,
    pub seq_start: u64,
    pub seq_end: Option<u64>,
    pub qpc_detected_100ns: Option<u64>,
    pub expected_device_position: Option<u64>,
    pub observed_device_position: Option<u64>,
    pub reason: GapReason,
    pub detail_json: String,
    pub attempts: u32,
    pub retry_at_utc: Option<String>,
    pub status: GapStatus,
    pub created_at_utc: String,
    pub resolved_at_utc: Option<String>,
}

impl Gap {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.id.trim().is_empty() {
            return Err("gap id is required");
        }
        if matches!(self.seq_end, Some(end) if end <= self.seq_start) {
            return Err("known gap sequence range must be non-empty");
        }
        if matches!(
            (self.expected_device_position, self.observed_device_position),
            (Some(expected), Some(observed)) if observed < expected
        ) {
            return Err("gap device position regressed");
        }
        if self.created_at_utc.trim().is_empty() {
            return Err("gap creation timestamp is required");
        }
        validate_json(&self.detail_json, "gap detail must be valid JSON")
    }

    pub fn is_extent_known(&self) -> bool {
        self.seq_end.is_some()
    }

    pub fn exactly_covers(&self, expected_start: u64, observed_start: u64) -> bool {
        self.seq_start == expected_start && self.seq_end == Some(observed_start)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LifecycleTransition {
    pub session_id: SessionId,
    pub channel_id: Option<ChannelId>,
    pub previous_capture_state: CaptureState,
    pub capture_state: CaptureState,
    pub previous_device_state: DeviceState,
    pub device_state: DeviceState,
    pub previous_recovery_state: RecoveryState,
    pub recovery_state: RecoveryState,
    pub detail_json: String,
    pub occurred_at_utc: String,
}

impl LifecycleTransition {
    pub fn validate(&self) -> Result<(), &'static str> {
        if !self
            .previous_capture_state
            .can_transition_to(self.capture_state)
        {
            return Err("invalid capture-state transition");
        }
        if !self
            .previous_device_state
            .can_transition_to(self.device_state)
        {
            return Err("invalid device-state transition");
        }
        if !self
            .previous_recovery_state
            .can_transition_to(self.recovery_state)
        {
            return Err("invalid recovery-state transition");
        }
        if self.occurred_at_utc.trim().is_empty() {
            return Err("lifecycle timestamp is required");
        }
        validate_json(&self.detail_json, "lifecycle detail must be valid JSON")
    }
}

fn validate_json(value: &str, error: &'static str) -> Result<(), &'static str> {
    serde_json::from_str::<serde_json::Value>(value)
        .map(|_| ())
        .map_err(|_| error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_machines_reject_impossible_shortcuts() {
        assert!(CaptureState::Idle.can_transition_to(CaptureState::Starting));
        assert!(!CaptureState::Idle.can_transition_to(CaptureState::Capturing));
        assert!(DeviceState::Available.can_transition_to(DeviceState::Suspended));
        assert!(!DeviceState::Suspended.can_transition_to(DeviceState::Available));
        assert!(RecoveryState::ScanRequired.can_transition_to(RecoveryState::Scanning));
        assert!(!RecoveryState::ScanRequired.can_transition_to(RecoveryState::Recovered));
    }

    #[test]
    fn unknown_gap_extent_is_explicit() {
        let gap = Gap {
            id: "gap-unknown".into(),
            session_id: SessionId(1),
            channel_id: ChannelId("channel-1".into()),
            seq_start: 480,
            seq_end: None,
            qpc_detected_100ns: Some(100_000),
            expected_device_position: None,
            observed_device_position: None,
            reason: GapReason::WasapiDataDiscontinuity,
            detail_json: "{}".into(),
            attempts: 0,
            retry_at_utc: None,
            status: GapStatus::Open,
            created_at_utc: "2026-08-14T00:00:00Z".into(),
            resolved_at_utc: None,
        };

        assert!(gap.validate().is_ok());
        assert!(!gap.is_extent_known());
    }
}
