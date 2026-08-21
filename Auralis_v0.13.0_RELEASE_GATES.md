# Auralis v0.13.0 — Release Gates

## Software gates
- `npm test`: 0 failures.
- `npm run frontend:typecheck`: PASS.
- `npm run frontend:build`: PASS.
- `npm run verify`: PASS.
- Server/UI/core JavaScript syntax: PASS.
- Transcript revision monotonicity: PASS.
- Duplicate stream-event rejection: PASS.
- Loopback-only local-ASR URL validation: PASS.
- Cloud→local fallback policy regression tests: PASS.
- v0.12 WASAPI/spool/ledger regression tests: PASS.

## Windows/Rust gates
Run `RUN-V013-HARDWARE-GATE.cmd` on the target Windows machine.
- Cargo/Rust 1.97.1+ build: required for Rust PASS.
- Mic 60 s: unknown gaps = 0, queue drops = 0.
- System loopback 60 s: unknown gaps = 0, queue drops = 0.
- Mic + loopback 120 s: unknown gaps = 0, queue drops = 0.
- 20-minute simultaneous soak before promoting the Rust capture bridge.

## Speech gates still required before calling the v0.13 architecture complete
- Silero/ONNX inference wired into the product hot path at 16 kHz mono.
- Persian speech boundary test set with no phantom turns during long silence.
- Cloud streaming transport producing real PARTIAL/STABLE/FINAL events (no synthetic partials).
- p95 partial latency < 700 ms and final latency < 1200 ms on the target network/provider.
- Local whisper.cpp fallback tested with actual Persian audio and a pinned model.
- 120-minute final release soak remains a v0.16/v1.0 gate.
