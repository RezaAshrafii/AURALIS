use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
};

use sha2::{Digest, Sha256};

use crate::domain::{
    audio_frame::{AudioFrameMeta, ChannelId, DiscontinuityReason},
    ledger::{AudioChunk, AudioChunkState, GapReason},
    ports::{AudioSpoolPort, CapturedFrame, CoreError, SpoolAppendResult, SpoolContract},
};

type TimestampSource = Arc<dyn Fn() -> String + Send + Sync>;

pub struct FileRawSpool {
    contract: SpoolContract,
    timestamp_source: TimestampSource,
    open_chunks: HashMap<ChannelId, OpenChunk>,
}

struct OpenChunk {
    id: String,
    meta: AudioFrameMeta,
    sequence_end: u64,
    qpc_end_100ns: u64,
    device_position_end: Option<u64>,
    byte_length: u64,
    discontinuity: Option<GapReason>,
    relative_partial_path: PathBuf,
    file: File,
    digest: Sha256,
    created_at_utc: String,
}

impl FileRawSpool {
    pub fn new(
        contract: SpoolContract,
        timestamp_source: TimestampSource,
    ) -> Result<Self, CoreError> {
        contract.validate()?;
        fs::create_dir_all(&contract.root).map_err(spool_error)?;
        Ok(Self {
            contract,
            timestamp_source,
            open_chunks: HashMap::new(),
        })
    }

    pub fn root(&self) -> &Path {
        &self.contract.root
    }

    fn open_chunk(&self, meta: &AudioFrameMeta) -> Result<OpenChunk, CoreError> {
        let channel_component = hex_component(meta.channel_id.0.as_bytes());
        let relative_directory =
            PathBuf::from(meta.session_id.to_string()).join(format!("channel-{channel_component}"));
        let chunk_stem = format!("chunk-{:020}", meta.sequence_start);
        let relative_partial_path = relative_directory.join(format!("{chunk_stem}.raw.partial"));
        let absolute_directory = self.contract.root.join(&relative_directory);
        fs::create_dir_all(&absolute_directory).map_err(spool_error)?;
        let absolute_partial_path = self.contract.root.join(&relative_partial_path);
        let file = OpenOptions::new()
            .append(true)
            .create_new(true)
            .open(&absolute_partial_path)
            .map_err(spool_error)?;

        Ok(OpenChunk {
            id: format!(
                "{}-{channel_component}-{:020}",
                meta.session_id, meta.sequence_start
            ),
            meta: meta.clone(),
            sequence_end: meta.sequence_start,
            qpc_end_100ns: meta.qpc_start_100ns,
            device_position_end: meta.device_position,
            byte_length: 0,
            discontinuity: meta.discontinuity.map(gap_reason),
            relative_partial_path,
            file,
            digest: Sha256::new(),
            created_at_utc: (self.timestamp_source)(),
        })
    }

    fn finalize_open_chunk(&self, mut chunk: OpenChunk) -> Result<AudioChunk, CoreError> {
        chunk.file.flush().map_err(spool_error)?;
        // A finalized spool chunk is recoverable only after its bytes are
        // durable. Keep the legacy contract flag for compatibility, but never
        // allow a commit-visible rename to skip the filesystem barrier.
        let _ = self.contract.sync_on_finalize;
        chunk.file.sync_all().map_err(spool_error)?;
        let relative_final_path = without_partial_extension(&chunk.relative_partial_path)?;
        let absolute_partial_path = self.contract.root.join(&chunk.relative_partial_path);
        let absolute_final_path = self.contract.root.join(&relative_final_path);
        let sha256_hex = std::mem::take(&mut chunk.digest)
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        let finalized = chunk.snapshot(relative_final_path, AudioChunkState::Finalized, sha256_hex);
        drop(chunk.file);
        fs::rename(&absolute_partial_path, &absolute_final_path).map_err(spool_error)?;
        Ok(finalized)
    }
}

impl AudioSpoolPort for FileRawSpool {
    fn append(&mut self, frame: CapturedFrame) -> Result<SpoolAppendResult, CoreError> {
        frame
            .meta
            .validate()
            .map_err(|error| CoreError::InvalidState(error.into()))?;
        let expected_bytes = u64::from(frame.meta.sample_count_per_channel)
            .checked_mul(u64::from(frame.meta.block_align))
            .ok_or_else(|| CoreError::InvalidState("frame payload length overflowed".into()))?;
        if usize::try_from(expected_bytes).ok() != Some(frame.payload.len()) {
            return Err(CoreError::InvalidState(format!(
                "frame payload length mismatch: expected={expected_bytes}, observed={}",
                frame.payload.len()
            )));
        }

        if !self.open_chunks.contains_key(&frame.meta.channel_id) {
            let chunk = self.open_chunk(&frame.meta)?;
            self.open_chunks
                .insert(frame.meta.channel_id.clone(), chunk);
        }

        let channel_id = frame.meta.channel_id.clone();
        let should_finalize = {
            let chunk = self
                .open_chunks
                .get_mut(&channel_id)
                .ok_or_else(|| CoreError::Spool("open chunk disappeared before append".into()))?;
            chunk.validate_next_frame(&frame.meta)?;
            chunk.file.write_all(&frame.payload).map_err(spool_error)?;
            chunk.digest.update(&frame.payload);
            chunk.byte_length = chunk
                .byte_length
                .checked_add(expected_bytes)
                .ok_or_else(|| CoreError::Spool("chunk byte length overflowed".into()))?;
            chunk.sequence_end = frame
                .meta
                .sequence_end()
                .ok_or_else(|| CoreError::InvalidState("frame sequence overflowed".into()))?;
            chunk.qpc_end_100ns = frame.meta.qpc_end_100ns;
            chunk.device_position_end = frame.meta.device_position.and_then(|position| {
                position.checked_add(u64::from(frame.meta.sample_count_per_channel))
            });
            if chunk.discontinuity.is_none() {
                chunk.discontinuity = frame.meta.discontinuity.map(gap_reason);
            }
            chunk.sequence_end - chunk.meta.sequence_start >= self.contract.chunk_frames
        };

        if should_finalize {
            let chunk = self.open_chunks.get(&channel_id).ok_or_else(|| {
                CoreError::Spool("open chunk disappeared before finalization".into())
            })?;
            Ok(SpoolAppendResult::ReadyToFinalize(Box::new(
                chunk.snapshot(
                    chunk.relative_partial_path.clone(),
                    AudioChunkState::Staging,
                    String::new(),
                ),
            )))
        } else {
            let chunk = self
                .open_chunks
                .get(&channel_id)
                .ok_or_else(|| CoreError::Spool("open chunk disappeared after append".into()))?;
            Ok(SpoolAppendResult::Staged(Box::new(chunk.snapshot(
                chunk.relative_partial_path.clone(),
                AudioChunkState::Staging,
                String::new(),
            ))))
        }
    }

    fn finalize_channel(
        &mut self,
        channel_id: &ChannelId,
    ) -> Result<Option<AudioChunk>, CoreError> {
        self.open_chunks
            .remove(channel_id)
            .map(|chunk| self.finalize_open_chunk(chunk))
            .transpose()
    }
}

impl OpenChunk {
    fn validate_next_frame(&self, meta: &AudioFrameMeta) -> Result<(), CoreError> {
        if meta.session_id != self.meta.session_id
            || meta.channel_id != self.meta.channel_id
            || meta.source_kind != self.meta.source_kind
        {
            return Err(CoreError::InvalidState(
                "frame identity changed inside an open spool chunk".into(),
            ));
        }
        if meta.sequence_start != self.sequence_end {
            return Err(CoreError::InvalidState(format!(
                "spool sequence is not contiguous: expected={}, observed={}",
                self.sequence_end, meta.sequence_start
            )));
        }
        if meta.sample_rate_hz != self.meta.sample_rate_hz
            || meta.channels != self.meta.channels
            || meta.channel_mask != self.meta.channel_mask
            || meta.sample_format != self.meta.sample_format
            || meta.bits_per_sample != self.meta.bits_per_sample
            || meta.valid_bits_per_sample != self.meta.valid_bits_per_sample
            || meta.block_align != self.meta.block_align
        {
            return Err(CoreError::InvalidState(
                "frame format changed inside an open spool chunk".into(),
            ));
        }
        Ok(())
    }

    fn snapshot(&self, path: PathBuf, state: AudioChunkState, sha256_hex: String) -> AudioChunk {
        AudioChunk {
            id: self.id.clone(),
            session_id: self.meta.session_id,
            channel_id: self.meta.channel_id.clone(),
            seq_start: self.meta.sequence_start,
            seq_end: self.sequence_end,
            qpc_start_100ns: self.meta.qpc_start_100ns,
            qpc_end_100ns: self.qpc_end_100ns,
            device_position_start: self.meta.device_position,
            device_position_end: self.device_position_end,
            sample_rate: self.meta.sample_rate_hz,
            channels: self.meta.channels,
            channel_mask: self.meta.channel_mask,
            sample_format: self.meta.sample_format,
            bits_per_sample: self.meta.bits_per_sample,
            valid_bits_per_sample: self.meta.valid_bits_per_sample,
            block_align: self.meta.block_align,
            path,
            byte_length: self.byte_length,
            sha256_hex,
            discontinuity: self.discontinuity,
            state,
            created_at_utc: self.created_at_utc.clone(),
        }
    }
}

pub fn gap_reason(reason: DiscontinuityReason) -> GapReason {
    match reason {
        DiscontinuityReason::WasapiDataDiscontinuity => GapReason::WasapiDataDiscontinuity,
        DiscontinuityReason::TimestampError => GapReason::TimestampError,
        DiscontinuityReason::DevicePositionGap => GapReason::DevicePositionGap,
        DiscontinuityReason::QueueOverflow => GapReason::QueueOverflow,
        DiscontinuityReason::DeviceInvalidated => GapReason::DeviceInvalidated,
        DiscontinuityReason::SpoolWriteFailure => GapReason::SpoolWriteFailure,
        DiscontinuityReason::Reconnect => GapReason::Reconnect,
    }
}

fn hex_component(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn without_partial_extension(path: &Path) -> Result<PathBuf, CoreError> {
    let value = path.to_string_lossy();
    let Some(final_value) = value.strip_suffix(".partial") else {
        return Err(CoreError::Spool(
            "staged spool path does not end in .partial".into(),
        ));
    };
    Ok(PathBuf::from(final_value))
}

fn spool_error(error: std::io::Error) -> CoreError {
    CoreError::Spool(error.to_string())
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        sync::atomic::{AtomicU64, Ordering},
    };

    use crate::domain::{
        audio_frame::{FrameFlags, SampleFormat, SessionId},
        ledger::SourceKind,
    };

    use super::*;

    static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

    struct TempSpool(PathBuf);

    impl TempSpool {
        fn new() -> Self {
            let suffix = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir()
                .join(format!("auralis-raw-spool-{}-{suffix}", std::process::id()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempSpool {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn frame(sequence_start: u64, byte: u8) -> CapturedFrame {
        CapturedFrame {
            meta: AudioFrameMeta {
                session_id: SessionId(7),
                channel_id: ChannelId("mic fixture".into()),
                source_kind: SourceKind::UserMic,
                sequence_start,
                sample_count_per_channel: 4,
                sample_rate_hz: 48_000,
                channels: 2,
                channel_mask: Some(3),
                sample_format: SampleFormat::PcmI16,
                bits_per_sample: 16,
                valid_bits_per_sample: 16,
                block_align: 4,
                qpc_start_100ns: sequence_start * 100,
                qpc_end_100ns: (sequence_start + 4) * 100,
                device_position: Some(sequence_start),
                flags: FrameFlags {
                    silent: byte == 0,
                    ..FrameFlags::default()
                },
                discontinuity: None,
            },
            payload: Arc::from(vec![byte; 16]),
        }
    }

    #[test]
    fn silence_is_written_and_finalize_is_atomic() {
        let root = TempSpool::new();
        let contract = SpoolContract {
            root: root.0.clone(),
            chunk_frames: 8,
            sync_on_finalize: true,
        };
        let mut spool =
            FileRawSpool::new(contract, Arc::new(|| "2026-08-15T00:00:00Z".into())).unwrap();

        let staged = spool.append(frame(0, 0)).unwrap();
        let SpoolAppendResult::Staged(staged) = staged else {
            panic!("first frame should remain staged");
        };
        assert!(staged.path.to_string_lossy().ends_with(".partial"));
        assert_eq!(fs::read(root.0.join(&staged.path)).unwrap(), vec![0; 16]);

        let ready = spool.append(frame(4, 9)).unwrap();
        let SpoolAppendResult::ReadyToFinalize(ready) = ready else {
            panic!("second frame should be ready to finalize");
        };
        assert!(ready.path.to_string_lossy().ends_with(".partial"));
        let finalized = spool
            .finalize_channel(&ChannelId("mic fixture".into()))
            .unwrap()
            .unwrap();
        assert!(finalized.path.to_string_lossy().ends_with(".raw"));
        assert!(!root.0.join(&staged.path).exists());
        assert_eq!(
            fs::read(root.0.join(&finalized.path)).unwrap(),
            [vec![0; 16], vec![9; 16]].concat()
        );
        finalized.validate_for_commit().unwrap();
    }

    #[test]
    fn spool_rejects_unexplained_sequence_jump() {
        let root = TempSpool::new();
        let mut spool = FileRawSpool::new(
            SpoolContract {
                root: root.0.clone(),
                chunk_frames: 12,
                sync_on_finalize: false,
            },
            Arc::new(|| "2026-08-15T00:00:00Z".into()),
        )
        .unwrap();
        spool.append(frame(0, 1)).unwrap();
        let error = spool.append(frame(8, 2)).unwrap_err();
        assert!(error.to_string().contains("not contiguous"));
    }

    #[test]
    fn explicit_flush_finalizes_short_chunk() {
        let root = TempSpool::new();
        let mut spool = FileRawSpool::new(
            SpoolContract {
                root: root.0.clone(),
                chunk_frames: 100,
                sync_on_finalize: false,
            },
            Arc::new(|| "2026-08-15T00:00:00Z".into()),
        )
        .unwrap();
        spool.append(frame(0, 3)).unwrap();
        let chunk = spool
            .finalize_channel(&ChannelId("mic fixture".into()))
            .unwrap()
            .unwrap();
        assert_eq!(chunk.state, AudioChunkState::Finalized);
        assert!(root.0.join(chunk.path).exists());
    }
}
