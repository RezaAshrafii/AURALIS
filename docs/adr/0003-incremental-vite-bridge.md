# ADR-0003: Introduce Vite through a typed compatibility bridge

## Status

Accepted for AUR-1103.

## Context

The current UI is a stable React 18 application in `app/app-react.js` and `app/ui-kit.js`, served directly by the Bun service. A big-bang component conversion would combine toolchain migration with product behavior and visual changes, making regressions difficult to isolate.

## Decision

Create `apps/web/` as the production frontend build boundary. Its strict TypeScript entry installs the React globals required by the current modules, then dynamically imports those tracked sources and shared CSS. Vite builds that same source graph into ignored `dist/web/` output.

Keep `app/` runnable during the migration. Convert components behind this bridge incrementally in later tasks, with the authoritative CURRENT contract and UI regression suite guarding behavior.

The server defaults to `app/`. An explicit `AURALIS_USE_VITE_BUILD=1` test mode serves `dist/web/`, and `AURALIS_NO_BROWSER=1` makes automated smoke tests non-interactive. Neither switch changes the `/v1` surface.

## Consequences

- Typecheck and build become deterministic without duplicating the UI.
- The source-served UI and Vite artifact share product code and styling.
- The legacy modules are not yet strongly typed internally; strict typing begins at the integration boundary and expands incrementally.
- Removing the bridge requires a later task to demonstrate equivalent runtime behavior and update the architecture record.
