AURALIS v0.14.1 — Intelligence Layer + Windows Product Bridge hotfix source
================================================

This release implements the v0.14 roadmap milestone on top of the architecture-
hardened v0.13 capture-first foundation.

Implemented:
- persisted Turn intent/context/continuation intelligence;
- deterministic offset-preserving document chunks;
- SHA-deduplicated, versioned source lifecycle;
- FTS5 retrieval plus deterministic hybrid reranking and provenance ledger;
- exact-quote citation validation and durable citation audits;
- Persian/adversarial citation and retrieval benchmark gate;
- existing focused UI extended with intelligence and citation evidence;
- packaged Windows Rust JSONL product bridge;
- post-fsync/post-ledger chunk delivery, integrity recheck, mono PCM16 WAV conversion, and immutable ASR Segments;
- fail-closed capture readiness: process spawn alone is never shown as LIVE.

Windows first run:
  BUILD-V014-PRODUCT-BRIDGE.cmd
  RUN-V014-PRODUCT-BRIDGE-GATE.cmd
  npm start

Inside AURALIS, activate a valid ASR provider, keep Microphone enabled, start a
session, and speak for longer than the selected 2-5 second chunk window.

Quick verification:
  node --test "tests/*.test.mjs"
  node scripts/run-v014-benchmarks.mjs
  npm run frontend:typecheck
  npm run frontend:build
  npm run verify

Runtime:
  npm ci
  npm start

The default product audio path remains capture-first. Provider, ASR, retrieval,
and answer failures cannot stop or rewrite authoritative raw audio.

Important: v0.14.1 uses an honest durable fixed-window fallback for product
transcription. Neural speech-boundary VAD is not claimed by this patch.
