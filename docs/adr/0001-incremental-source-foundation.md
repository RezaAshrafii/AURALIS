# ADR-0001: Incremental source-foundation migration

- Status: Accepted
- Date: 2026-08-13
- Task: AUR-1101

## Context

AURALIS has a working JavaScript server, a local React interface, contract tests, and a partial Rust production-core foundation. Replacing the working stack in one step would combine architecture migration with behavior changes and make regressions difficult to isolate. Clean source checkouts must also remain verifiable when generated native probes are absent.

## Decision

Adopt an incremental source-foundation migration. Preserve current application and HTTP behavior while introducing deterministic repository hygiene, a single local verification command, explicit current-versus-target documentation, and task handoffs. Future capability migrations must be placed behind existing contracts and validated independently before ownership moves away from the current implementation.

Generated binaries, runtime state, captured audio, databases, credentials, and release artifacts remain outside source control. Missing optional native/probe artifacts must be reported as explicit skips rather than silently treated as coverage.

## Consequences

- Foundation work can proceed without redesigning the application or changing API contracts.
- Each future migration needs focused contract coverage and a documented handoff.
- Source verification is reproducible across line-ending conventions.
- Native integration is not fully exercised in source-only environments; Windows artifact and device validation remains a separate release responsibility.
