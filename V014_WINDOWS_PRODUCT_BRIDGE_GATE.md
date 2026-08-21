# AURALIS v0.14.1 Windows Product Audio Bridge Gate

This gate proves the product-facing path that v0.13 did not provide:

1. Direct WASAPI microphone capture starts.
2. The bounded capture queue remains off the persistence/UI path.
3. A raw chunk is fsync'd and committed to the native SQLite ledger.
4. Only then is an `audio.chunk_closed` JSONL event emitted.
5. The event is bound to the requested product session and contains format, sequence, path, byte length, and SHA-256 metadata.

Run from the repository root on Windows:

```powershell
.\BUILD-V014-PRODUCT-BRIDGE.cmd
.\RUN-V014-PRODUCT-BRIDGE-GATE.cmd
```

Passing this gate does not claim ASR provider availability. The final UI smoke test still requires a valid configured ASR provider and a spoken Persian sentence.
