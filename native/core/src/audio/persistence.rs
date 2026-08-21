use std::{sync::Arc, sync::mpsc::RecvTimeoutError, time::Duration};

use serde_json::json;

use crate::domain::{
    audio_frame::{ChannelId, SessionId},
    ledger::{Gap, GapReason, GapStatus},
    ports::{AudioLedgerPort, AudioSpoolPort, CapturedFrame, CoreError, SpoolAppendResult},
};

use super::{handoff::CaptureQueueReceiver, spool::gap_reason};

type TimestampSource = Arc<dyn Fn() -> String + Send + Sync>;

#[derive(Debug, Clone)]
pub struct PersistenceCursor {
    pub session_id: SessionId,
    pub channel_id: ChannelId,
    pub initial_sequence: u64,
    pub initial_device_position: Option<u64>,
}

/// Owns the blocking side of the bounded capture handoff.
///
/// This worker persists raw bytes and their ledger state before any VAD, ASR,
/// provider, UI, or Brain consumer can observe them.
pub struct CapturePersistenceWorker<L, S> {
    receiver: CaptureQueueReceiver,
    ledger: L,
    spool: S,
    session_id: SessionId,
    channel_id: ChannelId,
    expected_sequence: u64,
    expected_device_position: Option<u64>,
    gap_counter: u64,
    timestamp_source: TimestampSource,
}

impl<L: AudioLedgerPort, S: AudioSpoolPort> CapturePersistenceWorker<L, S> {
    pub fn new(
        receiver: CaptureQueueReceiver,
        ledger: L,
        spool: S,
        cursor: PersistenceCursor,
        timestamp_source: TimestampSource,
    ) -> Self {
        Self {
            receiver,
            ledger,
            spool,
            session_id: cursor.session_id,
            channel_id: cursor.channel_id,
            expected_sequence: cursor.initial_sequence,
            expected_device_position: cursor.initial_device_position,
            gap_counter: 0,
            timestamp_source,
        }
    }

    pub fn expected_sequence(&self) -> u64 {
        self.expected_sequence
    }

    pub fn ledger(&self) -> &L {
        &self.ledger
    }

    pub fn process_frame(&mut self, frame: CapturedFrame) -> Result<(), CoreError> {
        frame
            .meta
            .validate()
            .map_err(|error| CoreError::InvalidState(error.into()))?;
        if frame.meta.session_id != self.session_id || frame.meta.channel_id != self.channel_id {
            return Err(CoreError::InvalidState(
                "capture frame belongs to a different persistence worker".into(),
            ));
        }

        let observed_start = frame.meta.sequence_start;
        let observed_end = frame
            .meta
            .sequence_end()
            .ok_or_else(|| CoreError::InvalidState("frame sequence overflowed".into()))?;
        if observed_start < self.expected_sequence {
            self.record_gap(
                observed_start,
                None,
                GapReason::Unknown,
                frame.meta.qpc_start_100ns,
                frame.meta.device_position,
                "sequence-regression",
            )?;
            return Err(CoreError::InvalidState(format!(
                "capture sequence regressed: expected={}, observed={observed_start}",
                self.expected_sequence
            )));
        }

        if observed_start > self.expected_sequence || frame.meta.discontinuity.is_some() {
            self.finalize_open_chunk()?;
        }
        if observed_start > self.expected_sequence {
            self.record_gap(
                self.expected_sequence,
                Some(observed_start),
                frame
                    .meta
                    .discontinuity
                    .map(gap_reason)
                    .unwrap_or(GapReason::QueueOverflow),
                frame.meta.qpc_start_100ns,
                frame.meta.device_position,
                "forward-sequence-jump",
            )?;
        } else if let Some(discontinuity) = frame.meta.discontinuity {
            self.record_gap(
                observed_start,
                None,
                gap_reason(discontinuity),
                frame.meta.qpc_start_100ns,
                frame.meta.device_position,
                "reported-discontinuity-with-unknown-extent",
            )?;
        }

        let result = match self.spool.append(frame.clone()) {
            Ok(result) => result,
            Err(error) => {
                self.record_gap(
                    observed_start,
                    Some(observed_end),
                    GapReason::SpoolWriteFailure,
                    frame.meta.qpc_start_100ns,
                    frame.meta.device_position,
                    "raw-spool-write-failed",
                )?;
                return Err(error);
            }
        };
        match result {
            SpoolAppendResult::Staged(chunk) => self.ledger.stage_chunk(&chunk)?,
            SpoolAppendResult::ReadyToFinalize(chunk) => {
                // Recovery depends on this staging extent being durable before
                // the atomic rename makes the finalized spool chunk visible.
                self.ledger.stage_chunk(&chunk)?;
                let finalized =
                    self.spool
                        .finalize_channel(&self.channel_id)?
                        .ok_or_else(|| {
                            CoreError::Spool("ready chunk disappeared before finalize".into())
                        })?;
                self.ledger.commit_chunk(&finalized, None)?;
            }
        }

        self.expected_sequence = observed_end;
        self.expected_device_position = frame.meta.device_position.and_then(|position| {
            position.checked_add(u64::from(frame.meta.sample_count_per_channel))
        });
        Ok(())
    }

    pub fn process_next(&mut self, timeout: Duration) -> Result<bool, CoreError> {
        match self.receiver.recv_timeout(timeout) {
            Ok(frame) => {
                self.process_frame(frame)?;
                Ok(true)
            }
            Err(RecvTimeoutError::Timeout) => Ok(false),
            Err(RecvTimeoutError::Disconnected) => Ok(false),
        }
    }

    pub fn run_until_disconnected(&mut self) -> Result<(), CoreError> {
        while let Ok(frame) = self.receiver.recv() {
            self.process_frame(frame)?;
        }
        self.finish()
    }

    pub fn finish(&mut self) -> Result<(), CoreError> {
        while let Ok(frame) = self.receiver.try_recv() {
            self.process_frame(frame)?;
        }
        self.finalize_open_chunk()?;

        let stats = self.receiver.stats();
        if let Some(dropped_end) = stats.last_dropped_sequence_end
            && dropped_end > self.expected_sequence
        {
            self.record_gap(
                self.expected_sequence,
                Some(dropped_end),
                GapReason::QueueOverflow,
                0,
                None,
                "bounded-queue-tail-overflow",
            )?;
        }
        Ok(())
    }

    pub fn into_parts(self) -> (L, S) {
        (self.ledger, self.spool)
    }

    fn finalize_open_chunk(&mut self) -> Result<(), CoreError> {
        if let Some(chunk) = self.spool.finalize_channel(&self.channel_id)? {
            self.ledger.commit_chunk(&chunk, None)?;
        }
        Ok(())
    }

    fn record_gap(
        &mut self,
        seq_start: u64,
        seq_end: Option<u64>,
        reason: GapReason,
        qpc_detected_100ns: u64,
        observed_device_position: Option<u64>,
        event: &str,
    ) -> Result<(), CoreError> {
        self.gap_counter = self
            .gap_counter
            .checked_add(1)
            .ok_or_else(|| CoreError::Storage("gap counter overflowed".into()))?;
        let expected_device_position =
            match (self.expected_device_position, observed_device_position) {
                (Some(expected), Some(observed)) if observed >= expected => Some(expected),
                (Some(expected), None) => Some(expected),
                _ => None,
            };
        let gap = Gap {
            id: format!(
                "gap-{}-{}-{:020}",
                self.session_id, self.gap_counter, seq_start
            ),
            session_id: self.session_id,
            channel_id: self.channel_id.clone(),
            seq_start,
            seq_end,
            qpc_detected_100ns: (qpc_detected_100ns != 0).then_some(qpc_detected_100ns),
            expected_device_position,
            observed_device_position,
            reason,
            detail_json: json!({
                "event": event,
                "expected_sequence": self.expected_sequence,
                "observed_sequence": seq_start,
                "extent_known": seq_end.is_some(),
            })
            .to_string(),
            attempts: 0,
            retry_at_utc: None,
            status: GapStatus::Open,
            created_at_utc: (self.timestamp_source)(),
            resolved_at_utc: None,
        };
        self.ledger.record_gap(&gap)
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    use crate::{
        audio::{handoff::bounded_capture_queue, spool::FileRawSpool},
        domain::{
            audio_frame::{
                AudioFrameMeta, DiscontinuityReason, FrameFlags, SampleFormat, SessionId,
            },
            ledger::{AudioChannel, CaptureState, DeviceState, RecoveryState, Session, SourceKind},
            ports::{CaptureHandoffPort, SpoolContract},
        },
        storage::LedgerRepository,
    };

    use super::*;

    static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

    struct TempSpool(PathBuf);

    impl TempSpool {
        fn new() -> Self {
            let suffix = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "auralis-persistence-{}-{suffix}",
                std::process::id()
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempSpool {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn frame(sequence_start: u64) -> CapturedFrame {
        CapturedFrame {
            meta: AudioFrameMeta {
                session_id: SessionId(9),
                channel_id: ChannelId("mic".into()),
                source_kind: SourceKind::UserMic,
                sequence_start,
                sample_count_per_channel: 4,
                sample_rate_hz: 48_000,
                channels: 1,
                channel_mask: Some(4),
                sample_format: SampleFormat::PcmI16,
                bits_per_sample: 16,
                valid_bits_per_sample: 16,
                block_align: 2,
                qpc_start_100ns: sequence_start * 100 + 1,
                qpc_end_100ns: (sequence_start + 4) * 100 + 1,
                device_position: Some(sequence_start),
                flags: FrameFlags::default(),
                discontinuity: None,
            },
            payload: Arc::from(vec![0; 8]),
        }
    }

    fn worker(
        capacity: usize,
        chunk_frames: u64,
    ) -> (
        Arc<super::super::handoff::BoundedCaptureSender>,
        CapturePersistenceWorker<LedgerRepository, FileRawSpool>,
        TempSpool,
    ) {
        let root = TempSpool::new();
        let mut ledger = LedgerRepository::open_in_memory().unwrap();
        ledger
            .create_session(&Session {
                id: SessionId(9),
                started_at_utc: "2026-08-15T00:00:00Z".into(),
                ended_at_utc: None,
                app_version: "0.13.0-test".into(),
                schema_version: 4,
                capture_state: CaptureState::Capturing,
                recovery_state: RecoveryState::Clean,
                config_snapshot_json: "{}".into(),
            })
            .unwrap();
        ledger
            .register_channel(&AudioChannel {
                id: ChannelId("mic".into()),
                session_id: SessionId(9),
                source_kind: SourceKind::UserMic,
                device_id: Some("fixture".into()),
                device_generation: 1,
                native_sample_rate: 48_000,
                native_channels: 1,
                channel_mask: Some(4),
                sample_format: SampleFormat::PcmI16,
                bits_per_sample: 16,
                valid_bits_per_sample: 16,
                block_align: 2,
                capture_state: CaptureState::Capturing,
                device_state: DeviceState::Available,
                recovery_state: RecoveryState::Clean,
                last_sequence: 0,
                last_qpc_100ns: None,
                last_device_position: None,
            })
            .unwrap();
        let spool = FileRawSpool::new(
            SpoolContract {
                root: root.0.clone(),
                chunk_frames,
                sync_on_finalize: false,
            },
            Arc::new(|| "2026-08-15T00:00:01Z".into()),
        )
        .unwrap();
        let (sender, receiver) = bounded_capture_queue(capacity).unwrap();
        let worker = CapturePersistenceWorker::new(
            receiver,
            ledger,
            spool,
            PersistenceCursor {
                session_id: SessionId(9),
                channel_id: ChannelId("mic".into()),
                initial_sequence: 0,
                initial_device_position: Some(0),
            },
            Arc::new(|| "2026-08-15T00:00:02Z".into()),
        );
        (sender, worker, root)
    }

    #[test]
    fn forward_jump_creates_exact_persistent_gap_and_keeps_order() {
        let (_sender, mut worker, _root) = worker(4, 8);
        worker.process_frame(frame(0)).unwrap();
        worker.process_frame(frame(4)).unwrap();
        worker.process_frame(frame(12)).unwrap();
        worker.finish().unwrap();

        assert_eq!(worker.ledger().counts().unwrap(), (1, 1, 2, 1));
        assert_eq!(
            worker.ledger().channel_last_sequence("mic").unwrap(),
            Some(16)
        );
        assert_eq!(worker.ledger().unknown_gap_count().unwrap(), 0);
    }

    #[test]
    fn bounded_queue_tail_overflow_is_never_silent() {
        let (sender, mut worker, _root) = worker(1, 100);
        sender.try_submit(frame(0)).unwrap();
        assert!(sender.try_submit(frame(4)).is_err());
        worker.process_next(Duration::ZERO).unwrap();
        worker.finish().unwrap();

        assert_eq!(worker.ledger().counts().unwrap(), (1, 1, 1, 1));
        assert_eq!(worker.ledger().unknown_gap_count().unwrap(), 0);
    }

    #[test]
    fn ordering_regression_records_unknown_gap_and_rejects_frame() {
        let (_sender, mut worker, _root) = worker(4, 100);
        worker.process_frame(frame(0)).unwrap();
        let error = worker.process_frame(frame(0)).unwrap_err();
        assert!(error.to_string().contains("sequence regressed"));
        assert_eq!(worker.ledger().unknown_gap_count().unwrap(), 1);
    }

    #[test]
    fn reported_discontinuity_is_persisted_before_new_raw_chunk() {
        let (_sender, mut worker, _root) = worker(4, 100);
        worker.process_frame(frame(0)).unwrap();
        let mut discontinuous = frame(4);
        discontinuous.meta.discontinuity = Some(DiscontinuityReason::TimestampError);
        worker.process_frame(discontinuous).unwrap();
        worker.finish().unwrap();

        assert_eq!(worker.ledger().counts().unwrap(), (1, 1, 2, 1));
        assert_eq!(worker.ledger().unknown_gap_count().unwrap(), 1);
    }
}
