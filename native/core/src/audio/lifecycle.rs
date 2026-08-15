use std::sync::Arc;

use serde_json::json;

use crate::domain::{
    audio_frame::{ChannelId, SessionId},
    ledger::{
        CaptureState, DeviceState, Gap, GapReason, GapStatus, LifecycleTransition, RecoveryState,
    },
    ports::{AudioLedgerPort, CoreError},
};

type TimestampSource = Arc<dyn Fn() -> String + Send + Sync>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeviceLifecycleEvent {
    DeviceUnplugged { device_id: String },
    DeviceInvalidated { device_id: String },
    DefaultDeviceChanged { device_id: String },
    Suspend,
    Resume,
    ReconnectDetected { device_id: String },
    RestartDetected,
    RecoveryScanStarted,
    RecoveryScanCompleted { incomplete_chunks: u64 },
    CaptureRestarted { device_id: String },
    CaptureStopRequested,
    CaptureStopped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LifecycleAction {
    StopCapture,
    FinalizePersistence,
    RunRecoveryScan,
    AwaitDevice,
    RestartCapture,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LifecycleSnapshot {
    pub capture_state: CaptureState,
    pub device_state: DeviceState,
    pub recovery_state: RecoveryState,
}

pub struct DeviceLifecycleCoordinator<L> {
    ledger: L,
    session_id: SessionId,
    channel_id: ChannelId,
    snapshot: LifecycleSnapshot,
    gap_counter: u64,
    last_gap_id: Option<String>,
    timestamp_source: TimestampSource,
}

impl<L: AudioLedgerPort> DeviceLifecycleCoordinator<L> {
    pub fn new(
        ledger: L,
        session_id: SessionId,
        channel_id: ChannelId,
        snapshot: LifecycleSnapshot,
        timestamp_source: TimestampSource,
    ) -> Self {
        Self {
            ledger,
            session_id,
            channel_id,
            snapshot,
            gap_counter: 0,
            last_gap_id: None,
            timestamp_source,
        }
    }

    pub fn snapshot(&self) -> LifecycleSnapshot {
        self.snapshot
    }

    pub fn ledger(&self) -> &L {
        &self.ledger
    }

    pub fn last_gap_id(&self) -> Option<&str> {
        self.last_gap_id.as_deref()
    }

    pub fn into_ledger(self) -> L {
        self.ledger
    }

    pub fn handle(
        &mut self,
        event: DeviceLifecycleEvent,
        sequence: u64,
        qpc_100ns: Option<u64>,
    ) -> Result<Vec<LifecycleAction>, CoreError> {
        let timestamp = (self.timestamp_source)();
        match event {
            DeviceLifecycleEvent::DeviceUnplugged { device_id } => {
                self.record_interruption_gap(
                    sequence,
                    qpc_100ns,
                    GapReason::DeviceInvalidated,
                    "device-unplugged",
                    &timestamp,
                )?;
                self.transition(
                    CaptureState::Recovering,
                    DeviceState::Disconnected,
                    RecoveryState::ScanRequired,
                    json!({"event":"device-unplugged","device_id":device_id}),
                    &timestamp,
                )?;
                Ok(vec![
                    LifecycleAction::StopCapture,
                    LifecycleAction::FinalizePersistence,
                    LifecycleAction::AwaitDevice,
                ])
            }
            DeviceLifecycleEvent::DeviceInvalidated { device_id } => {
                self.record_interruption_gap(
                    sequence,
                    qpc_100ns,
                    GapReason::DeviceInvalidated,
                    "device-invalidated",
                    &timestamp,
                )?;
                self.transition(
                    CaptureState::Recovering,
                    DeviceState::Invalidated,
                    RecoveryState::ScanRequired,
                    json!({"event":"device-invalidated","device_id":device_id}),
                    &timestamp,
                )?;
                Ok(vec![
                    LifecycleAction::StopCapture,
                    LifecycleAction::FinalizePersistence,
                    LifecycleAction::AwaitDevice,
                ])
            }
            DeviceLifecycleEvent::DefaultDeviceChanged { device_id } => {
                self.record_interruption_gap(
                    sequence,
                    qpc_100ns,
                    GapReason::Reconnect,
                    "default-device-changed",
                    &timestamp,
                )?;
                self.transition(
                    CaptureState::Recovering,
                    DeviceState::DefaultChanged,
                    RecoveryState::ScanRequired,
                    json!({"event":"default-device-changed","device_id":device_id}),
                    &timestamp,
                )?;
                Ok(vec![
                    LifecycleAction::StopCapture,
                    LifecycleAction::FinalizePersistence,
                    LifecycleAction::RunRecoveryScan,
                    LifecycleAction::RestartCapture,
                ])
            }
            DeviceLifecycleEvent::Suspend => {
                self.record_interruption_gap(
                    sequence,
                    qpc_100ns,
                    GapReason::Reconnect,
                    "system-suspend",
                    &timestamp,
                )?;
                self.transition(
                    CaptureState::Recovering,
                    DeviceState::Suspended,
                    RecoveryState::ScanRequired,
                    json!({"event":"system-suspend"}),
                    &timestamp,
                )?;
                Ok(vec![
                    LifecycleAction::StopCapture,
                    LifecycleAction::FinalizePersistence,
                ])
            }
            DeviceLifecycleEvent::Resume => {
                self.transition(
                    CaptureState::Recovering,
                    DeviceState::Resuming,
                    self.snapshot.recovery_state,
                    json!({"event":"system-resume"}),
                    &timestamp,
                )?;
                Ok(vec![
                    LifecycleAction::RunRecoveryScan,
                    LifecycleAction::RestartCapture,
                ])
            }
            DeviceLifecycleEvent::ReconnectDetected { device_id } => {
                self.transition(
                    CaptureState::Recovering,
                    DeviceState::Reconnecting,
                    self.snapshot.recovery_state,
                    json!({"event":"reconnect-detected","device_id":device_id}),
                    &timestamp,
                )?;
                Ok(vec![
                    LifecycleAction::RunRecoveryScan,
                    LifecycleAction::RestartCapture,
                ])
            }
            DeviceLifecycleEvent::RestartDetected => {
                self.record_interruption_gap(
                    sequence,
                    qpc_100ns,
                    GapReason::Unknown,
                    "process-restart",
                    &timestamp,
                )?;
                self.transition(
                    CaptureState::Recovering,
                    self.snapshot.device_state,
                    RecoveryState::ScanRequired,
                    json!({"event":"process-restart"}),
                    &timestamp,
                )?;
                Ok(vec![LifecycleAction::RunRecoveryScan])
            }
            DeviceLifecycleEvent::RecoveryScanStarted => {
                self.transition(
                    self.snapshot.capture_state,
                    self.snapshot.device_state,
                    RecoveryState::Scanning,
                    json!({"event":"recovery-scan-started"}),
                    &timestamp,
                )?;
                Ok(Vec::new())
            }
            DeviceLifecycleEvent::RecoveryScanCompleted { incomplete_chunks } => {
                let state = if incomplete_chunks == 0 {
                    RecoveryState::Recovered
                } else {
                    RecoveryState::Recoverable
                };
                self.transition(
                    self.snapshot.capture_state,
                    self.snapshot.device_state,
                    state,
                    json!({
                        "event":"recovery-scan-completed",
                        "incomplete_chunks":incomplete_chunks,
                    }),
                    &timestamp,
                )?;
                Ok(Vec::new())
            }
            DeviceLifecycleEvent::CaptureRestarted { device_id } => {
                let recovery_state = if self.snapshot.recovery_state == RecoveryState::Recovered {
                    RecoveryState::Clean
                } else {
                    self.snapshot.recovery_state
                };
                self.transition(
                    CaptureState::Capturing,
                    DeviceState::Available,
                    recovery_state,
                    json!({"event":"capture-restarted","device_id":device_id}),
                    &timestamp,
                )?;
                Ok(Vec::new())
            }
            DeviceLifecycleEvent::CaptureStopRequested => {
                self.transition(
                    CaptureState::Stopping,
                    self.snapshot.device_state,
                    self.snapshot.recovery_state,
                    json!({"event":"capture-stop-requested"}),
                    &timestamp,
                )?;
                Ok(vec![
                    LifecycleAction::StopCapture,
                    LifecycleAction::FinalizePersistence,
                ])
            }
            DeviceLifecycleEvent::CaptureStopped => {
                self.transition(
                    CaptureState::Stopped,
                    self.snapshot.device_state,
                    self.snapshot.recovery_state,
                    json!({"event":"capture-stopped"}),
                    &timestamp,
                )?;
                Ok(Vec::new())
            }
        }
    }

    fn transition(
        &mut self,
        capture_state: CaptureState,
        device_state: DeviceState,
        recovery_state: RecoveryState,
        detail: serde_json::Value,
        timestamp: &str,
    ) -> Result<(), CoreError> {
        let transition = LifecycleTransition {
            session_id: self.session_id,
            channel_id: Some(self.channel_id.clone()),
            previous_capture_state: self.snapshot.capture_state,
            capture_state,
            previous_device_state: self.snapshot.device_state,
            device_state,
            previous_recovery_state: self.snapshot.recovery_state,
            recovery_state,
            detail_json: detail.to_string(),
            occurred_at_utc: timestamp.into(),
        };
        self.ledger.record_lifecycle(&transition)?;
        self.snapshot = LifecycleSnapshot {
            capture_state,
            device_state,
            recovery_state,
        };
        Ok(())
    }

    fn record_interruption_gap(
        &mut self,
        sequence: u64,
        qpc_100ns: Option<u64>,
        reason: GapReason,
        event: &str,
        timestamp: &str,
    ) -> Result<(), CoreError> {
        self.gap_counter = self
            .gap_counter
            .checked_add(1)
            .ok_or_else(|| CoreError::Storage("lifecycle gap counter overflowed".into()))?;
        let gap_id = format!(
            "lifecycle-gap-{}-{}-{:020}",
            self.session_id, self.gap_counter, sequence
        );
        self.ledger.record_gap(&Gap {
            id: gap_id.clone(),
            session_id: self.session_id,
            channel_id: self.channel_id.clone(),
            seq_start: sequence,
            seq_end: None,
            qpc_detected_100ns: qpc_100ns,
            expected_device_position: None,
            observed_device_position: None,
            reason,
            detail_json: json!({"event":event,"extent_known":false}).to_string(),
            attempts: 0,
            retry_at_utc: None,
            status: GapStatus::Open,
            created_at_utc: timestamp.into(),
            resolved_at_utc: None,
        })?;
        self.last_gap_id = Some(gap_id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::domain::{
        ledger::{AudioChannel, AudioChunk, Session},
        ports::AudioLedgerPort,
    };

    use super::*;

    #[derive(Default)]
    struct RecordingLedger {
        gaps: Vec<Gap>,
        transitions: Vec<LifecycleTransition>,
    }

    impl AudioLedgerPort for RecordingLedger {
        fn create_session(&mut self, _session: &Session) -> Result<(), CoreError> {
            Ok(())
        }

        fn register_channel(&mut self, _channel: &AudioChannel) -> Result<(), CoreError> {
            Ok(())
        }

        fn stage_chunk(&mut self, _chunk: &AudioChunk) -> Result<(), CoreError> {
            Ok(())
        }

        fn commit_chunk(
            &mut self,
            _chunk: &AudioChunk,
            _preceding_gap: Option<&Gap>,
        ) -> Result<(), CoreError> {
            Ok(())
        }

        fn record_gap(&mut self, gap: &Gap) -> Result<(), CoreError> {
            self.gaps.push(gap.clone());
            Ok(())
        }

        fn record_lifecycle(&mut self, transition: &LifecycleTransition) -> Result<(), CoreError> {
            transition
                .validate()
                .map_err(|error| CoreError::InvalidState(error.into()))?;
            self.transitions.push(transition.clone());
            Ok(())
        }
    }

    fn coordinator() -> DeviceLifecycleCoordinator<RecordingLedger> {
        DeviceLifecycleCoordinator::new(
            RecordingLedger::default(),
            SessionId(1),
            ChannelId("mic".into()),
            LifecycleSnapshot {
                capture_state: CaptureState::Capturing,
                device_state: DeviceState::Available,
                recovery_state: RecoveryState::Clean,
            },
            Arc::new(|| "2026-08-15T00:00:00Z".into()),
        )
    }

    #[test]
    fn unplug_is_persisted_before_capture_stops_and_waits_for_reconnect() {
        let mut coordinator = coordinator();
        let actions = coordinator
            .handle(
                DeviceLifecycleEvent::DeviceUnplugged {
                    device_id: "mic-a".into(),
                },
                480,
                Some(1_000),
            )
            .unwrap();
        assert_eq!(
            actions,
            vec![
                LifecycleAction::StopCapture,
                LifecycleAction::FinalizePersistence,
                LifecycleAction::AwaitDevice,
            ]
        );
        assert_eq!(coordinator.ledger().gaps.len(), 1);
        assert_eq!(coordinator.ledger().gaps[0].seq_end, None);
        assert_eq!(
            coordinator.snapshot().device_state,
            DeviceState::Disconnected
        );
    }

    #[test]
    fn default_change_recovery_and_restart_are_explicit_transitions() {
        let mut coordinator = coordinator();
        coordinator
            .handle(
                DeviceLifecycleEvent::DefaultDeviceChanged {
                    device_id: "mic-b".into(),
                },
                960,
                Some(2_000),
            )
            .unwrap();
        coordinator
            .handle(DeviceLifecycleEvent::RecoveryScanStarted, 960, None)
            .unwrap();
        coordinator
            .handle(
                DeviceLifecycleEvent::RecoveryScanCompleted {
                    incomplete_chunks: 0,
                },
                960,
                None,
            )
            .unwrap();
        coordinator
            .handle(
                DeviceLifecycleEvent::CaptureRestarted {
                    device_id: "mic-b".into(),
                },
                960,
                None,
            )
            .unwrap();
        assert_eq!(
            coordinator.snapshot(),
            LifecycleSnapshot {
                capture_state: CaptureState::Capturing,
                device_state: DeviceState::Available,
                recovery_state: RecoveryState::Clean,
            }
        );
        assert_eq!(coordinator.ledger().transitions.len(), 4);
    }

    #[test]
    fn suspend_resume_and_reconnect_remain_recoverable() {
        let mut coordinator = coordinator();
        coordinator
            .handle(DeviceLifecycleEvent::Suspend, 1_440, Some(3_000))
            .unwrap();
        assert_eq!(coordinator.snapshot().device_state, DeviceState::Suspended);
        coordinator
            .handle(DeviceLifecycleEvent::Resume, 1_440, None)
            .unwrap();
        assert_eq!(coordinator.snapshot().device_state, DeviceState::Resuming);
        coordinator
            .handle(
                DeviceLifecycleEvent::ReconnectDetected {
                    device_id: "mic-a".into(),
                },
                1_440,
                None,
            )
            .unwrap();
        assert_eq!(
            coordinator.snapshot().device_state,
            DeviceState::Reconnecting
        );
        assert_eq!(coordinator.ledger().gaps.len(), 1);
    }

    #[test]
    fn restart_requires_scan_and_preserves_unknown_extent() {
        let mut coordinator = coordinator();
        let actions = coordinator
            .handle(DeviceLifecycleEvent::RestartDetected, 2_000, None)
            .unwrap();
        assert_eq!(actions, vec![LifecycleAction::RunRecoveryScan]);
        assert_eq!(
            coordinator.snapshot().recovery_state,
            RecoveryState::ScanRequired
        );
        assert_eq!(coordinator.ledger().gaps[0].reason, GapReason::Unknown);
    }
}
