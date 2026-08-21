AURALIS v0.13.0 — Speech Engine Reliability

Run the portable build with Auralis-Start.cmd / Auralis.vbs.

What changed:
- durable PARTIAL/STABLE/FINAL transcript protocol
- local whisper.cpp fallback restricted to loopback
- transcript event dedupe
- neural-VAD boundary contracts
- Rust speech-ledger migration
- no UI redesign and no regression to capture-first persistence

What is intentionally still gated:
- Silero ONNX inference in the product hot path
- cloud gRPC streaming partials
- bundled whisper.cpp model/server
- 120-minute final release soak
