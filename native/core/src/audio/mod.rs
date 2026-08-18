//! Target Phase-2 audio boundary for the production Rust core.
//!
//! The runnable validation package includes a separate Windows WASAPI probe
//! so the hardware path can be exercised before this crate is built in the release toolchain.
//! Production ownership remains here: WASAPI capture -> bounded queue -> spool -> SQLite ledger.

pub const DEFAULT_CHUNK_SECONDS: u32 = 5;
pub const DEFAULT_CAPTURE_QUEUE_CAPACITY: usize = 256;

pub fn qpc_end_100ns(qpc_start_100ns: u64, frames: u32, sample_rate_hz: u32) -> u64 {
    if sample_rate_hz == 0 {
        return qpc_start_100ns;
    }
    qpc_start_100ns + u64::from(frames) * 10_000_000 / u64::from(sample_rate_hz)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qpc_end_uses_audio_duration() {
        assert_eq!(qpc_end_100ns(1_000, 48_000, 48_000), 10_001_000);
    }
}
