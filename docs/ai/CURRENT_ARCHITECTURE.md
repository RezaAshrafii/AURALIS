# AURALIS Current Architecture

Last verified: 2026-08-14 at `1ac530ee4e59e52c931313fa3b3366a06e497e87` on `dev/AUR-1102-contracts`.

This file is the compact source-of-truth for implemented architecture. It describes CURRENT behavior only. Planned behavior remains in `MASTER_ROADMAP.md` and `packages/contracts/target-future.mjs`.

## Runtime and process boundary

- `server.mjs` is the runnable local product service. It uses Bun, binds only to `127.0.0.1:47832`, serves the UI, owns `/v1` routing, and orchestrates capture, ASR, turns, retrieval, answers, health, and persistence.
- `app/` is the current static React 18 UI. React, ReactDOM, and Bootstrap are locally vendored; the UI uses non-overlapping HTTP polling rather than WebSocket or SSE.
- `core/` contains dependency-free JavaScript domain policy for Persian routing, automatic-answer ownership, runtime-capability routing, and provider-answer validation.
- `packages/contracts/` is the authoritative, machine-tested CURRENT/TARGET contract boundary. CURRENT `/v1` behavior must not drift during migration.
- `native/core/` is a Rust domain and persistence scaffold. It is not yet the runnable production core.
- The source checkout does not require generated executables. Optional native/probe validation is explicitly skipped when its binary or unshipped source is absent.

## Data and request flow

```text
Static React UI
  -> authenticated local /v1 HTTP requests
  -> Bun server orchestration
  -> optional external WASAPI validation probe
  -> raw audio chunks + JSONL ledger under ignored runtime data
  -> SQLite WAL ledger/event log
  -> frozen segments
  -> segment-final ASR adapter
  -> immutable transcript revisions
  -> deterministic Turn routing and mode policy
  -> FTS5/BM25 retrieval
  -> text-only Brain adapter
  -> persisted answer result
  -> polling UI
```

Audio is the source of truth. Transcript, Turn, retrieval evidence, and answer records are derived data. Brain failure must not stop ASR; ASR failure must not stop capture; UI failure must not cause audio loss.

## Implemented persistence

- Bun SQLite with WAL, foreign keys, and schema version 7.
- Sessions, turns, answer results, gaps, audio channels/chunks, capture runs, source documents/chunks with FTS5, speech segments, transcript revisions, ASR jobs, turn-to-segment links, and an event log.
- Raw audio and runtime databases live under ignored paths and are not source artifacts.
- Native ledger replay recovers incomplete chunks after interruption.
- ASR retries are bounded and persisted; retranscription avoids duplicate Turns.

## Security boundary

- A random process token is issued by `GET /v1/bootstrap` and kept in application memory.
- State-changing routes require the local Host, a local Origin, and the process token.
- Provider credentials are supplied at runtime, kept in memory, redacted from status, and excluded from localStorage, SQLite, and diagnostics.
- Provider traffic currently targets a fixed Google endpoint.
- Credential Manager/DPAPI storage, stricter diagnostics authorization, CSP, and complete provider/redirect hardening are future work.

## Authoritative CURRENT limitations

- The service remains a Bun monolith rather than the target Rust/Axum production core.
- The production WASAPI implementation is not present in tracked source; native tests that need it are skips, not hardware passes.
- VAD and derived-audio behavior are validation/probe capabilities, not the target neural VAD pipeline.
- ASR is segment-final; PARTIAL and STABLE_PREFIX revisions are not implemented.
- Realtime UI delivery is polling over `event_log`; WebSocket is TARGET/FUTURE.
- Source ingestion accepts submitted text. Production PDF/DOCX and structured metadata ingestion are not implemented.
- Packaging is a prior portable baseline, not a reproducible source-built v1 release pipeline.

## Change discipline

- Preserve the CURRENT contract until a task explicitly implements and versions its replacement.
- Move one responsibility at a time behind a tested port; avoid a whole-repository rename or rewrite.
- Do not treat fixtures, source inspection, or an optional probe as real Windows hardware validation.
- Do not rescan ignored runtime, data, release, dependency, binary, captured-audio, or database content during normal milestone work.
