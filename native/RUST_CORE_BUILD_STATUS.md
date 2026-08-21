# Rust Core Build Status — v0.13.0

Source milestone: implemented.

Current Linux build environment does not contain `cargo`/`rustc`, so Rust compilation or Windows WASAPI hardware PASS is **not** claimed by this package build.

The crate declares Rust `1.97` / edition `2024`. On Windows run:

```powershell
.\BUILD-V013-RUST-CORE.cmd
.\RUN-V013-QUICK-GATE.cmd
.\RUN-V013-HARDWARE-GATE.cmd
```

The default interactive product capture path remains the validated WASAPI bridge. The experimental Rust speech bridge is gated behind `AURALIS_EXPERIMENTAL_V013_CAPTURE=1` until the Windows speech/audio gates pass.

Current v0.13 boundary: transcript revision protocol, durable speech-event ledger, local whisper.cpp fallback adapter, and neural-VAD boundary/state machine are implemented; Silero ONNX inference and true cloud streaming partial transport are release-gated follow-up work.
