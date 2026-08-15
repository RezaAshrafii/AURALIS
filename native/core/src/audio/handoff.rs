use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
    mpsc::{Receiver, RecvError, RecvTimeoutError, SyncSender, TryRecvError, TrySendError},
};
use std::time::Duration;

use crate::domain::ports::{CaptureHandoffError, CaptureHandoffPort, CapturedFrame, CoreError};

const NO_SEQUENCE: u64 = u64::MAX;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CaptureQueueStats {
    pub accepted_buffers: u64,
    pub accepted_samples: u64,
    pub dropped_buffers: u64,
    pub dropped_samples: u64,
    pub dropped_runs: u64,
    pub first_dropped_sequence: Option<u64>,
    pub last_dropped_sequence_end: Option<u64>,
    pub closed_rejections: u64,
}

#[derive(Debug, Default)]
struct CaptureQueueCounters {
    accepted_buffers: AtomicU64,
    accepted_samples: AtomicU64,
    dropped_buffers: AtomicU64,
    dropped_samples: AtomicU64,
    dropped_runs: AtomicU64,
    first_dropped_sequence: AtomicU64,
    last_dropped_sequence_end: AtomicU64,
    closed_rejections: AtomicU64,
}

impl CaptureQueueCounters {
    fn initialized() -> Self {
        Self {
            first_dropped_sequence: AtomicU64::new(NO_SEQUENCE),
            last_dropped_sequence_end: AtomicU64::new(NO_SEQUENCE),
            ..Self::default()
        }
    }

    fn record_accepted(&self, samples: u32) {
        self.accepted_buffers.fetch_add(1, Ordering::Relaxed);
        self.accepted_samples
            .fetch_add(u64::from(samples), Ordering::Relaxed);
    }

    fn record_dropped(&self, frame: &CapturedFrame, closed: bool) {
        let start = frame.meta.sequence_start;
        let end = frame.meta.sequence_end().unwrap_or(NO_SEQUENCE);
        self.dropped_buffers.fetch_add(1, Ordering::Relaxed);
        self.dropped_samples.fetch_add(
            u64::from(frame.meta.sample_count_per_channel),
            Ordering::Relaxed,
        );
        if closed {
            self.closed_rejections.fetch_add(1, Ordering::Relaxed);
        }
        let _ = self.first_dropped_sequence.compare_exchange(
            NO_SEQUENCE,
            start,
            Ordering::Relaxed,
            Ordering::Relaxed,
        );
        let previous_end = self.last_dropped_sequence_end.swap(end, Ordering::Relaxed);
        if previous_end == NO_SEQUENCE || previous_end != start {
            self.dropped_runs.fetch_add(1, Ordering::Relaxed);
        }
    }

    fn snapshot(&self) -> CaptureQueueStats {
        let first = self.first_dropped_sequence.load(Ordering::Relaxed);
        let last = self.last_dropped_sequence_end.load(Ordering::Relaxed);
        CaptureQueueStats {
            accepted_buffers: self.accepted_buffers.load(Ordering::Relaxed),
            accepted_samples: self.accepted_samples.load(Ordering::Relaxed),
            dropped_buffers: self.dropped_buffers.load(Ordering::Relaxed),
            dropped_samples: self.dropped_samples.load(Ordering::Relaxed),
            dropped_runs: self.dropped_runs.load(Ordering::Relaxed),
            first_dropped_sequence: (first != NO_SEQUENCE).then_some(first),
            last_dropped_sequence_end: (last != NO_SEQUENCE).then_some(last),
            closed_rejections: self.closed_rejections.load(Ordering::Relaxed),
        }
    }
}

#[derive(Debug)]
pub struct BoundedCaptureSender {
    sender: SyncSender<CapturedFrame>,
    capacity: usize,
    counters: Arc<CaptureQueueCounters>,
}

impl BoundedCaptureSender {
    pub fn stats(&self) -> CaptureQueueStats {
        self.counters.snapshot()
    }
}

impl CaptureHandoffPort for BoundedCaptureSender {
    fn try_submit(&self, frame: CapturedFrame) -> Result<(), CaptureHandoffError> {
        let samples = frame.meta.sample_count_per_channel;
        match self.sender.try_send(frame) {
            Ok(()) => {
                self.counters.record_accepted(samples);
                Ok(())
            }
            Err(TrySendError::Full(frame)) => {
                self.counters.record_dropped(&frame, false);
                Err(CaptureHandoffError::Full)
            }
            Err(TrySendError::Disconnected(frame)) => {
                self.counters.record_dropped(&frame, true);
                Err(CaptureHandoffError::Closed)
            }
        }
    }

    fn capacity(&self) -> usize {
        self.capacity
    }
}

#[derive(Debug)]
pub struct CaptureQueueReceiver {
    receiver: Receiver<CapturedFrame>,
    counters: Arc<CaptureQueueCounters>,
}

impl CaptureQueueReceiver {
    pub fn recv(&self) -> Result<CapturedFrame, RecvError> {
        self.receiver.recv()
    }

    pub fn recv_timeout(&self, timeout: Duration) -> Result<CapturedFrame, RecvTimeoutError> {
        self.receiver.recv_timeout(timeout)
    }

    pub fn try_recv(&self) -> Result<CapturedFrame, TryRecvError> {
        self.receiver.try_recv()
    }

    pub fn stats(&self) -> CaptureQueueStats {
        self.counters.snapshot()
    }
}

pub fn bounded_capture_queue(
    capacity: usize,
) -> Result<(Arc<BoundedCaptureSender>, CaptureQueueReceiver), CoreError> {
    if capacity == 0 {
        return Err(CoreError::InvalidState(
            "capture queue capacity must be non-zero".into(),
        ));
    }
    let (sender, receiver) = std::sync::mpsc::sync_channel(capacity);
    let counters = Arc::new(CaptureQueueCounters::initialized());
    Ok((
        Arc::new(BoundedCaptureSender {
            sender,
            capacity,
            counters: Arc::clone(&counters),
        }),
        CaptureQueueReceiver { receiver, counters },
    ))
}

#[cfg(test)]
mod tests {
    use crate::domain::{
        audio_frame::{AudioFrameMeta, ChannelId, FrameFlags, SampleFormat, SessionId},
        ledger::SourceKind,
    };

    use super::*;

    fn frame(sequence_start: u64) -> CapturedFrame {
        CapturedFrame {
            meta: AudioFrameMeta {
                session_id: SessionId(1),
                channel_id: ChannelId("mic".into()),
                source_kind: SourceKind::UserMic,
                sequence_start,
                sample_count_per_channel: 10,
                sample_rate_hz: 48_000,
                channels: 1,
                channel_mask: Some(4),
                sample_format: SampleFormat::PcmI16,
                bits_per_sample: 16,
                valid_bits_per_sample: 16,
                block_align: 2,
                qpc_start_100ns: sequence_start * 100,
                qpc_end_100ns: (sequence_start + 10) * 100,
                device_position: Some(sequence_start),
                flags: FrameFlags::default(),
                discontinuity: None,
            },
            payload: Arc::from([0_u8; 20]),
        }
    }

    #[test]
    fn full_queue_returns_immediately_and_makes_loss_observable() {
        let (sender, receiver) = bounded_capture_queue(1).unwrap();
        sender.try_submit(frame(0)).unwrap();
        assert_eq!(sender.try_submit(frame(10)), Err(CaptureHandoffError::Full));

        let stats = sender.stats();
        assert_eq!(stats.dropped_buffers, 1);
        assert_eq!(stats.dropped_samples, 10);
        assert_eq!(stats.dropped_runs, 1);
        assert_eq!(stats.first_dropped_sequence, Some(10));
        assert_eq!(stats.last_dropped_sequence_end, Some(20));

        assert_eq!(receiver.try_recv().unwrap().meta.sequence_start, 0);
        sender.try_submit(frame(20)).unwrap();
        assert_eq!(receiver.try_recv().unwrap().meta.sequence_start, 20);
        let stats = receiver.stats();
        assert_eq!(stats.accepted_buffers, 2);
        assert_eq!(stats.accepted_samples, 20);
    }

    #[test]
    fn disjoint_overflows_are_counted_as_separate_runs() {
        let (sender, receiver) = bounded_capture_queue(1).unwrap();
        sender.try_submit(frame(0)).unwrap();
        assert_eq!(sender.try_submit(frame(10)), Err(CaptureHandoffError::Full));
        receiver.try_recv().unwrap();
        sender.try_submit(frame(20)).unwrap();
        assert_eq!(sender.try_submit(frame(30)), Err(CaptureHandoffError::Full));

        let stats = sender.stats();
        assert_eq!(stats.dropped_buffers, 2);
        assert_eq!(stats.dropped_runs, 2);
        assert_eq!(stats.dropped_samples, 20);
    }

    #[test]
    fn zero_capacity_is_rejected() {
        assert!(bounded_capture_queue(0).is_err());
    }
}
