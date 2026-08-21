# AURALIS v0.13 — Windows Speech Gate

## Prerequisites
- Windows 10/11 x64
- Node.js 22 + npm for developer software gates / GitHub publish only (normal Portable launch does not need Node/Python)
- Rust stable 1.97.1 or newer (`rustup update stable`) for Rust/hardware gates
- Working microphone and system playback device
- Optional local whisper.cpp server for fallback validation

## Commands
Software only:
```powershell
.\RUN-V013-QUICK-GATE.cmd
```

Rust build + real audio regression:
```powershell
.\BUILD-V013-RUST-CORE.cmd
.\RUN-V013-HARDWARE-GATE.cmd
```

Optional local whisper probe:
```powershell
.\RUN-V013-LOCAL-WHISPER-GATE.cmd
```

20-minute simultaneous audio soak:
```powershell
.\RUN-V013-20MIN-HARDWARE-GATE.cmd
```

## Evidence to return
- full console output
- `capture-summary.json` for mic / loopback / both
- screenshot of System health
- one Persian segment that succeeds through Cloud ASR
- one Persian segment that succeeds through local whisper fallback

## Important
`AURALIS_EXPERIMENTAL_V013_CAPTURE=1` must not be enabled for normal use until the Rust binary emits the live event/speech contract expected by the product shell and this gate passes. The validated legacy event bridge remains the safe default.
