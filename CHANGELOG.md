# Auralis v0.10.5 — Audio Path Hardening Validation

## Fixed
- Fixed WAVEFORMATEXTENSIBLE parsing by using Windows byte offsets (18/20/24) instead of Go struct extension alignment.
- Added valid-bits and channel-mask awareness to the derived audio path.
- Added right-channel-safe downmix and regression tests.
- Added explicit `capture.format_unsupported` and `vad.decode_failed` telemetry instead of silent VAD starvation.
- Added live RMS / threshold / voice / encoding telemetry in the Session UI.
- Fixed disabled capture-source health so an unchecked System Loopback is not shown as STARTING/CAPTURING by default.

## Responsiveness
- Replaced overlapping 1-second polling with a non-overlapping scheduler.
- Avoids rebuilding Health / Turns / Transcript DOM when data has not changed.
- Defers router/source/metrics initialization until after first paint.
- Skips replaying completed historical audio ledgers at each application launch.
- Prewarms the native capture probe in the background on Windows.
- Session-start and capture-start latency are now measured and shown in the Native summary.

## Preserved
- Capture-first raw WASAPI spool before VAD/ASR.
- Persistent SQLite ledger and explicit gaps.
- Immutable segment IDs and transcript revisions.
- Visible Live Transcript.
- Selectable Turn cards with their own question and answer.
- Server-side Persian Router, FTS5 retrieval, strict answer schema and citation allowlist.

## Release honesty
This is a Windows validation build, not a claim of a flawless or final v0.10 release. The production requirements in the v0.10 implementation prompt still require the Rust core, neural VAD, dedicated streaming ASR partial/stable-prefix path, local worker/replay validation, and 20/60/120-minute Windows release gates.
