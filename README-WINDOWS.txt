Auralis v0.11.0 — Engineering Foundation

Source test build:
1. npm ci --ignore-scripts
2. npm run build:v0.11:test
3. Follow docs/V011_TEST_PROCEDURE.md with a trusted external bun.exe.

The prior v0.10.12 portable baseline can still be launched with its Auralis.vbs.
Generated runtimes, binaries, databases, and dist output are not source files.

Product workspace changes:
- current session is a minimal horizontal strip
- processing cycle is removed from the main session page and stays in System diagnostics
- recent sessions open from the top-corner Sessions drawer
- Live Transcript shows only speech transcription, newest first, with no horizontal scrollbar
- full transcript opens in a modal
- Q&A no longer duplicates in the main workspace
- all turns are available from Conversation Hub; selecting a turn only displays its already-prepared answer
- automatic answer generation remains default; Z remains an immediate/manual override

Engineering foundation:
- authoritative CURRENT contracts remain versioned and source-tested
- React 18 UI has a strict TypeScript + Vite build boundary without a visual redesign
- the deterministic test builder compares two byte-identical frontend builds
- the unchanged loopback /v1 service can serve either the source UI or generated test UI

Architecture note: captured audio remains the source of truth. Production Rust WASAPI, neural VAD, true streaming partial/final ASR, local whisper fallback and final soak validation remain later milestones.
