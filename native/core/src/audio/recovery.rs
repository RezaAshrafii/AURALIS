use std::{
    collections::HashSet,
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    sync::Arc,
};

use serde_json::json;
use sha2::{Digest, Sha256};

use crate::{
    audio::qpc_end_100ns,
    domain::{
        audio_frame::{ChannelId, SessionId},
        ledger::{AudioChunk, AudioChunkState, Gap, GapReason, GapStatus},
        ports::CoreError,
    },
    storage::{LedgerRepository, RecoveryScanOutcome},
};

type TimestampSource = Arc<dyn Fn() -> String + Send + Sync>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecoveryReport {
    pub scan_id: i64,
    pub recovered_chunks: u64,
    pub incomplete_chunks: u64,
    pub missing_chunks: u64,
    pub orphan_files: u64,
    pub restored_jobs: u64,
}

pub struct RecoveryManager<'a> {
    spool_root: &'a Path,
    ledger: &'a mut LedgerRepository,
    timestamp_source: TimestampSource,
}

impl<'a> RecoveryManager<'a> {
    pub fn new(
        spool_root: &'a Path,
        ledger: &'a mut LedgerRepository,
        timestamp_source: TimestampSource,
    ) -> Result<Self, CoreError> {
        if spool_root.as_os_str().is_empty() {
            return Err(CoreError::InvalidState(
                "recovery spool root is required".into(),
            ));
        }
        Ok(Self {
            spool_root,
            ledger,
            timestamp_source,
        })
    }

    pub fn scan_session(&mut self, session_id: SessionId) -> Result<RecoveryReport, CoreError> {
        let started_at = (self.timestamp_source)();
        let scan_id = self.ledger.begin_recovery_scan(session_id, &started_at)?;
        let candidates = self.ledger.recovery_chunks(session_id)?;
        let mut referenced_paths = HashSet::new();
        let mut recovered_chunks = 0_u64;
        let mut incomplete_chunks = 0_u64;
        let mut missing_chunks = 0_u64;

        for candidate in candidates {
            let (partial_path, final_path) = recovery_paths(&candidate.path)?;
            referenced_paths.insert(partial_path.clone());
            referenced_paths.insert(final_path.clone());
            if candidate.state != AudioChunkState::Staging {
                incomplete_chunks = incomplete_chunks.saturating_add(1);
                self.ledger.record_recovery_artifact(
                    scan_id,
                    Some(&candidate.id),
                    &candidate.path,
                    "PREVIOUSLY_UNRESOLVED",
                    None,
                    &json!({"state":candidate.state.as_storage_str()}).to_string(),
                )?;
                continue;
            }

            let absolute_partial = self.spool_root.join(&partial_path);
            let absolute_final = self.spool_root.join(&final_path);
            let partial_exists = absolute_partial.is_file();
            let final_exists = absolute_final.is_file();
            if partial_exists && final_exists {
                incomplete_chunks = incomplete_chunks.saturating_add(1);
                self.record_recovery_gap(
                    scan_id,
                    &candidate,
                    candidate.seq_start,
                    None,
                    "both partial and finalized paths exist",
                )?;
                self.ledger
                    .mark_chunk_recovery_state(&candidate.id, AudioChunkState::Incomplete)?;
                self.ledger.record_recovery_artifact(
                    scan_id,
                    Some(&candidate.id),
                    &candidate.path,
                    "AMBIGUOUS",
                    None,
                    &json!({"partial":partial_path,"final":final_path}).to_string(),
                )?;
                continue;
            }
            let (source_path, source_is_partial) = if partial_exists {
                (absolute_partial, true)
            } else if final_exists {
                (absolute_final.clone(), false)
            } else {
                incomplete_chunks = incomplete_chunks.saturating_add(1);
                missing_chunks = missing_chunks.saturating_add(1);
                self.record_recovery_gap(
                    scan_id,
                    &candidate,
                    candidate.seq_start,
                    Some(candidate.seq_end),
                    "staged raw file is missing",
                )?;
                self.ledger
                    .mark_chunk_recovery_state(&candidate.id, AudioChunkState::Quarantined)?;
                self.ledger.record_recovery_artifact(
                    scan_id,
                    Some(&candidate.id),
                    &candidate.path,
                    "MISSING",
                    None,
                    "{\"raw_file_present\":false}",
                )?;
                continue;
            };

            let observed_bytes = fs::metadata(&source_path).map_err(recovery_io_error)?.len();
            if observed_bytes == 0 || observed_bytes % u64::from(candidate.block_align) != 0 {
                incomplete_chunks = incomplete_chunks.saturating_add(1);
                let complete_frames = observed_bytes / u64::from(candidate.block_align);
                self.record_recovery_gap(
                    scan_id,
                    &candidate,
                    candidate.seq_start.saturating_add(complete_frames),
                    (observed_bytes == 0).then_some(candidate.seq_end),
                    "raw file has zero or partial sample frames",
                )?;
                self.ledger
                    .mark_chunk_recovery_state(&candidate.id, AudioChunkState::Incomplete)?;
                self.ledger.record_recovery_artifact(
                    scan_id,
                    Some(&candidate.id),
                    &candidate.path,
                    "INCOMPLETE",
                    Some(observed_bytes),
                    &json!({
                        "block_align":candidate.block_align,
                        "remainder":observed_bytes % u64::from(candidate.block_align),
                    })
                    .to_string(),
                )?;
                continue;
            }

            let recovered_frames = observed_bytes / u64::from(candidate.block_align);
            let recovered_end = candidate
                .seq_start
                .checked_add(recovered_frames)
                .ok_or_else(|| CoreError::Storage("recovered chunk sequence overflowed".into()))?;
            let original_end = candidate.seq_end;
            let mut recovered = candidate.clone();
            recovered.seq_end = recovered_end;
            recovered.qpc_end_100ns = qpc_end_100ns(
                recovered.qpc_start_100ns,
                u32::try_from(recovered_frames).map_err(|_| {
                    CoreError::Storage("recovered chunk frame count exceeds u32".into())
                })?,
                recovered.sample_rate,
            );
            recovered.device_position_end = recovered
                .device_position_start
                .and_then(|position| position.checked_add(recovered_frames));
            recovered.byte_length = observed_bytes;
            recovered.sha256_hex = sha256_file(&source_path)?;
            recovered.path = final_path.clone();
            recovered.state = AudioChunkState::Finalized;
            recovered.validate_for_commit().map_err(|error| {
                CoreError::Storage(format!("recovered chunk is invalid: {error}"))
            })?;

            if recovered_end < original_end {
                self.record_recovery_gap(
                    scan_id,
                    &candidate,
                    recovered_end,
                    Some(original_end),
                    "raw file ended before staged sequence extent",
                )?;
            }
            if source_is_partial {
                fs::rename(&source_path, &absolute_final).map_err(recovery_io_error)?;
            }
            self.ledger.prepare_staging_recovery(&recovered)?;
            self.ledger.commit_chunk(&recovered, None)?;
            recovered_chunks = recovered_chunks.saturating_add(1);
            self.ledger.record_recovery_artifact(
                scan_id,
                Some(&candidate.id),
                &final_path,
                "RECOVERED",
                Some(observed_bytes),
                &json!({
                    "original_seq_end":original_end,
                    "recovered_seq_end":recovered_end,
                    "filesystem_rename_required":source_is_partial,
                })
                .to_string(),
            )?;
        }

        let orphan_files = self.scan_orphans(scan_id, session_id, &referenced_paths)?;
        let completed_at = (self.timestamp_source)();
        let restored_jobs = self.ledger.restore_recoverable_jobs(&completed_at)?;
        let outcome = RecoveryScanOutcome {
            recovered_chunks,
            incomplete_chunks,
            missing_chunks,
            orphan_files,
            restored_jobs,
        };
        self.ledger
            .complete_recovery_scan(scan_id, &completed_at, outcome)?;
        Ok(RecoveryReport {
            scan_id,
            recovered_chunks,
            incomplete_chunks,
            missing_chunks,
            orphan_files,
            restored_jobs,
        })
    }

    fn scan_orphans(
        &mut self,
        scan_id: i64,
        session_id: SessionId,
        referenced_paths: &HashSet<PathBuf>,
    ) -> Result<u64, CoreError> {
        let session_root = self.spool_root.join(session_id.to_string());
        if !session_root.exists() {
            return Ok(0);
        }
        let files = walk_regular_files(&session_root)?;
        let mut orphan_count = 0_u64;
        for absolute_path in files {
            let relative_path = absolute_path
                .strip_prefix(self.spool_root)
                .map_err(|_| CoreError::Storage("spool file escaped recovery root".into()))?
                .to_path_buf();
            if referenced_paths.contains(&relative_path) || !is_raw_spool_file(&relative_path) {
                continue;
            }
            orphan_count = orphan_count.saturating_add(1);
            let observed_bytes = fs::metadata(&absolute_path)
                .map_err(recovery_io_error)?
                .len();
            self.ledger.record_recovery_artifact(
                scan_id,
                None,
                &relative_path,
                "ORPHAN",
                Some(observed_bytes),
                "{\"ledger_reference_present\":false}",
            )?;
            if let Some((channel_id, sequence_start)) = parse_orphan_identity(&relative_path)
                && self.ledger.channel_exists(session_id, &channel_id)?
            {
                let timestamp = (self.timestamp_source)();
                self.ledger.record_gap(&Gap {
                    id: format!(
                        "recovery-orphan-gap-{scan_id}-{}-{sequence_start}",
                        hex_component(channel_id.0.as_bytes())
                    ),
                    session_id,
                    channel_id,
                    seq_start: sequence_start,
                    seq_end: None,
                    qpc_detected_100ns: None,
                    expected_device_position: None,
                    observed_device_position: None,
                    reason: GapReason::RecoveryTruncation,
                    detail_json: json!({
                        "event":"orphan-raw-file",
                        "path":relative_path,
                        "observed_byte_length":observed_bytes,
                    })
                    .to_string(),
                    attempts: 0,
                    retry_at_utc: None,
                    status: GapStatus::Open,
                    created_at_utc: timestamp,
                    resolved_at_utc: None,
                })?;
            }
        }
        Ok(orphan_count)
    }

    fn record_recovery_gap(
        &mut self,
        scan_id: i64,
        chunk: &AudioChunk,
        seq_start: u64,
        seq_end: Option<u64>,
        detail: &str,
    ) -> Result<(), CoreError> {
        let timestamp = (self.timestamp_source)();
        self.ledger.record_gap(&Gap {
            id: format!("recovery-gap-{scan_id}-{}-{seq_start}", chunk.id),
            session_id: chunk.session_id,
            channel_id: chunk.channel_id.clone(),
            seq_start,
            seq_end,
            qpc_detected_100ns: Some(chunk.qpc_end_100ns),
            expected_device_position: None,
            observed_device_position: None,
            reason: GapReason::RecoveryTruncation,
            detail_json: json!({
                "event":"crash-recovery",
                "chunk_id":chunk.id,
                "detail":detail,
                "extent_known":seq_end.is_some(),
            })
            .to_string(),
            attempts: 0,
            retry_at_utc: None,
            status: GapStatus::Open,
            created_at_utc: timestamp,
            resolved_at_utc: None,
        })
    }
}

fn recovery_paths(path: &Path) -> Result<(PathBuf, PathBuf), CoreError> {
    let value = path.to_string_lossy();
    if let Some(final_value) = value.strip_suffix(".partial") {
        Ok((path.to_path_buf(), PathBuf::from(final_value)))
    } else if value.ends_with(".raw") {
        Ok((
            PathBuf::from(format!("{value}.partial")),
            path.to_path_buf(),
        ))
    } else {
        Err(CoreError::Storage(
            "recovery chunk path is not a raw spool path".into(),
        ))
    }
}

fn sha256_file(path: &Path) -> Result<String, CoreError> {
    let mut file = File::open(path).map_err(recovery_io_error)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(recovery_io_error)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn walk_regular_files(root: &Path) -> Result<Vec<PathBuf>, CoreError> {
    let mut pending = vec![root.to_path_buf()];
    let mut files = Vec::new();
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(&directory).map_err(recovery_io_error)? {
            let entry = entry.map_err(recovery_io_error)?;
            let file_type = entry.file_type().map_err(recovery_io_error)?;
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                pending.push(entry.path());
            } else if file_type.is_file() {
                files.push(entry.path());
            }
        }
    }
    files.sort();
    Ok(files)
}

fn is_raw_spool_file(path: &Path) -> bool {
    let value = path.to_string_lossy();
    value.ends_with(".raw") || value.ends_with(".raw.partial")
}

fn parse_orphan_identity(path: &Path) -> Option<(ChannelId, u64)> {
    let components: Vec<_> = path.components().collect();
    if components.len() != 3 {
        return None;
    }
    let channel_component = components[1]
        .as_os_str()
        .to_str()?
        .strip_prefix("channel-")?;
    let channel_id = String::from_utf8(hex_decode(channel_component)?).ok()?;
    let file_name = components[2].as_os_str().to_str()?;
    let sequence = file_name
        .strip_prefix("chunk-")?
        .split(".raw")
        .next()?
        .parse()
        .ok()?;
    Some((ChannelId(channel_id), sequence))
}

fn hex_decode(value: &str) -> Option<Vec<u8>> {
    if !value.len().is_multiple_of(2) {
        return None;
    }
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let text = std::str::from_utf8(pair).ok()?;
            u8::from_str_radix(text, 16).ok()
        })
        .collect()
}

fn hex_component(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn recovery_io_error(error: std::io::Error) -> CoreError {
    CoreError::Spool(format!("recovery I/O failed: {error}"))
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        sync::atomic::{AtomicU64, Ordering},
    };

    use crate::{
        audio::spool::FileRawSpool,
        domain::{
            audio_frame::{AudioFrameMeta, FrameFlags, SampleFormat},
            ledger::{AudioChannel, CaptureState, DeviceState, RecoveryState, Session, SourceKind},
            ports::{AudioSpoolPort, CapturedFrame, SpoolAppendResult, SpoolContract},
        },
    };

    use super::*;

    static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

    struct TempSpool(PathBuf);

    impl TempSpool {
        fn new() -> Self {
            let suffix = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir()
                .join(format!("auralis-recovery-{}-{suffix}", std::process::id()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempSpool {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn setup(root: &TempSpool) -> (LedgerRepository, PathBuf) {
        let mut ledger = LedgerRepository::open_in_memory().unwrap();
        ledger
            .create_session(&Session {
                id: SessionId(11),
                started_at_utc: "2026-08-15T00:00:00Z".into(),
                ended_at_utc: None,
                app_version: "0.13.0-test".into(),
                schema_version: 5,
                capture_state: CaptureState::Capturing,
                recovery_state: RecoveryState::ScanRequired,
                config_snapshot_json: "{}".into(),
            })
            .unwrap();
        ledger
            .register_channel(&AudioChannel {
                id: ChannelId("mic".into()),
                session_id: SessionId(11),
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
                recovery_state: RecoveryState::ScanRequired,
                last_sequence: 0,
                last_qpc_100ns: None,
                last_device_position: None,
            })
            .unwrap();
        let mut spool = FileRawSpool::new(
            SpoolContract {
                root: root.0.clone(),
                chunk_frames: 100,
                sync_on_finalize: false,
            },
            Arc::new(|| "2026-08-15T00:00:01Z".into()),
        )
        .unwrap();
        let result = spool.append(frame()).unwrap();
        let SpoolAppendResult::Staged(chunk) = result else {
            panic!("fixture chunk must be staged");
        };
        ledger.stage_chunk(&chunk).unwrap();
        let path = chunk.path.clone();
        drop(spool);
        (ledger, path)
    }

    fn frame() -> CapturedFrame {
        CapturedFrame {
            meta: AudioFrameMeta {
                session_id: SessionId(11),
                channel_id: ChannelId("mic".into()),
                source_kind: SourceKind::UserMic,
                sequence_start: 0,
                sample_count_per_channel: 4,
                sample_rate_hz: 48_000,
                channels: 1,
                channel_mask: Some(4),
                sample_format: SampleFormat::PcmI16,
                bits_per_sample: 16,
                valid_bits_per_sample: 16,
                block_align: 2,
                qpc_start_100ns: 10,
                qpc_end_100ns: 843,
                device_position: Some(0),
                flags: FrameFlags::default(),
                discontinuity: None,
            },
            payload: Arc::from(vec![7; 8]),
        }
    }

    #[test]
    fn restart_scan_finalizes_exact_staging_file() {
        let root = TempSpool::new();
        let (mut ledger, partial_path) = setup(&root);
        let report = RecoveryManager::new(
            &root.0,
            &mut ledger,
            Arc::new(|| "2026-08-15T00:00:02Z".into()),
        )
        .unwrap()
        .scan_session(SessionId(11))
        .unwrap();

        assert_eq!(report.recovered_chunks, 1);
        assert_eq!(report.incomplete_chunks, 0);
        assert!(!root.0.join(&partial_path).exists());
        assert!(
            root.0
                .join(partial_path.to_string_lossy().trim_end_matches(".partial"))
                .exists()
        );
        assert_eq!(ledger.channel_last_sequence("mic").unwrap(), Some(4));
        assert_eq!(ledger.recovery_scan_count().unwrap(), 1);
    }

    #[test]
    fn aligned_truncation_recovers_prefix_and_records_exact_gap() {
        let root = TempSpool::new();
        let (mut ledger, partial_path) = setup(&root);
        fs::OpenOptions::new()
            .write(true)
            .open(root.0.join(&partial_path))
            .unwrap()
            .set_len(4)
            .unwrap();
        let report = RecoveryManager::new(
            &root.0,
            &mut ledger,
            Arc::new(|| "2026-08-15T00:00:02Z".into()),
        )
        .unwrap()
        .scan_session(SessionId(11))
        .unwrap();

        assert_eq!(report.recovered_chunks, 1);
        assert_eq!(ledger.channel_last_sequence("mic").unwrap(), Some(2));
        assert_eq!(ledger.counts().unwrap(), (1, 1, 1, 1));
        assert_eq!(ledger.unknown_gap_count().unwrap(), 0);
    }

    #[test]
    fn partial_sample_is_preserved_and_marked_incomplete() {
        let root = TempSpool::new();
        let (mut ledger, partial_path) = setup(&root);
        fs::OpenOptions::new()
            .write(true)
            .open(root.0.join(&partial_path))
            .unwrap()
            .set_len(7)
            .unwrap();
        let report = RecoveryManager::new(
            &root.0,
            &mut ledger,
            Arc::new(|| "2026-08-15T00:00:02Z".into()),
        )
        .unwrap()
        .scan_session(SessionId(11))
        .unwrap();

        assert_eq!(report.recovered_chunks, 0);
        assert_eq!(report.incomplete_chunks, 1);
        assert!(root.0.join(partial_path).exists());
        assert_eq!(ledger.unknown_gap_count().unwrap(), 1);
    }

    #[test]
    fn missing_staging_file_is_quarantined_with_known_gap() {
        let root = TempSpool::new();
        let (mut ledger, partial_path) = setup(&root);
        fs::remove_file(root.0.join(&partial_path)).unwrap();
        let report = RecoveryManager::new(
            &root.0,
            &mut ledger,
            Arc::new(|| "2026-08-15T00:00:02Z".into()),
        )
        .unwrap()
        .scan_session(SessionId(11))
        .unwrap();

        assert_eq!(report.missing_chunks, 1);
        assert_eq!(report.incomplete_chunks, 1);
        assert_eq!(ledger.counts().unwrap(), (1, 1, 1, 1));
        assert_eq!(ledger.unknown_gap_count().unwrap(), 0);
    }

    #[test]
    fn orphan_raw_file_is_retained_and_reported_as_unknown_gap() {
        let root = TempSpool::new();
        let (mut ledger, _partial_path) = setup(&root);
        let orphan = root
            .0
            .join(SessionId(11).to_string())
            .join("channel-6d6963")
            .join("chunk-00000000000000000100.raw.partial");
        fs::write(&orphan, [1_u8, 2, 3, 4]).unwrap();
        let report = RecoveryManager::new(
            &root.0,
            &mut ledger,
            Arc::new(|| "2026-08-15T00:00:02Z".into()),
        )
        .unwrap()
        .scan_session(SessionId(11))
        .unwrap();

        assert_eq!(report.orphan_files, 1);
        assert!(orphan.exists());
        assert_eq!(ledger.unknown_gap_count().unwrap(), 1);
    }
}
