# v0.10.4 Conformance to Auralis v0.10 Implementation Prompt

## Implemented/validated in this build
- Capture-first raw WASAPI spool remains independent from VAD/ASR.
- Mic and system-loopback channels stay distinct.
- Immutable frozen segment IDs are persisted before provider calls.
- ASR jobs are persisted/idempotent by segment+provider+model.
- Transcript revisions are persisted.
- Final transcript is visible independently of Turn/Brain.
- Turn is assembled only from final text and bound to exact segment.
- Text-only Brain receives the current Turn text, not audio.
- Server-side Persian router and source-grounded RAG remain active.
- Failed/pending segments are replayable when ASR is enabled later.

## Validation-only deviations still open
- Core executable is still the Windows validation probe, not final Rust `auralis-core.exe`.
- VAD is adaptive RMS validation, not neural Silero VAD.
- Gemini Audio is an experimental segment-final adapter for testability.
- Google STT adapter is recognize/final validation, not gRPC StreamingRecognize partial/stable-prefix.
- Local whisper.cpp worker is not yet integrated.
- 20/60/120 minute soak gates are not claimed.
