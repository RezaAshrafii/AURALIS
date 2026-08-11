# Rust production core status — v0.10.4 validation build

The target architecture remains Rust stable + windows-rs + Tokio/Axum + SQLite WAL, as required by the v0.10 implementation prompt.

This artifact host still does not contain `rustc`/`cargo`. The Windows-runnable validation package therefore continues to use the Go WASAPI probe for native capture, persistent spool and immutable segment generation. The probe is not presented as the final production `auralis-core.exe`.

v0.10.4 adds a visible final-transcript feed, persistent ASR job/revision state, pending-segment replay, and exact Turn question/answer cards. The remaining production migration is neural VAD + dedicated streaming ASR partial/stable-prefix + local whisper worker inside the target Rust architecture.
