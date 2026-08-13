# ADR-0002: Current contract authority

- Status: Accepted
- Date: 2026-08-13
- Task: AUR-1102

## Context

AURALIS v0.10.12 exposes a local HTTP API, persisted events, and server/UI data shapes, but those facts previously had to be inferred from implementation files. Planned capabilities also appear in architecture language and must not be mistaken for behavior that exists today.

## Decision

`packages/contracts/` is the authoritative, versioned representation of the CURRENT application contract. It is dependency-free ESM and explicitly separates `currentContract` from `targetFutureContract`.

CURRENT captures the implemented `/v1` route and method surface, dynamic parameters, emitted `event_log` vocabulary, important server/UI boundary shapes, schema version 7, HTTP-polling semantics, local token assumptions, RAM-only credentials, and known behavior quirks. TARGET/FUTURE records intended capabilities without claiming or testing them as current behavior.

`tests/contract-current.test.mjs` is the source-only drift gate. It compares the complete represented route and emitted-event sets to `server.mjs`, verifies polling and event-log semantics, prevents future events from entering CURRENT, and protects critical credential-storage and redaction invariants.

## Consequences

- Consumers have one machine-readable CURRENT contract without depending on application implementation.
- Route or emitted-event changes require an intentional contract update.
- WebSocket, SSE, streaming partials, production Rust WASAPI, neural VAD, and streaming ASR remain explicitly outside CURRENT.
- The snapshot does not normalize or repair current quirks, including always-degraded health status and token-only diagnostics authorization after the global Host check.
