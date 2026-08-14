# AURALIS Implementation Status

Updated: 2026-08-14

## Repository checkpoint

- Branch: `dev/v0.12.0-production-audio`
- Verified v0.11.0 completion HEAD: `ee59002d3dbaf60c571d8a315520b1ba274db3ca`
- Rollback anchor: `1ac530ee4e59e52c931313fa3b3366a06e497e87`
- Product version: v0.11.0 Engineering Foundation (complete)
- Active milestone: v0.12.0 Production Windows Audio Core
- Completed: AUR-1101, AUR-1102, AUR-1103, AUR-1104, AUR-1201
- v0.11 milestone gate: COMPLETE at the AUR-1104 commit (`head_commit: SELF` in handoff)
- Active task: AUR-1202 — Event-Driven WASAPI Microphone Capture

## Deterministic baseline

| Label | Command | Result |
| --- | --- | --- |
| UNIT / FIXTURE / source contract | `node --test "tests/*.test.mjs"` | PASS — 74 total, 63 pass, 11 expected skip, 0 fail |
| UNIT / INTEGRATION / Rust audio core | `cargo test --manifest-path native/Cargo.toml --workspace --locked` | PASS — 11 pass, 0 fail |
| Source quality / Rust audio core | `cargo fmt ... --check` and `cargo clippy ... -D warnings` | PASS |
| Frontend typecheck | `npm run frontend:typecheck` | PASS — strict TypeScript |
| Frontend tests | `npm run frontend:test` | PASS — 3 pass, 0 fail |
| Frontend production build | `npm run frontend:build` | PASS — Vite 7.1.7, 25 modules |
| INTEGRATION / local UI smoke | Source `app/` and generated `dist/web/` via trusted Bun | PASS — online UI, four primary views, zero build-console errors |
| INTEGRATION / repository gate | `npm run verify` | PASS |
| INTEGRATION / deterministic artifact | `npm run build:v0.11:test` | PASS — 2 identical builds, SHA-256 manifest, full suite |
| INTEGRATION / documented launcher | `scripts/run-v011-test.ps1` with trusted Bun | PASS — health/version/index/asset checks and graceful shutdown |
| Source hygiene | `git diff --check` | PASS |
| REAL_WINDOWS_HARDWARE | Not run | Pending at the v0.12 hardware gate |

The 11 skips cover an absent compiled portable probe and unshipped native-probe source. They are expected source-checkout skips and are not Windows hardware validation.

## One-time PRESERVE / HARDEN / REPLACE audit

This audit is complete. Use this table for later milestones; do not repeat repository-wide discovery.

| Subsystem | Decision | Evidence and required direction |
| --- | --- | --- |
| UI | HARDEN | Preserve the current workspace, transcript, hub, inspector, themes, hotkey, and mode experience. Add TypeScript/Vite/tests incrementally without aesthetic redesign. |
| Local server | REPLACE | Preserve `/v1` behavior while incrementally moving production ownership from the Bun monolith to the Rust/Axum core. Do not perform a big-bang rewrite. |
| WASAPI capture | REPLACE | Current integration depends on a validation probe not present in tracked source. Implement event-driven production Rust WASAPI and validate on real Windows hardware. |
| Audio spool | REPLACE | Current append/finalize behavior is probe-owned and only source-asserted. Implement a tracked, bounded Rust spool with durable gap reporting. |
| Ledger | HARDEN | SQLite WAL, sequences, chunks, gaps, recovery, and Rust migrations already encode the right direction. Consolidate ownership and add crash/property coverage. |
| VAD | REPLACE | Current derived/VAD implementation is validation-only. Replace with benchmarked neural VAD and band-limited derived audio. |
| ASR | REPLACE | Current segment-final provider adapters and bounded retry preserve audio, but production needs an `AsrPort`, streaming revisions, cloud/local adapters, cancellation, and benchmark evidence. |
| Transcript | HARDEN | Immutable final revisions and replay dedupe exist. Add PARTIAL/STABLE_PREFIX semantics, ordering protection, and reconciliation. |
| Turn engine | HARDEN | Deterministic Persian routing, source ownership, immutable segment links, and duplicate-Turn protection exist. Extend revision-driven assembly and ordering tests. |
| Mode policies | HARDEN | Study, Oral Copilot, Meeting, and Mock Exam ownership gates exist. Make job semantics fully persisted/cancelable and expand colloquial regressions. |
| RAG | HARDEN | Persian normalization, SQLite FTS5/BM25, bounded chunks, and citation allowlisting exist. Add structured ingestion, neighbor metadata, strict insufficiency, and a gold benchmark. |
| Brain | HARDEN | Text-only provider flow, schema validation, source allowlisting, idempotent stored answers, and failure isolation exist. Add persisted job lifecycle and cancellation. |
| Storage | HARDEN | SQLite WAL and the primary entities exist in Bun plus Rust migrations. Move the authoritative implementation into Rust with versioned migrations and recovery tests. |
| Security | HARDEN | Loopback bind, Host/Origin/token checks, RAM-only credentials, redacted status, and fixed provider endpoint exist. Add OS secret storage, launch-token lifecycle, CSP, and complete SSRF/redirect policy. |
| Packaging | REPLACE | No reproducible source-driven portable/installer pipeline exists. Build deterministic, self-contained Windows/source/web outputs without committing generated artifacts. |
| Tests | HARDEN | Deterministic source contracts and regressions are strong. Add frontend build/typecheck, Rust unit/integration coverage, fixture benchmarks, soak measurement, and explicit real-hardware gates. |

## Immediate acceptance queue

1. AUR-1202 through AUR-1205: production Rust audio core implementation and automated verification.
2. AUR-1206: mandatory real Windows hardware gate. This is the next expected human-validation stop.

## Standing risks

- Rust 1.97.1 is installed locally for v0.12 format, clippy, build, and test gates.
- The trusted Bun runtime and compiled validation probe are generated/runtime dependencies and must not be committed.
- Provider credentials and paid calls are not required for provider-independent implementation, but live provider validation will require explicit user-supplied credentials/credit.
- No milestone may be called final based on fixture results when its gate requires real Windows hardware.
