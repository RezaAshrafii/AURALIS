# Auralis v0.14.1 — Release gates

## Portable source gates

- [ ] `node --test "tests/*.test.mjs"` has zero failures.
- [ ] `node scripts/run-v014-benchmarks.mjs` prints `AURALIS_V014_BENCHMARK_PASS`.
- [ ] Citation precision and exact-quote coverage are each `1.00` on committed fixtures.
- [ ] `npm run frontend:typecheck` passes.
- [ ] two clean `npm run frontend:build` outputs are byte-identical.
- [ ] `npm run verify` prints `AURALIS_VERIFY_PASS`.
- [ ] `VERSION`, npm workspaces, public metadata, and Cargo version are `0.14.1`.
- [ ] delivered ZIP CRC and SHA-256 are verified from the exact archive.

## Functional gates

- [ ] every committed Turn has one `turn_intelligence` record.
- [ ] continuation resolves only to an answerable parent; unresolved references are ambiguous.
- [ ] identical active source content deduplicates by SHA-256.
- [ ] same-title replacement supersedes the prior active version atomically.
- [ ] retrieval uses only `ACTIVE` sources and persists run/hit provenance.
- [ ] unknown chunks, fabricated quotes, empty quotes, and duplicate citations cannot become verified citations.
- [ ] source/mixed answers without valid citations become `grounding_unverified`.
- [ ] answer idempotency and Turn ownership remain intact.

## Inherited native/Windows gates

Before the inherited soak suite, run the product bridge gate:

- [ ] `BUILD-V014-PRODUCT-BRIDGE.cmd` produces only the explicitly promoted v0.14 bridge artifact.
- [ ] `RUN-V014-PRODUCT-BRIDGE-GATE.cmd` observes session-bound start, heartbeat, post-commit chunk, and stopped events.
- [ ] every emitted chunk path exists and its byte length and SHA-256 match the event.
- [ ] UI/API stays non-LIVE while state is `STARTING` or `AWAITING_PROTOCOL`.
- [ ] a valid product chunk becomes a mono PCM16 WAV, one immutable Segment, and one idempotent ASR job.
- [ ] unsupported, misaligned, or corrupt audio fails closed in Health and never appears as transcript text.

Run the v0.13 Rust/Windows gate suite on target hardware. A Linux source build must not claim WASAPI, Silero ONNX hot-path, cloud gRPC streaming latency, or hardware soak success.
