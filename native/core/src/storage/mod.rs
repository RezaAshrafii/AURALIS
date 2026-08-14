mod repository;

pub use repository::LedgerRepository;

pub const AUDIO_LEDGER_MIGRATION_0001: &str = include_str!("migrations/0001_audio_ledger.sql");
pub const SEGMENT_ASR_MIGRATION_0002: &str = include_str!("migrations/0002_segments_asr.sql");
pub const LIFECYCLE_MIGRATION_0003: &str = include_str!("migrations/0003_lifecycle.sql");
