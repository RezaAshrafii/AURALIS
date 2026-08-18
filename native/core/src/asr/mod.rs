//! Phase-3 production boundary. The runnable validation helper still uses
//! segment-final adapters; the Rust release core must implement streaming AsrPort.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AsrEvent {
    PartialTranscript { text: String },
    StablePrefixAdvanced { text: String },
    FinalTranscript { text: String },
    ProviderEndpoint,
    RetryableFailure { code: String },
    PermanentFailure { code: String },
}
