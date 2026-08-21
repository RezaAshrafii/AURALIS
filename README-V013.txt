AURALIS v0.13.0 — Speech Engine Reliability, architecture-hardened source

Source prerequisites:
- Node.js 22+ for tests, type-check and web staging
- Bun 1.2+ for the local application runtime
- Rust 1.97+ and Windows x64 for native core and hardware gates

Install and verify:
  npm ci
  npm run verify

Run the local runtime:
  npm start

What changed:
- durable PARTIAL/STABLE/FINAL transcript protocol
- local whisper.cpp fallback restricted to loopback
- transcript event dedupe
- neural-VAD boundary contracts
- Rust speech-ledger migration
- centralized runtime configuration and version ownership
- hardened loopback HTTP boundary and bounded JSON parsing
- supervised background tasks and graceful shutdown
- deterministic web staging from apps/web/public
- no UI redesign and no regression to capture-first persistence

What is intentionally still gated:
- Silero ONNX inference in the product hot path
- cloud gRPC streaming partials
- bundled whisper.cpp model/server
- 120-minute final release soak
