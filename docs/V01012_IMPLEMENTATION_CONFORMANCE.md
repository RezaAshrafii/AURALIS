# Auralis v0.10.12 — Implementation Conformance

## What changed
This milestone changes the user-facing workspace hierarchy only:
- main processing-cycle rail removed from Session and retained in System diagnostics;
- recent-session cards moved to a top-corner drawer;
- current session condensed to a horizontal summary strip;
- Live Transcript is newest-first, transcription-only, with a full transcript modal;
- duplicated main Q&A list removed;
- Conversation Hub modal provides all turns and answer readiness;
- Turn Inspector remains the detailed answer/source view.

## What intentionally did not change
- WASAPI validation capture path
- persistent raw audio / ledger
- segment identity and retranscription
- ASR retry behavior
- Persian routing and turn ownership
- server-owned auto-answer generation
- RAG index and citation validation
- Z hotkey semantics

## Conformance to v0.10 architecture
The source of truth remains captured audio; text and answers are derived artifacts. Processing telemetry remains observable, but it is moved out of the primary product surface as requested. The remaining architecture milestones are true streaming ASR partial/final, neural VAD, local ASR fallback, and soak validation.
