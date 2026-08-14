# AURALIS architecture

This document distinguishes the software that exists in the v0.11.0 engineering foundation from the intended direction. v0.11 preserves the v0.10.12 product behavior while adding contracts and deterministic build tooling. Target statements are not claims about current production behavior.

## CURRENT

- `server.mjs` owns the local HTTP service and coordinates sessions, capture, transcription, retrieval, answer generation, and persistence.
- `app/` contains the locally served React 18 interface and static assets.
- `apps/web/` contains the strict TypeScript + Vite build boundary. It bundles the existing `app/` UI source graph through a typed compatibility bridge while the source-served UI remains available during incremental migration.
- `core/` contains focused JavaScript policy and parsing modules used by the current server and contract tests.
- Native capture is integrated through external validation/probe executables when they are present. Their absence in a source checkout is supported and produces explicit test skips.
- `native/core/` is the Rust production-core foundation. Its domain, audio, ASR, health, and storage contracts do not yet replace the current server orchestration.
- Runtime state and generated artifacts belong under ignored local paths and are not source-controlled.

## TARGET / FUTURE

- Move capabilities behind explicit ports so capture, ASR, retrieval, model providers, storage, and UI delivery can evolve independently.
- Migrate production-critical audio and persistence responsibilities into the Rust core incrementally, preserving existing HTTP and behavior contracts at each step.
- Keep provider credentials in memory and isolate provider-specific code behind adapters.
- Make every migration step reversible, covered by contract tests, and usable without generated binaries in a clean source checkout.
- Produce platform binaries only in controlled build/release workflows; never treat generated artifacts as source.

The incremental migration decision and constraints are recorded in [ADR-0001](adr/0001-incremental-source-foundation.md).
