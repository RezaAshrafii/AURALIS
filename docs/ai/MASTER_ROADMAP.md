# AURALIS Master Roadmap

This is the compact execution index derived from `AURALIS_CODEX_MASTER_PACKET.md`. The packet remains authoritative; this file prevents repeated roadmap and repository discovery.

## Execution sequence

| Milestone | Tasks | Status | Exit gate |
| --- | --- | --- | --- |
| v0.11 Engineering Foundation | AUR-1101 contracts/foundation, AUR-1102 CURRENT contract, AUR-1103 TypeScript/Vite, AUR-1104 layout/gate | GATE COMPLETE — ready commit is the AUR-1104 handoff `SELF` commit; no tag created | Clean source, repeatable build, versioned contracts, strict typecheck/tests, two identical builds, regressions green, exact runnable procedure |
| v0.12 Production Windows Audio Core | AUR-1201 domain/persistence, 1202 mic, 1203 loopback/dual, 1204 spool/ledger/gap, 1205 lifecycle/recovery, 1206 hardware gate | NEXT | Real mic, loopback, dual, right-channel, 44.1/48 kHz, device change, recovery, and 20-minute Windows capture; unknown gaps zero |
| v0.13 Production Speech Engine | AUR-1301 derived audio through AUR-1307 dedupe/benchmark | PENDING | Neural VAD, immutable segments, partial/stable/final ASR, cloud/local boundaries, bounded retry, corpus metrics, runnable test build |
| v0.14 Turn Intelligence + RAG | AUR-1401 through AUR-1406 | PENDING | Revision-driven Turns, correct ownership/modes, persisted Answer jobs, structured ingestion, strict cited retrieval, gold benchmark, isolation invariants |
| v0.15 Production UI + Shared Web | AUR-1501 through AUR-1506 | PENDING | Production TS/Vite UI, implemented WebSocket reconciliation, workspace/hub/history, bounded web capture claims, accessibility and performance targets |
| v0.16 Security / Reliability / Packaging | AUR-1601 through AUR-1606 | PENDING | OS secret storage, local API/provider hardening, component health, retention, self-contained packaging, measured soak procedures/results |
| v1.0 Stable Release | Feature freeze and release QA | PENDING | All global correctness, security, latency, speech, long-session, packaging, documentation, and hardware gates verified |

## Global invariants

- Raw audio is authoritative and is persisted before analysis.
- Every loss or overflow becomes a durable `Gap`; silent drops are forbidden.
- Mic and system audio remain independent through ASR.
- ASR and Answer jobs are persisted, idempotent, retryable, cancelable, and safe under out-of-order completion.
- Brain failure does not stop ASR; ASR failure does not stop capture; UI failure does not lose audio.
- Provider credentials never enter source, logs, URLs, plaintext SQLite, diagnostics, or localStorage.
- CURRENT and TARGET/FUTURE contracts remain separate until runtime implementation exists.
- Tests are labeled UNIT, FIXTURE, INTEGRATION, or REAL_WINDOWS_HARDWARE.
- Generated binaries, release archives, runtime databases, captured audio, and dependency trees are never committed.

## Mandatory stops

Stop only for a real Windows hardware gate, a new credential or paid service, a destructive migration/Git action, an architecture-contract conflict, a security-sensitive approval, or a release gate that cannot be automated. At a hardware stop, provide the exact build path, launch command, checklist, expected result, and failure evidence to return.

## Version-control policy

- Commit each completed task after targeted tests, the regression gate, status/handoff updates, and `git diff --check` pass.
- Do not use `git add .`.
- Do not push, publish, merge protected branches, create releases, or create final milestone/version tags without explicit human approval.
