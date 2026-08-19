Auralis v0.10.12 — Focused Workspace & Conversation Hub

Run: Auralis.vbs

Product workspace changes:
- current session is a minimal horizontal strip
- processing cycle is removed from the main session page and stays in System diagnostics
- recent sessions open from the top-corner Sessions drawer
- Live Transcript shows only speech transcription, newest first, with no horizontal scrollbar
- full transcript opens in a modal
- Q&A no longer duplicates in the main workspace
- all turns are available from Conversation Hub; selecting a turn only displays its already-prepared answer
- automatic answer generation remains default; Z remains an immediate/manual override

Architecture note: captured audio remains the source of truth. Neural VAD, true streaming partial/final ASR, local whisper fallback and final soak validation remain later production milestones.
