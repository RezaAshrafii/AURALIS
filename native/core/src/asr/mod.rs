//! Production speech-engine contracts for v0.13.
//!
//! The core treats transcript updates as monotonic revisions owned by one
//! immutable speech segment. Provider transports may be cloud streaming or a
//! local whisper.cpp fallback, but only FINAL revisions may commit a Turn.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum TranscriptState {
    Partial,
    Stable,
    Final,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StreamingTranscriptEvent {
    pub segment_id: String,
    pub revision: u32,
    pub state: TranscriptState,
    pub provider: String,
    pub provider_model: String,
    pub text: String,
    pub language: String,
    pub confidence: Option<f32>,
}

impl StreamingTranscriptEvent {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.segment_id.trim().is_empty() {
            return Err("segment id is required");
        }
        if self.revision == 0 {
            return Err("revision must be positive");
        }
        if self.state != TranscriptState::Final && self.text.trim().is_empty() {
            return Err("non-final transcript must contain text");
        }
        if let Some(confidence) = self.confidence
            && !(0.0..=1.0).contains(&confidence)
        {
            return Err("confidence must be within [0,1]");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AsrEvent {
    PartialTranscript { text: String },
    StablePrefixAdvanced { text: String },
    FinalTranscript { text: String },
    ProviderEndpoint,
    FallbackStarted { provider: String },
    RetryableFailure { code: String },
    PermanentFailure { code: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalWhisperConfig {
    pub base_url: String,
    pub language: String,
    pub model_label: String,
}

impl Default for LocalWhisperConfig {
    fn default() -> Self {
        Self {
            base_url: "http://127.0.0.1:8080".into(),
            language: "fa".into(),
            model_label: "whisper.cpp-local".into(),
        }
    }
}

impl LocalWhisperConfig {
    pub fn validate(&self) -> Result<(), &'static str> {
        let url = self.base_url.trim().to_ascii_lowercase();
        let rest = url
            .strip_prefix("http://")
            .ok_or("local whisper endpoint must use loopback HTTP")?;
        if rest.contains('@') || rest.contains('?') || rest.contains('#') {
            return Err("local whisper endpoint must not contain credentials, query, or fragment");
        }
        let (authority, path) = rest.split_once('/').unwrap_or((rest, ""));
        if !path.is_empty() && path.trim_matches('/') != "inference" {
            return Err("local whisper endpoint path must be root or /inference");
        }

        let (host, port) = if let Some(v6) = authority.strip_prefix('[') {
            let (host_tail, port_tail) = v6
                .split_once("]:")
                .ok_or("loopback IPv6 endpoint requires an explicit port")?;
            (format!("[{host_tail}]"), port_tail)
        } else {
            let (host, port) = authority
                .rsplit_once(':')
                .ok_or("local whisper endpoint requires an explicit port")?;
            (host.to_string(), port)
        };

        if !matches!(host.as_str(), "127.0.0.1" | "localhost" | "[::1]") {
            return Err("local whisper endpoint host must be loopback");
        }
        if port.parse::<u16>().ok().filter(|value| *value > 0).is_none() {
            return Err("local whisper endpoint port is invalid");
        }
        if self.language.trim().is_empty() {
            return Err("local whisper language is required");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_remote_local_whisper_endpoint() {
        for base_url in [
            "https://example.com",
            "http://192.168.1.20:8080",
            "http://127.0.0.1:8080@evil.example",
            "http://localhost:8080/admin",
            "http://localhost:not-a-port",
        ] {
            let config = LocalWhisperConfig {
                base_url: base_url.into(),
                ..LocalWhisperConfig::default()
            };
            assert!(config.validate().is_err(), "{base_url}");
        }
        let valid = LocalWhisperConfig {
            base_url: "http://127.0.0.1:8080/inference".into(),
            ..LocalWhisperConfig::default()
        };
        assert!(valid.validate().is_ok());
    }

    #[test]
    fn final_revision_can_be_empty_but_partial_cannot() {
        let mut event = StreamingTranscriptEvent {
            segment_id: "seg-1".into(),
            revision: 1,
            state: TranscriptState::Partial,
            provider: "test".into(),
            provider_model: "test".into(),
            text: String::new(),
            language: "fa-IR".into(),
            confidence: None,
        };
        assert!(event.validate().is_err());
        event.state = TranscriptState::Final;
        assert!(event.validate().is_ok());
    }
}
