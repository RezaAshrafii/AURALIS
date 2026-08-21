# Auralis v0.13.0 — Speech Engine Reliability

## Added
- Monotonic transcript protocol: `PARTIAL → STABLE → FINAL` with per-segment revision ownership.
- Durable `transcript_stream_events` ledger with fingerprint-based deduplication.
- Loopback-only `whisper.cpp` HTTP fallback adapter (`/inference`) with SSRF protection.
- Cloud→local fallback policy for auth, quota, network, provider, config and internal ASR failures.
- Local whisper status/config/probe API and Settings controls.
- Neural-VAD hysteresis/state-machine contracts in JavaScript and Rust.
- Rust ledger migration v6 for streaming transcript events.
- v0.13 Windows software/hardware gate scripts and release checklist.

## Preserved
- v0.12 capture-first WASAPI/spool/ledger architecture.
- Existing validated interactive capture bridge remains default until the Rust v0.13 product bridge passes real-Windows gates.
- Immutable audio segments, retry/retranscription, turn ownership, Auto Answer, RAG/source grounding, Conversation Hub and focused UI.

## Release boundary
This package does **not** claim that Silero ONNX inference is already in the production hot path, nor that cloud gRPC partial latency has passed the Windows release gate. The current runtime persists FINAL stream events and can recover failed cloud ASR through a local whisper.cpp server. Neural VAD inference and true cloud streaming partials remain gated work, not silently simulated behavior.
