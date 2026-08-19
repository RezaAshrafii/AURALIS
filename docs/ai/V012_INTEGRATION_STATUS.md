# v0.12 integration status

`native/core` is the v0.12 production-audio candidate. It contains the capture/spool/ledger milestone and a Windows hardware-test binary source.

The current Rust runner intentionally validates Phase 2 only. It does not yet emit the production `segment/transcript.partial/transcript.final` event stream required by the interactive UI. Therefore the server does not automatically promote it into the user-facing capture path.

This is a deliberate release gate, not a hidden fallback: set `AURALIS_EXPERIMENTAL_V012_CAPTURE=1` only for integration engineering. For normal use the existing validated event-producing bridge remains active until v0.13 implements the speech/event bridge on top of the Rust core.
