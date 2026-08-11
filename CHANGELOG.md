# Auralis v0.10.4 — Live Transcript Validation

## Added
- Visible **Live Transcript** feed in Session view.
- Segment states are visible before a Turn exists: FROZEN, RUNNING, FINAL, FAILED/EMPTY.
- One-click **Audio→Text + Brain** runtime setup using one Gemini API key kept in RAM only.
- Enabling ASR automatically queues already-frozen, untranscribed segments instead of losing them.
- Turn cards are selectable and expand their own full answer when selected.
- Exact question/answer binding remains per Turn ID.
- Transcript timeline endpoint: `/v1/sessions/{id}/transcripts`.
- Lower validation VAD thresholds for quiet Persian speech and `vad.level` telemetry.

## Preserved
- Capture-first: raw WASAPI audio is spooled before VAD/ASR.
- Immutable frozen segment IDs.
- Persistent SQLite ledger and explicit gap records.
- Server-side Persian router.
- Text-only Brain; audio is not sent to the answer-generation Brain path.
- FTS5 source grounding and citation allowlist.

## Not claimed
- This is not the final Rust production core.
- Gemini Audio is an experimental segment-final transcription adapter for testability, not the production transcript source of truth.
- Neural VAD, gRPC streaming partials, whisper.cpp worker and 120-minute release gate remain pending.
