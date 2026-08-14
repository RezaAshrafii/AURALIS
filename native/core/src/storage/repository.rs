use std::{path::Path, time::Duration};

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};

use crate::domain::{
    ledger::{AudioChannel, AudioChunk, Gap, LifecycleTransition, Session},
    ports::{AudioLedgerPort, CoreError},
};

use super::{AUDIO_LEDGER_MIGRATION_0001, LIFECYCLE_MIGRATION_0003, SEGMENT_ASR_MIGRATION_0002};

const SCHEMA_VERSION: u32 = 3;

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
        self.connection
            .execute_batch("PRAGMA synchronous=NORMAL;")
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
                "INSERT INTO AudioChannel(id,session_id,source_kind,device_id,device_generation,native_sample_rate,native_channels,channel_mask,state,sample_format,device_state,recovery_state,last_sequence,last_qpc_100ns,last_device_position) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                 ON CONFLICT(id) DO UPDATE SET device_id=excluded.device_id,device_generation=excluded.device_generation,native_sample_rate=excluded.native_sample_rate,native_channels=excluded.native_channels,channel_mask=excluded.channel_mask,state=excluded.state,sample_format=excluded.sample_format,device_state=excluded.device_state,recovery_state=excluded.recovery_state,last_sequence=excluded.last_sequence,last_qpc_100ns=excluded.last_qpc_100ns,last_device_position=excluded.last_device_position",
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
                ],
            )
            .map_err(storage_error)?;
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
        if chunk.discontinuity.is_some() && preceding_gap.is_none() {
            return Err(CoreError::InvalidState(
                "chunk discontinuity requires an explicit gap record".into(),
            ));
        }

        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage_error)?;
        let registered: Option<(String, i64, i64, i64, Option<i64>, String)> = transaction
            .query_row(
                "SELECT session_id,last_sequence,native_sample_rate,native_channels,channel_mask,sample_format FROM AudioChannel WHERE id=?",
                [&chunk.channel_id.0],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .optional()
            .map_err(storage_error)?;
        let Some((session_id, previous, sample_rate, channels, channel_mask, sample_format)) =
            registered
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
        match (chunk.seq_start.cmp(&previous), preceding_gap) {
            (std::cmp::Ordering::Greater, Some(gap))
                if gap.exactly_covers(previous, chunk.seq_start) => {}
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

        if let Some(gap) = preceding_gap {
            insert_gap(&transaction, gap)?;
        }
        let chunk_path = chunk.path.to_string_lossy().into_owned();
        let discontinuity = chunk.discontinuity.map(|reason| reason.as_storage_str());
        transaction
            .execute(
                "INSERT INTO AudioChunk(id,session_id,channel_id,seq_start,seq_end,qpc_start,qpc_end,sample_rate,channels,format,path,byte_length,sha256,discontinuity,state,created_at,channel_mask,device_position_start,device_position_end) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
                ],
            )
            .map_err(storage_error)?;
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
