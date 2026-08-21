mod repository;

pub use repository::{LedgerRepository, RecoveryScanOutcome};

pub const AUDIO_LEDGER_MIGRATION_0001: &str = include_str!("migrations/0001_audio_ledger.sql");
pub const SEGMENT_ASR_MIGRATION_0002: &str = include_str!("migrations/0002_segments_asr.sql");
pub const LIFECYCLE_MIGRATION_0003: &str = include_str!("migrations/0003_lifecycle.sql");
pub const RAW_SPOOL_MIGRATION_0004: &str = include_str!("migrations/0004_raw_spool.sql");
pub const RECOVERY_MIGRATION_0005: &str = include_str!("migrations/0005_recovery.sql");
pub const SPEECH_ENGINE_MIGRATION_0006: &str = include_str!("migrations/0006_speech_engine.sql");
