use std::{
    path::{Path, PathBuf},
    time::Duration,
};

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};

use crate::domain::{
    audio_frame::{ChannelId, SampleFormat, SessionId},
    ledger::{
        AudioChannel, AudioChunk, AudioChunkState, CaptureState, DeviceState, Gap, GapReason,
        LifecycleTransition, RecoveryState, Session,
    },
    ports::{AudioLedgerPort, CoreError},
};

use super::{
    AUDIO_LEDGER_MIGRATION_0001, LIFECYCLE_MIGRATION_0003, RAW_SPOOL_MIGRATION_0004,
    RECOVERY_MIGRATION_0005, SEGMENT_ASR_MIGRATION_0002,
};

const SCHEMA_VERSION: u32 = 5;
type ChannelResumeCursor = (u64, Option<u64>, Option<u64>);
type RegisteredChannelRow = (String, i64, i64, i64, Option<i64>, String, i64, i64, i64);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecoveryScanOutcome {
    pub recovered_chunks: u64,
    pub incomplete_chunks: u64,
    pub missing_chunks: u64,
    pub orphan_files: u64,
    pub restored_jobs: u64,
}

pub struct LedgerRepository {
    connection: Connection,
}

impl LedgerRepository {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, CoreError> {
        let connection = Connection::open(path).map_err(storage_error)?;
        let mut repository = Self { connection };
        repository.configure(true)?;
        repository.migrate()?;
        Ok(repository)
    }

    pub fn open_in_memory() -> Result<Self, CoreError> {
        let connection = Connection::open_in_memory().map_err(storage_error)?;
        let mut repository = Self { connection };
        repository.configure(false)?;
        repository.migrate()?;
        Ok(repository)
    }

    fn configure(&self, file_database: bool) -> Result<(), CoreError> {
        self.connection
            .pragma_update(None, "foreign_keys", true)
            .map_err(storage_error)?;
        self.connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(storage_error)?;
        if file_database {
            self.connection
                .execute_batch("PRAGMA journal_mode=WAL;")
                .map_err(storage_error)?;
        }
        // Ledger rows gate recovery and spool commit visibility. FULL WAL
        // synchronization makes each transaction survive a power loss before
        // the persistence worker exposes its result to recovery.
        self.connection
            .execute_batch(if file_database {
                "PRAGMA synchronous=FULL;"
            } else {
                "PRAGMA synchronous=NORMAL;"
            })
            .map_err(storage_error)?;
        Ok(())
    }

    fn migrate(&mut self) -> Result<(), CoreError> {
        let current = self.user_version()?;
        if current > SCHEMA_VERSION {
            return Err(CoreError::Storage(format!(
                "audio ledger schema {current} is newer than supported schema {SCHEMA_VERSION}"
            )));
        }

        let migrations = [
            (1_u32, AUDIO_LEDGER_MIGRATION_0001),
            (2_u32, SEGMENT_ASR_MIGRATION_0002),
            (3_u32, LIFECYCLE_MIGRATION_0003),
            (4_u32, RAW_SPOOL_MIGRATION_0004),
            (5_u32, RECOVERY_MIGRATION_0005),
        ];
        for (version, sql) in migrations {
            if version <= current {
                continue;
            }
            let transaction = self
                .connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(storage_error)?;
            transaction.execute_batch(sql).map_err(storage_error)?;
            transaction
                .pragma_update(None, "user_version", version)
                .map_err(storage_error)?;
            transaction.commit().map_err(storage_error)?;
        }
        Ok(())
    }

    pub fn create_session(&mut self, session: &Session) -> Result<(), CoreError> {
        session
            .validate()
            .map_err(|error| CoreError::InvalidState(error.into()))?;
        self.connection
            .execute(
                "INSERT INTO AudioSession(id,started_at_utc,ended_at_utc,app_version,schema_version,state,config_snapshot_json,recovery_state) VALUES(?,?,?,?,?,?,?,?)",
                params![
                    session.id.to_string(),
                    &session.started_at_utc,
                    session.ended_at_utc.as_deref(),
                    &session.app_version,
                    i64::from(session.schema_version),
                    session.capture_state.as_storage_str(),
                    &session.config_snapshot_json,
                    session.recovery_state.as_storage_str(),
                ],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    pub fn complete_session(
        &mut self,
        session_id: SessionId,
        ended_at_utc: &str,
    ) -> Result<(), CoreError> {
        let changed = self
            .connection
            .execute(
                "UPDATE AudioSession SET ended_at_utc=?,state='STOPPED' WHERE id=? AND ended_at_utc IS NULL",
                params![ended_at_utc, session_id.to_string()],
            )
            .map_err(storage_error)?;
        if changed != 1 {
            return Err(CoreError::InvalidState(
                "session is missing or already completed".into(),
            ));
        }
        Ok(())
    }

    pub fn register_channel(&mut self, channel: &AudioChannel) -> Result<(), CoreError> {
        channel
            .validate()
            .map_err(|error| CoreError::InvalidState(error.into()))?;
        let stored: Option<(String, String, i64)> = self
            .connection
            .query_row(
                "SELECT session_id,source_kind,last_sequence FROM AudioChannel WHERE id=?",
                [&channel.id.0],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(storage_error)?;
        if let Some((session_id, source_kind, last_sequence)) = stored {
            if session_id != channel.session_id.to_string()
                || source_kind != channel.source_kind.as_storage_str()
            {
                return Err(CoreError::InvalidState(
                    "channel id is already owned by a different session or source".into(),
                ));
            }
            if sqlite_to_u64(last_sequence, "channel last sequence")? > channel.last_sequence {
                return Err(CoreError::InvalidState(
                    "channel registration would regress durable sequence".into(),
                ));
            }
        }

        let sample_format = channel.sample_format.as_storage_value();
        self.connection
            .execute(
                "INSERT INTO AudioChannel(id,session_id,source_kind,device_id,device_generation,native_sample_rate,native_channels,channel_mask,state,sample_format,device_state,recovery_state,last_sequence,last_qpc_100ns,last_device_position,bits_per_sample,valid_bits_per_sample,block_align) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                 ON CONFLICT(id) DO UPDATE SET device_id=excluded.device_id,device_generation=excluded.device_generation,native_sample_rate=excluded.native_sample_rate,native_channels=excluded.native_channels,channel_mask=excluded.channel_mask,state=excluded.state,sample_format=excluded.sample_format,device_state=excluded.device_state,recovery_state=excluded.recovery_state,last_sequence=excluded.last_sequence,last_qpc_100ns=excluded.last_qpc_100ns,last_device_position=excluded.last_device_position,bits_per_sample=excluded.bits_per_sample,valid_bits_per_sample=excluded.valid_bits_per_sample,block_align=excluded.block_align",
                params![
                    &channel.id.0,
                    channel.session_id.to_string(),
                    channel.source_kind.as_storage_str(),
                    channel.device_id.as_deref(),
                    i64::from(channel.device_generation),
                    i64::from(channel.native_sample_rate),
                    i64::from(channel.native_channels),
                    channel.channel_mask.map(i64::from),
                    channel.capture_state.as_storage_str(),
                    sample_format,
                    channel.device_state.as_storage_str(),
                    channel.recovery_state.as_storage_str(),
                    sqlite_u64(channel.last_sequence, "channel last sequence")?,
                    sqlite_optional_u64(channel.last_qpc_100ns, "channel last QPC")?,
                    sqlite_optional_u64(
                        channel.last_device_position,
                        "channel last device position"
                    )?,
                    i64::from(channel.bits_per_sample),
                    i64::from(channel.valid_bits_per_sample),
                    i64::from(channel.block_align),
                ],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    pub fn stage_chunk(&mut self, chunk: &AudioChunk) -> Result<(), CoreError> {
        chunk
            .validate()
            .map_err(|error| CoreError::InvalidState(error.into()))?;
        if chunk.state != crate::domain::ledger::AudioChunkState::Staging {
            return Err(CoreError::InvalidState(
                "only staging chunks may be written as incomplete ledger rows".into(),
            ));
        }

        let registered: Option<RegisteredChannelRow> = self.connection
                .query_row(
                    "SELECT session_id,last_sequence,native_sample_rate,native_channels,channel_mask,sample_format,bits_per_sample,valid_bits_per_sample,block_align FROM AudioChannel WHERE id=?",
                    [&chunk.channel_id.0],
                    |row| {
                        Ok((
                            row.get(0)?,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                            row.get(4)?,
                            row.get(5)?,
                            row.get(6)?,
                            row.get(7)?,
                            row.get(8)?,
                        ))
                    },
                )
                .optional()
                .map_err(storage_error)?;
        let Some((
            session_id,
            previous,
            sample_rate,
            channels,
            channel_mask,
            sample_format,
            bits_per_sample,
            valid_bits_per_sample,
            block_align,
        )) = registered
        else {
            return Err(CoreError::InvalidState(
                "staging chunk channel is not registered".into(),
            ));
        };
        if session_id != chunk.session_id.to_string()
            || sample_rate != i64::from(chunk.sample_rate)
            || channels != i64::from(chunk.channels)
            || channel_mask != chunk.channel_mask.map(i64::from)
            || sample_format != chunk.sample_format.as_storage_value()
            || bits_per_sample != i64::from(chunk.bits_per_sample)
            || valid_bits_per_sample != i64::from(chunk.valid_bits_per_sample)
            || block_align != i64::from(chunk.block_align)
        {
            return Err(CoreError::InvalidState(
                "staging chunk does not match its registered channel".into(),
            ));
        }
        if chunk.seq_start < sqlite_to_u64(previous, "channel last sequence")? {
            return Err(CoreError::InvalidState(
                "staging chunk sequence regressed behind the durable ledger".into(),
            ));
        }

        let chunk_path = chunk.path.to_string_lossy().into_owned();
        let discontinuity = chunk.discontinuity.map(|reason| reason.as_storage_str());
        let changed = self
            .connection
            .execute(
                "INSERT INTO AudioChunk(id,session_id,channel_id,seq_start,seq_end,qpc_start,qpc_end,sample_rate,channels,format,path,byte_length,sha256,discontinuity,state,created_at,channel_mask,device_position_start,device_position_end,bits_per_sample,valid_bits_per_sample,block_align) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                 ON CONFLICT(id) DO UPDATE SET seq_end=excluded.seq_end,qpc_end=excluded.qpc_end,path=excluded.path,byte_length=excluded.byte_length,discontinuity=excluded.discontinuity,device_position_end=excluded.device_position_end
                 WHERE AudioChunk.state='STAGING' AND AudioChunk.session_id=excluded.session_id AND AudioChunk.channel_id=excluded.channel_id AND AudioChunk.seq_start=excluded.seq_start AND excluded.seq_end>=AudioChunk.seq_end",
                params![
                    &chunk.id,
                    chunk.session_id.to_string(),
                    &chunk.channel_id.0,
                    sqlite_u64(chunk.seq_start, "chunk sequence start")?,
                    sqlite_u64(chunk.seq_end, "chunk sequence end")?,
                    sqlite_u64(chunk.qpc_start_100ns, "chunk QPC start")?,
                    sqlite_u64(chunk.qpc_end_100ns, "chunk QPC end")?,
                    i64::from(chunk.sample_rate),
                    i64::from(chunk.channels),
                    chunk.sample_format.as_storage_value(),
                    chunk_path,
                    sqlite_u64(chunk.byte_length, "chunk byte length")?,
                    "",
                    discontinuity,
                    chunk.state.as_storage_str(),
                    &chunk.created_at_utc,
                    chunk.channel_mask.map(i64::from),
                    sqlite_optional_u64(chunk.device_position_start, "chunk device-position start")?,
                    sqlite_optional_u64(chunk.device_position_end, "chunk device-position end")?,
                    i64::from(chunk.bits_per_sample),
                    i64::from(chunk.valid_bits_per_sample),
                    i64::from(chunk.block_align),
                ],
            )
            .map_err(storage_error)?;
        if changed != 1 {
            return Err(CoreError::InvalidState(
                "staging chunk identity or sequence conflicts with an existing ledger row".into(),
            ));
        }
        Ok(())
    }

    pub fn commit_chunk(
        &mut self,
        chunk: &AudioChunk,
        preceding_gap: Option<&Gap>,
    ) -> Result<(), CoreError> {
        chunk
            .validate_for_commit()
            .map_err(|error| CoreError::InvalidState(error.into()))?;
        if let Some(gap) = preceding_gap {
            validate_gap_for_chunk(gap, chunk)?;
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage_error)?;
        let registered: Option<RegisteredChannelRow> = transaction
            .query_row(
                "SELECT session_id,last_sequence,native_sample_rate,native_channels,channel_mask,sample_format,bits_per_sample,valid_bits_per_sample,block_align FROM AudioChannel WHERE id=?",
                [&chunk.channel_id.0],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                        row.get(8)?,
                    ))
                },
            )
            .optional()
            .map_err(storage_error)?;
        let Some((
            session_id,
            previous,
            sample_rate,
            channels,
            channel_mask,
            sample_format,
            bits_per_sample,
            valid_bits_per_sample,
            block_align,
        )) = registered
        else {
            return Err(CoreError::InvalidState(
                "chunk channel is not registered".into(),
            ));
        };
        if session_id != chunk.session_id.to_string() {
            return Err(CoreError::InvalidState(
                "chunk session does not own the registered channel".into(),
            ));
        }
        let chunk_sample_format = chunk.sample_format.as_storage_value();
        if sample_rate != i64::from(chunk.sample_rate)
            || channels != i64::from(chunk.channels)
            || channel_mask != chunk.channel_mask.map(i64::from)
            || sample_format != chunk_sample_format
            || bits_per_sample != i64::from(chunk.bits_per_sample)
            || valid_bits_per_sample != i64::from(chunk.valid_bits_per_sample)
            || block_align != i64::from(chunk.block_align)
        {
            return Err(CoreError::InvalidState(
                "chunk format does not match registered channel format".into(),
            ));
        }

        let previous = sqlite_to_u64(previous, "channel last sequence")?;
        if chunk.seq_start < previous {
            return Err(CoreError::InvalidState(format!(
                "chunk sequence regressed: previous={previous}, observed={}",
                chunk.seq_start
            )));
        }
        let durable_gap_exists = |sequence_start: u64,
                                  sequence_end: Option<u64>,
                                  reason: Option<&str>|
         -> Result<bool, CoreError> {
            let count: i64 = transaction
                .query_row(
                    "SELECT COUNT(*) FROM Gap WHERE session_id=? AND channel_id=? AND seq_start=? AND ((? IS NOT NULL AND extent_known=1 AND seq_end=?) OR (? IS NULL AND reason=?))",
                    params![
                        chunk.session_id.to_string(),
                        &chunk.channel_id.0,
                        sqlite_u64(sequence_start, "gap sequence start")?,
                        sequence_end.map(|value| sqlite_u64(value, "gap sequence end")).transpose()?,
                        sequence_end.map(|value| sqlite_u64(value, "gap sequence end")).transpose()?,
                        sequence_end,
                        reason,
                    ],
                    |row| row.get(0),
                )
                .map_err(storage_error)?;
            Ok(count > 0)
        };
        let previously_recorded_jump = chunk.seq_start > previous
            && durable_gap_exists(previous, Some(chunk.seq_start), None)?;
        let previously_recorded_discontinuity = if let Some(reason) = chunk.discontinuity {
            durable_gap_exists(chunk.seq_start, None, Some(reason.as_storage_str()))?
        } else {
            false
        };

        match (chunk.seq_start.cmp(&previous), preceding_gap) {
            (std::cmp::Ordering::Greater, Some(gap))
                if gap.exactly_covers(previous, chunk.seq_start) => {}
            (std::cmp::Ordering::Greater, None) if previously_recorded_jump => {}
            (std::cmp::Ordering::Greater, _) => {
                return Err(CoreError::InvalidState(format!(
                    "chunk sequence jumped from {previous} to {} without an exact gap",
                    chunk.seq_start
                )));
            }
            (std::cmp::Ordering::Equal, Some(gap)) if gap.seq_end.is_some() => {
                return Err(CoreError::InvalidState(
                    "known gap cannot precede a contiguous chunk".into(),
                ));
            }
            _ => {}
        }

        if chunk.discontinuity.is_some()
            && preceding_gap.is_none()
            && !previously_recorded_discontinuity
            && !previously_recorded_jump
        {
            return Err(CoreError::InvalidState(
                "chunk discontinuity requires an explicit gap record".into(),
            ));
        }

        if let Some(gap) = preceding_gap {
            insert_gap(&transaction, gap)?;
        }
        let chunk_path = chunk.path.to_string_lossy().into_owned();
        let discontinuity = chunk.discontinuity.map(|reason| reason.as_storage_str());
        let existing: Option<(String, String, i64, i64, String)> = transaction
            .query_row(
                "SELECT session_id,channel_id,seq_start,seq_end,state FROM AudioChunk WHERE id=?",
                [&chunk.id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .optional()
            .map_err(storage_error)?;
        if let Some((
            existing_session,
            existing_channel,
            existing_start,
            existing_end,
            existing_state,
        )) = existing
        {
            if existing_session != chunk.session_id.to_string()
                || existing_channel != chunk.channel_id.0
                || sqlite_to_u64(existing_start, "staging sequence start")? != chunk.seq_start
                || sqlite_to_u64(existing_end, "staging sequence end")? > chunk.seq_end
                || existing_state != "STAGING"
            {
                return Err(CoreError::InvalidState(
                    "finalized chunk conflicts with an existing ledger row".into(),
                ));
            }
            transaction
                .execute(
                    "UPDATE AudioChunk SET seq_end=?,qpc_end=?,path=?,byte_length=?,sha256=?,discontinuity=?,state=?,device_position_end=? WHERE id=? AND state='STAGING'",
                    params![
                        sqlite_u64(chunk.seq_end, "chunk sequence end")?,
                        sqlite_u64(chunk.qpc_end_100ns, "chunk QPC end")?,
                        chunk_path,
                        sqlite_u64(chunk.byte_length, "chunk byte length")?,
                        &chunk.sha256_hex,
                        discontinuity,
                        chunk.state.as_storage_str(),
                        sqlite_optional_u64(chunk.device_position_end, "chunk device-position end")?,
                        &chunk.id,
                    ],
                )
                .map_err(storage_error)?;
        } else {
            transaction
                .execute(
                "INSERT INTO AudioChunk(id,session_id,channel_id,seq_start,seq_end,qpc_start,qpc_end,sample_rate,channels,format,path,byte_length,sha256,discontinuity,state,created_at,channel_mask,device_position_start,device_position_end,bits_per_sample,valid_bits_per_sample,block_align) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                params![
                    &chunk.id,
                    chunk.session_id.to_string(),
                    &chunk.channel_id.0,
                    sqlite_u64(chunk.seq_start, "chunk sequence start")?,
                    sqlite_u64(chunk.seq_end, "chunk sequence end")?,
                    sqlite_u64(chunk.qpc_start_100ns, "chunk QPC start")?,
                    sqlite_u64(chunk.qpc_end_100ns, "chunk QPC end")?,
                    i64::from(chunk.sample_rate),
                    i64::from(chunk.channels),
                    chunk_sample_format,
                    chunk_path,
                    sqlite_u64(chunk.byte_length, "chunk byte length")?,
                    &chunk.sha256_hex,
                    discontinuity,
                    chunk.state.as_storage_str(),
                    &chunk.created_at_utc,
                    chunk.channel_mask.map(i64::from),
                    sqlite_optional_u64(
                        chunk.device_position_start,
                        "chunk device-position start"
                    )?,
                    sqlite_optional_u64(
                        chunk.device_position_end,
                        "chunk device-position end"
                    )?,
                    i64::from(chunk.bits_per_sample),
                    i64::from(chunk.valid_bits_per_sample),
                    i64::from(chunk.block_align),
                ],
                )
                .map_err(storage_error)?;
        }
        transaction
            .execute(
                "UPDATE AudioChannel SET last_sequence=?,last_qpc_100ns=?,last_device_position=? WHERE id=?",
                params![
                    sqlite_u64(chunk.seq_end, "chunk sequence end")?,
                    sqlite_u64(chunk.qpc_end_100ns, "chunk QPC end")?,
                    sqlite_optional_u64(
                        chunk.device_position_end,
                        "chunk device-position end"
                    )?,
                    &chunk.channel_id.0,
                ],
            )
            .map_err(storage_error)?;
        transaction.commit().map_err(storage_error)?;
        Ok(())
    }

    pub fn record_gap(&mut self, gap: &Gap) -> Result<(), CoreError> {
        gap.validate()
            .map_err(|error| CoreError::InvalidState(error.into()))?;
        insert_gap(&self.connection, gap)
    }

    pub fn record_lifecycle(&mut self, transition: &LifecycleTransition) -> Result<(), CoreError> {
        transition
            .validate()
            .map_err(|error| CoreError::InvalidState(error.into()))?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage_error)?;

        if let Some(channel_id) = &transition.channel_id {
            let stored: Option<(String, String, String, String)> = transaction
                .query_row(
                    "SELECT session_id,state,device_state,recovery_state FROM AudioChannel WHERE id=?",
                    [&channel_id.0],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .optional()
                .map_err(storage_error)?;
            let Some((session_id, capture_state, device_state, recovery_state)) = stored else {
                return Err(CoreError::InvalidState(
                    "lifecycle channel is not registered".into(),
                ));
            };
            if session_id != transition.session_id.to_string()
                || capture_state != transition.previous_capture_state.as_storage_str()
                || device_state != transition.previous_device_state.as_storage_str()
                || recovery_state != transition.previous_recovery_state.as_storage_str()
            {
                return Err(CoreError::InvalidState(
                    "lifecycle transition is stale or belongs to another session".into(),
                ));
            }
            transaction
                .execute(
                    "UPDATE AudioChannel SET state=?,device_state=?,recovery_state=? WHERE id=?",
                    params![
                        transition.capture_state.as_storage_str(),
                        transition.device_state.as_storage_str(),
                        transition.recovery_state.as_storage_str(),
                        &channel_id.0,
                    ],
                )
                .map_err(storage_error)?;
        } else {
            let stored: Option<(String, String)> = transaction
                .query_row(
                    "SELECT state,recovery_state FROM AudioSession WHERE id=?",
                    [transition.session_id.to_string()],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(storage_error)?;
            let Some((capture_state, recovery_state)) = stored else {
                return Err(CoreError::InvalidState(
                    "lifecycle session is not registered".into(),
                ));
            };
            if capture_state != transition.previous_capture_state.as_storage_str()
                || recovery_state != transition.previous_recovery_state.as_storage_str()
            {
                return Err(CoreError::InvalidState(
                    "session lifecycle transition is stale".into(),
                ));
            }
            transaction
                .execute(
                    "UPDATE AudioSession SET state=?,recovery_state=? WHERE id=?",
                    params![
                        transition.capture_state.as_storage_str(),
                        transition.recovery_state.as_storage_str(),
                        transition.session_id.to_string(),
                    ],
                )
                .map_err(storage_error)?;
        }

        transaction
            .execute(
                "INSERT INTO LifecycleTransition(session_id,channel_id,previous_capture_state,capture_state,previous_device_state,device_state,previous_recovery_state,recovery_state,detail_json,occurred_at_utc) VALUES(?,?,?,?,?,?,?,?,?,?)",
                params![
                    transition.session_id.to_string(),
                    transition.channel_id.as_ref().map(|id| id.0.as_str()),
                    transition.previous_capture_state.as_storage_str(),
                    transition.capture_state.as_storage_str(),
                    transition.previous_device_state.as_storage_str(),
                    transition.device_state.as_storage_str(),
                    transition.previous_recovery_state.as_storage_str(),
                    transition.recovery_state.as_storage_str(),
                    &transition.detail_json,
                    &transition.occurred_at_utc,
                ],
            )
            .map_err(storage_error)?;
        transaction.commit().map_err(storage_error)?;
        Ok(())
    }

    pub fn begin_recovery_scan(
        &mut self,
        session_id: SessionId,
        started_at_utc: &str,
    ) -> Result<i64, CoreError> {
        if started_at_utc.trim().is_empty() {
            return Err(CoreError::InvalidState(
                "recovery scan timestamp is required".into(),
            ));
        }
        self.connection
            .execute(
                "INSERT INTO RecoveryScan(session_id,state,started_at,detail_json) VALUES(?,'SCANNING',?,?)",
                params![
                    session_id.to_string(),
                    started_at_utc,
                    "{\"event\":\"startup-ledger-scan\"}",
                ],
            )
            .map_err(storage_error)?;
        Ok(self.connection.last_insert_rowid())
    }

    pub fn recovery_chunks(&self, session_id: SessionId) -> Result<Vec<AudioChunk>, CoreError> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT id,session_id,channel_id,seq_start,seq_end,qpc_start,qpc_end,sample_rate,channels,format,path,byte_length,sha256,discontinuity,state,created_at,channel_mask,device_position_start,device_position_end,bits_per_sample,valid_bits_per_sample,block_align
                 FROM AudioChunk WHERE session_id=? AND state!='FINALIZED' ORDER BY channel_id,seq_start,id",
            )
            .map_err(storage_error)?;
        let mut rows = statement
            .query([session_id.to_string()])
            .map_err(storage_error)?;
        let mut chunks = Vec::new();
        while let Some(row) = rows.next().map_err(storage_error)? {
            let stored_session: String = row.get(1).map_err(storage_error)?;
            let stored_format: String = row.get(9).map_err(storage_error)?;
            let stored_discontinuity: Option<String> = row.get(13).map_err(storage_error)?;
            let stored_state: String = row.get(14).map_err(storage_error)?;
            let chunk = AudioChunk {
                id: row.get(0).map_err(storage_error)?,
                session_id: stored_session.parse::<SessionId>().map_err(|_| {
                    CoreError::Storage("invalid session id in recovery chunk".into())
                })?,
                channel_id: ChannelId(row.get(2).map_err(storage_error)?),
                seq_start: sqlite_to_u64(row.get(3).map_err(storage_error)?, "chunk start")?,
                seq_end: sqlite_to_u64(row.get(4).map_err(storage_error)?, "chunk end")?,
                qpc_start_100ns: sqlite_to_u64(
                    row.get(5).map_err(storage_error)?,
                    "chunk QPC start",
                )?,
                qpc_end_100ns: sqlite_to_u64(row.get(6).map_err(storage_error)?, "chunk QPC end")?,
                sample_rate: sqlite_to_u32(
                    row.get(7).map_err(storage_error)?,
                    "chunk sample rate",
                )?,
                channels: sqlite_to_u16(row.get(8).map_err(storage_error)?, "chunk channels")?,
                sample_format: SampleFormat::from_storage_value(&stored_format)
                    .map_err(|error| CoreError::Storage(error.into()))?,
                path: PathBuf::from(row.get::<_, String>(10).map_err(storage_error)?),
                byte_length: sqlite_to_u64(
                    row.get(11).map_err(storage_error)?,
                    "chunk byte length",
                )?,
                sha256_hex: row.get(12).map_err(storage_error)?,
                discontinuity: stored_discontinuity
                    .as_deref()
                    .map(GapReason::from_storage_str)
                    .transpose()
                    .map_err(|error| CoreError::Storage(error.into()))?,
                state: AudioChunkState::from_storage_str(&stored_state)
                    .map_err(|error| CoreError::Storage(error.into()))?,
                created_at_utc: row.get(15).map_err(storage_error)?,
                channel_mask: sqlite_optional_to_u32(
                    row.get(16).map_err(storage_error)?,
                    "chunk channel mask",
                )?,
                device_position_start: sqlite_optional_to_u64(
                    row.get(17).map_err(storage_error)?,
                    "chunk device-position start",
                )?,
                device_position_end: sqlite_optional_to_u64(
                    row.get(18).map_err(storage_error)?,
                    "chunk device-position end",
                )?,
                bits_per_sample: sqlite_to_u16(
                    row.get(19).map_err(storage_error)?,
                    "chunk bits per sample",
                )?,
                valid_bits_per_sample: sqlite_to_u16(
                    row.get(20).map_err(storage_error)?,
                    "chunk valid bits per sample",
                )?,
                block_align: sqlite_to_u16(
                    row.get(21).map_err(storage_error)?,
                    "chunk block alignment",
                )?,
            };
            chunk
                .validate()
                .map_err(|error| CoreError::Storage(format!("invalid recovery chunk: {error}")))?;
            chunks.push(chunk);
        }
        Ok(chunks)
    }

    pub fn prepare_staging_recovery(&mut self, chunk: &AudioChunk) -> Result<(), CoreError> {
        chunk
            .validate_for_commit()
            .map_err(|error| CoreError::InvalidState(error.into()))?;
        let changed = self
            .connection
            .execute(
                "UPDATE AudioChunk SET seq_end=?,qpc_end=?,path=?,byte_length=?,device_position_end=? WHERE id=? AND session_id=? AND channel_id=? AND seq_start=? AND state='STAGING'",
                params![
                    sqlite_u64(chunk.seq_end, "recovered chunk end")?,
                    sqlite_u64(chunk.qpc_end_100ns, "recovered chunk QPC end")?,
                    chunk.path.to_string_lossy().into_owned(),
                    sqlite_u64(chunk.byte_length, "recovered chunk byte length")?,
                    sqlite_optional_u64(
                        chunk.device_position_end,
                        "recovered chunk device-position end"
                    )?,
                    &chunk.id,
                    chunk.session_id.to_string(),
                    &chunk.channel_id.0,
                    sqlite_u64(chunk.seq_start, "recovered chunk start")?,
                ],
            )
            .map_err(storage_error)?;
        if changed != 1 {
            return Err(CoreError::InvalidState(
                "recovery chunk is not an owned staging row".into(),
            ));
        }
        Ok(())
    }

    pub fn mark_chunk_recovery_state(
        &mut self,
        chunk_id: &str,
        state: AudioChunkState,
    ) -> Result<(), CoreError> {
        if !matches!(
            state,
            AudioChunkState::Incomplete | AudioChunkState::Quarantined
        ) {
            return Err(CoreError::InvalidState(
                "recovery may only mark incomplete or quarantined chunks".into(),
            ));
        }
        let changed = self
            .connection
            .execute(
                "UPDATE AudioChunk SET state=? WHERE id=? AND state!='FINALIZED'",
                params![state.as_storage_str(), chunk_id],
            )
            .map_err(storage_error)?;
        if changed != 1 {
            return Err(CoreError::InvalidState(
                "recovery chunk is missing or already finalized".into(),
            ));
        }
        Ok(())
    }

    pub fn record_recovery_artifact(
        &mut self,
        scan_id: i64,
        chunk_id: Option<&str>,
        path: &Path,
        disposition: &str,
        observed_byte_length: Option<u64>,
        detail_json: &str,
    ) -> Result<(), CoreError> {
        serde_json::from_str::<serde_json::Value>(detail_json).map_err(|_| {
            CoreError::InvalidState("recovery artifact detail must be valid JSON".into())
        })?;
        self.connection
            .execute(
                "INSERT INTO RecoveryArtifact(scan_id,chunk_id,path,disposition,observed_byte_length,detail_json) VALUES(?,?,?,?,?,?)",
                params![
                    scan_id,
                    chunk_id,
                    path.to_string_lossy().into_owned(),
                    disposition,
                    observed_byte_length
                        .map(|value| sqlite_u64(value, "recovery artifact byte length"))
                        .transpose()?,
                    detail_json,
                ],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    pub fn restore_recoverable_jobs(&mut self, now_utc: &str) -> Result<u64, CoreError> {
        let changed = self
            .connection
            .execute(
                "UPDATE AsrJob SET status='PENDING',lease_until=NULL,updated_at=? WHERE status IN ('RUNNING','LEASED') AND (lease_until IS NULL OR lease_until<=?)",
                params![now_utc, now_utc],
            )
            .map_err(storage_error)?;
        u64::try_from(changed)
            .map_err(|_| CoreError::Storage("restored job count overflowed".into()))
    }

    pub fn channel_exists(
        &self,
        session_id: SessionId,
        channel_id: &ChannelId,
    ) -> Result<bool, CoreError> {
        let count: i64 = self
            .connection
            .query_row(
                "SELECT COUNT(*) FROM AudioChannel WHERE session_id=? AND id=?",
                params![session_id.to_string(), &channel_id.0],
                |row| row.get(0),
            )
            .map_err(storage_error)?;
        Ok(count > 0)
    }

    pub fn complete_recovery_scan(
        &mut self,
        scan_id: i64,
        completed_at_utc: &str,
        outcome: RecoveryScanOutcome,
    ) -> Result<(), CoreError> {
        let state = if outcome.incomplete_chunks == 0 && outcome.orphan_files == 0 {
            "RECOVERED"
        } else {
            "RECOVERABLE"
        };
        let detail = serde_json::json!({
            "recovered_chunks": outcome.recovered_chunks,
            "incomplete_chunks": outcome.incomplete_chunks,
            "missing_chunks": outcome.missing_chunks,
            "orphan_files": outcome.orphan_files,
            "restored_jobs": outcome.restored_jobs,
        })
        .to_string();
        let changed = self
            .connection
            .execute(
                "UPDATE RecoveryScan SET state=?,completed_at=?,recovered_chunks=?,incomplete_chunks=?,missing_chunks=?,orphan_files=?,restored_jobs=?,detail_json=? WHERE id=? AND state='SCANNING'",
                params![
                    state,
                    completed_at_utc,
                    sqlite_u64(outcome.recovered_chunks, "recovered chunk count")?,
                    sqlite_u64(outcome.incomplete_chunks, "incomplete chunk count")?,
                    sqlite_u64(outcome.missing_chunks, "missing chunk count")?,
                    sqlite_u64(outcome.orphan_files, "orphan file count")?,
                    sqlite_u64(outcome.restored_jobs, "restored job count")?,
                    detail,
                    scan_id,
                ],
            )
            .map_err(storage_error)?;
        if changed != 1 {
            return Err(CoreError::InvalidState(
                "recovery scan is missing or already completed".into(),
            ));
        }
        Ok(())
    }

    pub fn recovery_scan_count(&self) -> Result<u64, CoreError> {
        let value: i64 = self
            .connection
            .query_row("SELECT COUNT(*) FROM RecoveryScan", [], |row| row.get(0))
            .map_err(storage_error)?;
        sqlite_to_u64(value, "recovery scan count")
    }

    pub fn counts(&self) -> Result<(u64, u64, u64, u64), CoreError> {
        let query = |table: &str| -> Result<u64, CoreError> {
            let sql = format!("SELECT COUNT(*) FROM {table}");
            let count: i64 = self
                .connection
                .query_row(&sql, [], |row| row.get(0))
                .map_err(storage_error)?;
            sqlite_to_u64(count, "row count")
        };
        Ok((
            query("AudioSession")?,
            query("AudioChannel")?,
            query("AudioChunk")?,
            query("Gap")?,
        ))
    }

    pub fn channel_last_sequence(&self, channel_id: &str) -> Result<Option<u64>, CoreError> {
        let value: Option<i64> = self
            .connection
            .query_row(
                "SELECT last_sequence FROM AudioChannel WHERE id=?",
                [channel_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(storage_error)?;
        value
            .map(|sequence| sqlite_to_u64(sequence, "channel last sequence"))
            .transpose()
    }

    pub fn channel_resume_cursor(
        &self,
        channel_id: &str,
    ) -> Result<Option<ChannelResumeCursor>, CoreError> {
        let value: Option<(i64, Option<i64>, Option<i64>)> = self
            .connection
            .query_row(
                "SELECT last_sequence,last_qpc_100ns,last_device_position FROM AudioChannel WHERE id=?",
                [channel_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(storage_error)?;
        value
            .map(|(sequence, qpc, device_position)| {
                Ok((
                    sqlite_to_u64(sequence, "channel resume sequence")?,
                    sqlite_optional_to_u64(qpc, "channel resume QPC")?,
                    sqlite_optional_to_u64(device_position, "channel resume device position")?,
                ))
            })
            .transpose()
    }

    pub fn channel_lifecycle_state(
        &self,
        channel_id: &str,
    ) -> Result<Option<(CaptureState, DeviceState, RecoveryState)>, CoreError> {
        let value: Option<(String, String, String)> = self
            .connection
            .query_row(
                "SELECT state,device_state,recovery_state FROM AudioChannel WHERE id=?",
                [channel_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(storage_error)?;
        value
            .map(|(capture, device, recovery)| {
                Ok((
                    CaptureState::from_storage_str(&capture)
                        .map_err(|error| CoreError::Storage(error.into()))?,
                    DeviceState::from_storage_str(&device)
                        .map_err(|error| CoreError::Storage(error.into()))?,
                    RecoveryState::from_storage_str(&recovery)
                        .map_err(|error| CoreError::Storage(error.into()))?,
                ))
            })
            .transpose()
    }

    pub fn resolve_gap_extent(
        &mut self,
        gap_id: &str,
        seq_end: u64,
        resolved_at_utc: &str,
    ) -> Result<(), CoreError> {
        let stored_start: Option<i64> = self
            .connection
            .query_row(
                "SELECT seq_start FROM Gap WHERE id=? AND extent_known=0",
                [gap_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(storage_error)?;
        let Some(stored_start) = stored_start else {
            return Err(CoreError::InvalidState(
                "unknown-extent gap is missing or already resolved".into(),
            ));
        };
        let seq_start = sqlite_to_u64(stored_start, "gap sequence start")?;
        if seq_end <= seq_start {
            return Err(CoreError::InvalidState(
                "resolved gap extent must be non-empty".into(),
            ));
        }
        self.connection
            .execute(
                "UPDATE Gap SET seq_end=?,extent_known=1,status='EXPLAINED',resolved_at=? WHERE id=? AND extent_known=0",
                params![
                    sqlite_u64(seq_end, "resolved gap sequence end")?,
                    resolved_at_utc,
                    gap_id,
                ],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    pub fn first_chunk_start_after(
        &self,
        channel_id: &str,
        sequence: u64,
    ) -> Result<Option<u64>, CoreError> {
        let value: Option<i64> = self
            .connection
            .query_row(
                "SELECT MIN(seq_start) FROM AudioChunk WHERE channel_id=? AND seq_start>?",
                params![
                    channel_id,
                    sqlite_u64(sequence, "chunk sequence threshold")?,
                ],
                |row| row.get(0),
            )
            .map_err(storage_error)?;
        value
            .map(|value| sqlite_to_u64(value, "first resumed chunk sequence"))
            .transpose()
    }

    pub fn unknown_gap_count(&self) -> Result<u64, CoreError> {
        let value: i64 = self
            .connection
            .query_row("SELECT COUNT(*) FROM Gap WHERE extent_known=0", [], |row| {
                row.get(0)
            })
            .map_err(storage_error)?;
        sqlite_to_u64(value, "unknown gap count")
    }

    pub fn journal_mode(&self) -> Result<String, CoreError> {
        self.connection
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .map_err(storage_error)
    }

    pub fn user_version(&self) -> Result<u32, CoreError> {
        self.connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(storage_error)
    }
}

impl AudioLedgerPort for LedgerRepository {
    fn create_session(&mut self, session: &Session) -> Result<(), CoreError> {
        Self::create_session(self, session)
    }

    fn register_channel(&mut self, channel: &AudioChannel) -> Result<(), CoreError> {
        Self::register_channel(self, channel)
    }

    fn stage_chunk(&mut self, chunk: &AudioChunk) -> Result<(), CoreError> {
        Self::stage_chunk(self, chunk)
    }

    fn commit_chunk(
        &mut self,
        chunk: &AudioChunk,
        preceding_gap: Option<&Gap>,
    ) -> Result<(), CoreError> {
        Self::commit_chunk(self, chunk, preceding_gap)
    }

    fn record_gap(&mut self, gap: &Gap) -> Result<(), CoreError> {
        Self::record_gap(self, gap)
    }

    fn record_lifecycle(&mut self, transition: &LifecycleTransition) -> Result<(), CoreError> {
        Self::record_lifecycle(self, transition)
    }
}

fn validate_gap_for_chunk(gap: &Gap, chunk: &AudioChunk) -> Result<(), CoreError> {
    gap.validate()
        .map_err(|error| CoreError::InvalidState(error.into()))?;
    if gap.session_id != chunk.session_id || gap.channel_id != chunk.channel_id {
        return Err(CoreError::InvalidState(
            "gap and chunk must belong to the same session channel".into(),
        ));
    }
    if let Some(reason) = chunk.discontinuity
        && gap.reason != reason
    {
        return Err(CoreError::InvalidState(
            "chunk discontinuity and gap reason differ".into(),
        ));
    }
    Ok(())
}

fn insert_gap(connection: &Connection, gap: &Gap) -> Result<(), CoreError> {
    let stored_end = gap.seq_end.unwrap_or(gap.seq_start);
    connection
        .execute(
            "INSERT INTO Gap(id,session_id,channel_id,seq_start,seq_end,reason,detail_json,attempts,retry_at,status,created_at,resolved_at,extent_known,qpc_detected_100ns,expected_device_position,observed_device_position) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            params![
                &gap.id,
                gap.session_id.to_string(),
                &gap.channel_id.0,
                sqlite_u64(gap.seq_start, "gap sequence start")?,
                sqlite_u64(stored_end, "gap sequence end")?,
                gap.reason.as_storage_str(),
                &gap.detail_json,
                i64::from(gap.attempts),
                gap.retry_at_utc.as_deref(),
                gap.status.as_storage_str(),
                &gap.created_at_utc,
                gap.resolved_at_utc.as_deref(),
                i64::from(gap.is_extent_known()),
                sqlite_optional_u64(gap.qpc_detected_100ns, "gap QPC")?,
                sqlite_optional_u64(
                    gap.expected_device_position,
                    "gap expected device position"
                )?,
                sqlite_optional_u64(
                    gap.observed_device_position,
                    "gap observed device position"
                )?,
            ],
        )
        .map_err(storage_error)?;
    Ok(())
}

fn sqlite_u64(value: u64, label: &str) -> Result<i64, CoreError> {
    i64::try_from(value)
        .map_err(|_| CoreError::Storage(format!("{label} exceeds SQLite INTEGER range")))
}

fn sqlite_optional_u64(value: Option<u64>, label: &str) -> Result<Option<i64>, CoreError> {
    value.map(|value| sqlite_u64(value, label)).transpose()
}

fn sqlite_to_u64(value: i64, label: &str) -> Result<u64, CoreError> {
    u64::try_from(value).map_err(|_| CoreError::Storage(format!("{label} is negative")))
}

fn sqlite_optional_to_u64(value: Option<i64>, label: &str) -> Result<Option<u64>, CoreError> {
    value.map(|value| sqlite_to_u64(value, label)).transpose()
}

fn sqlite_to_u32(value: i64, label: &str) -> Result<u32, CoreError> {
    u32::try_from(value)
        .map_err(|_| CoreError::Storage(format!("{label} is outside the u32 range")))
}

fn sqlite_optional_to_u32(value: Option<i64>, label: &str) -> Result<Option<u32>, CoreError> {
    value.map(|value| sqlite_to_u32(value, label)).transpose()
}

fn sqlite_to_u16(value: i64, label: &str) -> Result<u16, CoreError> {
    u16::try_from(value)
        .map_err(|_| CoreError::Storage(format!("{label} is outside the u16 range")))
}

fn storage_error(error: rusqlite::Error) -> CoreError {
    CoreError::Storage(error.to_string())
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    use crate::domain::{
        audio_frame::{ChannelId, SampleFormat, SessionId},
        ledger::{
            AudioChannel, AudioChunk, AudioChunkState, CaptureState, DeviceState, Gap, GapReason,
            GapStatus, RecoveryState, SourceKind,
        },
    };

    use super::*;

    static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn session() -> Session {
        Session {
            id: SessionId(1),
            started_at_utc: "2026-08-14T00:00:00Z".into(),
            ended_at_utc: None,
            app_version: "0.12.0-test".into(),
            schema_version: SCHEMA_VERSION,
            capture_state: CaptureState::Starting,
            recovery_state: RecoveryState::Clean,
            config_snapshot_json: "{}".into(),
        }
    }

    fn channel() -> AudioChannel {
        AudioChannel {
            id: ChannelId("session-1-user-mic".into()),
            session_id: SessionId(1),
            source_kind: SourceKind::UserMic,
            device_id: Some("fixture-device".into()),
            device_generation: 2,
            native_sample_rate: 48_000,
            native_channels: 2,
            channel_mask: Some(3),
            sample_format: SampleFormat::Float32,
            bits_per_sample: 32,
            valid_bits_per_sample: 32,
            block_align: 8,
            capture_state: CaptureState::Capturing,
            device_state: DeviceState::Available,
            recovery_state: RecoveryState::Clean,
            last_sequence: 0,
            last_qpc_100ns: None,
            last_device_position: None,
        }
    }

    fn chunk(id: &str, start: u64, end: u64) -> AudioChunk {
        AudioChunk {
            id: id.into(),
            session_id: SessionId(1),
            channel_id: ChannelId("session-1-user-mic".into()),
            seq_start: start,
            seq_end: end,
            qpc_start_100ns: start * 100,
            qpc_end_100ns: end * 100,
            device_position_start: Some(start),
            device_position_end: Some(end),
            sample_rate: 48_000,
            channels: 2,
            channel_mask: Some(3),
            sample_format: SampleFormat::Float32,
            bits_per_sample: 32,
            valid_bits_per_sample: 32,
            block_align: 8,
            path: PathBuf::from(format!("session-1/user-mic/{id}.raw")),
            byte_length: (end - start) * 8,
            sha256_hex: "a".repeat(64),
            discontinuity: None,
            state: AudioChunkState::Finalized,
            created_at_utc: "2026-08-14T00:00:01Z".into(),
        }
    }

    fn gap(id: &str, start: u64, end: Option<u64>) -> Gap {
        Gap {
            id: id.into(),
            session_id: SessionId(1),
            channel_id: ChannelId("session-1-user-mic".into()),
            seq_start: start,
            seq_end: end,
            qpc_detected_100ns: Some(start * 100),
            expected_device_position: Some(start),
            observed_device_position: end,
            reason: GapReason::QueueOverflow,
            detail_json: "{\"fixture\":true}".into(),
            attempts: 0,
            retry_at_utc: None,
            status: GapStatus::Open,
            created_at_utc: "2026-08-14T00:00:02Z".into(),
            resolved_at_utc: None,
        }
    }

    #[test]
    fn migrations_and_ledger_round_trip_enforce_monotonic_chunks() {
        let mut repository = LedgerRepository::open_in_memory().unwrap();
        assert_eq!(repository.user_version().unwrap(), SCHEMA_VERSION);
        repository.create_session(&session()).unwrap();
        repository.register_channel(&channel()).unwrap();
        repository
            .commit_chunk(&chunk("chunk-1", 0, 480), None)
            .unwrap();
        assert_eq!(
            repository
                .channel_last_sequence("session-1-user-mic")
                .unwrap(),
            Some(480)
        );
        let error = repository
            .commit_chunk(&chunk("chunk-2", 240, 720), None)
            .unwrap_err();
        assert!(error.to_string().contains("sequence regressed"));
        assert_eq!(repository.counts().unwrap(), (1, 1, 1, 0));
    }

    #[test]
    fn forward_sequence_jump_requires_atomic_exact_gap() {
        let mut repository = LedgerRepository::open_in_memory().unwrap();
        repository.create_session(&session()).unwrap();
        repository.register_channel(&channel()).unwrap();
        repository
            .commit_chunk(&chunk("chunk-1", 0, 480), None)
            .unwrap();

        let error = repository
            .commit_chunk(&chunk("chunk-2", 960, 1_440), None)
            .unwrap_err();
        assert!(error.to_string().contains("without an exact gap"));
        assert_eq!(repository.counts().unwrap(), (1, 1, 1, 0));

        repository
            .commit_chunk(
                &chunk("chunk-2", 960, 1_440),
                Some(&gap("gap-1", 480, Some(960))),
            )
            .unwrap();
        assert_eq!(repository.counts().unwrap(), (1, 1, 2, 1));
    }

    #[test]
    fn unknown_gap_extent_is_queryable_for_hardware_gate() {
        let mut repository = LedgerRepository::open_in_memory().unwrap();
        repository.create_session(&session()).unwrap();
        repository.register_channel(&channel()).unwrap();
        repository
            .record_gap(&gap("gap-unknown", 480, None))
            .unwrap();
        assert_eq!(repository.unknown_gap_count().unwrap(), 1);
    }

    #[test]
    fn lifecycle_updates_are_state_checked_and_atomic() {
        let mut repository = LedgerRepository::open_in_memory().unwrap();
        repository.create_session(&session()).unwrap();
        repository.register_channel(&channel()).unwrap();
        let transition = LifecycleTransition {
            session_id: SessionId(1),
            channel_id: Some(ChannelId("session-1-user-mic".into())),
            previous_capture_state: CaptureState::Capturing,
            capture_state: CaptureState::Recovering,
            previous_device_state: DeviceState::Available,
            device_state: DeviceState::Invalidated,
            previous_recovery_state: RecoveryState::Clean,
            recovery_state: RecoveryState::ScanRequired,
            detail_json: "{\"reason\":\"fixture\"}".into(),
            occurred_at_utc: "2026-08-14T00:00:03Z".into(),
        };
        repository.record_lifecycle(&transition).unwrap();
        let error = repository.record_lifecycle(&transition).unwrap_err();
        assert!(error.to_string().contains("stale"));
    }

    #[test]
    fn restart_restores_expired_inflight_jobs_without_provider_access() {
        let mut repository = LedgerRepository::open_in_memory().unwrap();
        repository.create_session(&session()).unwrap();
        repository.register_channel(&channel()).unwrap();
        repository
            .connection
            .execute(
                "INSERT INTO SpeechSegment(id,session_id,channel_id,seq_start,seq_end,qpc_start,qpc_end,endpoint_reason,vad_meta_json,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                params![
                    "segment-1",
                    SessionId(1).to_string(),
                    "session-1-user-mic",
                    0,
                    480,
                    0,
                    100,
                    "fixture",
                    "{}",
                    "FROZEN",
                    "2026-08-15T00:00:00Z",
                ],
            )
            .unwrap();
        repository
            .connection
            .execute(
                "INSERT INTO AsrJob(id,segment_id,idempotency_key,target,status,attempt,available_at,lease_until,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                params![
                    "job-1",
                    "segment-1",
                    "fixture-key",
                    "fixture",
                    "RUNNING",
                    1,
                    Option::<String>::None,
                    "2026-08-15T00:00:01Z",
                    "2026-08-15T00:00:00Z",
                    "2026-08-15T00:00:00Z",
                ],
            )
            .unwrap();

        assert_eq!(
            repository
                .restore_recoverable_jobs("2026-08-15T00:00:02Z")
                .unwrap(),
            1
        );
        let status: String = repository
            .connection
            .query_row("SELECT status FROM AsrJob WHERE id='job-1'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(status, "PENDING");
    }

    #[test]
    fn file_database_uses_wal_and_migrations_are_idempotent() {
        let suffix = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "auralis-ledger-{}-{suffix}.sqlite",
            std::process::id()
        ));
        remove_sqlite_files(&path);
        {
            let repository = LedgerRepository::open(&path).unwrap();
            assert_eq!(
                repository.journal_mode().unwrap().to_ascii_lowercase(),
                "wal"
            );
            assert_eq!(repository.user_version().unwrap(), SCHEMA_VERSION);
        }
        {
            let repository = LedgerRepository::open(&path).unwrap();
            assert_eq!(repository.user_version().unwrap(), SCHEMA_VERSION);
        }
        remove_sqlite_files(&path);
    }

    fn remove_sqlite_files(path: &Path) {
        for candidate in [
            path.to_path_buf(),
            PathBuf::from(format!("{}-wal", path.display())),
            PathBuf::from(format!("{}-shm", path.display())),
        ] {
            let _ = fs::remove_file(candidate);
        }
    }
}
