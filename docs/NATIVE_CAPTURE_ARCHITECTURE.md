# Auralis v0.10.3 — Capture-first Segment/ASR Validation Architecture

```text
Mic WASAPI ─────────────┐
System WASAPI Loopback ─┼─> Raw Frame Queue ─> Append-only Spool ─> Audio Ledger
                        │
                        └─> Derived Analysis Queue
                              └─> Downmix all channels
                                   └─> Adaptive VAD validation
                                        └─> Immutable Frozen Segment
                                             └─> derived mono 16k WAV
                                                  ├─> Google STT V2 final-segment adapter
                                                  └─> Gemini Audio EXPERIMENTAL adapter
                                                        ↓
                                                  Transcript Revision
                                                        ↓
                                                     Turn
                                                        ↓
                                               FTS5 + Text Brain
```

The analysis queue is derived and cannot block the raw spool path. Segment failure or ASR failure does not delete the original captured audio.

Loopback silence is not automatically equivalent to lost samples. A render endpoint may stop producing loopback packets during silence; those spans are represented explicitly as silence when safe, while real discontinuity/overflow remains a Gap.

Production target remains Rust `auralis-core.exe` with neural VAD, durable jobs, and Google Cloud `StreamingRecognize` partial/stable-prefix flow.
