# v0.10.5 conformance to the Auralis v0.10 implementation prompt

## Implemented/validated in this build
- Capture-first native WASAPI validation path.
- Raw append-only spool independent of VAD/ASR.
- Explicit sequence/gap metadata.
- Correct WAVEFORMATEXTENSIBLE byte-offset parsing for derived audio analysis.
- All-channel/right-channel-safe mono derivation.
- Persistent SQLite ledger and immutable segment/transcript identities.
- Visible final transcript feed.
- Turn-specific selectable question/answer cards.
- Text-only Brain with FTS5 source grounding.
- Observable decode/VAD state: encoding, RMS, noise floor, threshold and voice state.
- Non-overlapping UI polling and reduced historical-ledger replay to address observed lag.

## Still not conformant with final Definition of Done
- Production `auralis-core.exe` is not yet Rust/windows-rs in this environment.
- Neural VAD is not yet the final implementation.
- Dedicated streaming ASR partial/stable-prefix path is not complete.
- whisper.cpp worker/reconciliation is not complete.
- Credential Manager/DPAPI migration is not complete.
- 20/60/120 minute real Windows release gates have not all been executed.

Therefore this artifact is deliberately labeled **Validation**, not flawless/stable/RC.
