# Auralis v0.11.2 Release Gates

The following are regressions and block release:

- overall health is hard-coded DEGRADED.
- AI READY appears when `hasCredential=false` or runtime state is AUTH_REQUIRED/ERROR.
- quick setup enables ASR/Brain before provider credential/model validation.
- provider 401/403 is shown as a generic HTTP error.
- failed ASR auth creates repeated fake transcript content in the main Live Transcript.
- auth failure destroys or deletes raw captured audio.
- re-activation cannot replay ASR_FAILED segments.
- unanswered eligible Turns are lost after runtime re-activation.
- API-key-looking data appears in diagnostics payloads.
- settings cards require independent nested scrollbars on normal desktop height.
- v0.12 hardware-gate executable silently replaces the known product capture bridge.
