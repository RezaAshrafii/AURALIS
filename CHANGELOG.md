# Auralis v0.14.1 — Intelligence Layer Product Bridge Hotfix

- Promoted a separately packaged v0.14 Windows WASAPI product bridge with a strict JSONL v1 event protocol.
- Added post-fsync/post-ledger `audio.chunk_closed` delivery from Rust.
- Added integrity-checked native raw-audio conversion to mono PCM16 WAV and durable Segment creation.
- Made capture readiness fail closed: process spawn alone can no longer display LIVE.
- Fixed the missing path-separator import that previously broke the first ASR audio read.
- Kept fixed-window segmentation explicit and did not claim neural VAD support.

## v0.14.0 — Intelligence Layer

## Added
- Persisted per-Turn intelligence: intent, confidence, ambiguity, continuation parent, context ownership, topics, entities, and retrieval query.
- Deterministic document chunking with exact offsets, overlap, token counts, and per-chunk SHA-256.
- Versioned source lineage with SHA deduplication, `ACTIVE`/`SUPERSEDED`/`DELETED` lifecycle, and soft deletion.
- Hybrid FTS5 retrieval with deterministic reranking, document diversity, durable retrieval runs, and hit-level provenance.
- Strict v2 answer envelope with allowlisted chunk IDs and exact-quote citation verification.
- Durable citation audits and offline Persian citation/retrieval benchmark gates.
- Intelligence, citation, source-version, and retrieval-rank visibility inside the existing locked UI.

## Preserved
- Capture-first audio authority, append-only spool, gap ledger, immutable segments, transcript revisions, retry/retranscription, and v0.13 speech fallback contracts.
- Turn ownership, answer idempotency, strict local HTTP trust boundary, deterministic web staging, and focused workspace layout.

## Release boundary
- The source package proves portable intelligence/domain behavior, TypeScript contracts, deterministic UI staging, and regressions. Rust compilation and Windows WASAPI hardware gates still require the target Windows toolchain and devices.

---

# Auralis v0.13.0 — Speech Engine Reliability

## Architecture hardening revision
- Extracted versioned runtime configuration, local HTTP trust boundary, and background-task supervision from the Bun composition root.
- Added bounded strict JSON parsing, constant-time local token validation, cross-site bootstrap rejection, and safe static-path decoding.
- Replaced swallowed SQLite column-migration failures with explicit schema inspection.
- Consolidated shipped web assets under `apps/web/public` and removed unused npm React/Vite dependencies.
- Made web staging deterministic by default and added cross-manifest version parity checks.
- Changed typed runtime state reduction to immutable updates.
- Added architecture-boundary regression tests and graceful capture-aware shutdown.

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
