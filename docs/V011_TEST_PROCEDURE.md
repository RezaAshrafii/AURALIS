# AURALIS v0.11.0 Test Artifact Procedure

This procedure builds and runs the v0.11 Engineering Foundation UI against the unchanged loopback `/v1` service. It is an INTEGRATION smoke test, not REAL_WINDOWS_HARDWARE validation of microphone, loopback, VAD, or ASR.

## TEST BUILD

From `C:\Users\Reza\Desktop\AURALIS-AUR-1101`:

```powershell
npm ci --ignore-scripts
npm run build:v0.11:test
```

Expected runnable artifact:

```text
C:\Users\Reza\Desktop\AURALIS-AUR-1101\dist\web\index.html
```

Expected deterministic manifest:

```text
C:\Users\Reza\Desktop\AURALIS-AUR-1101\dist\v0.11-test-manifest.json
```

Both paths are generated and ignored. They must not be committed or treated as release archives.

## START

Use the trusted Bun runtime from the prior portable build without copying it into this source worktree:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-v011-test.ps1 -BunPath "C:\Users\Reza\Desktop\Auralis_v0.10.12_Focused_Workspace_Conversation_Hub_Windows_x64_Portable\runtime\bun.exe"
```

The service binds to `http://127.0.0.1:47832/` and opens the browser. Stop it with Ctrl+C after the checklist.

## TEST

1. Confirm the header shows `v0.11.0 · Engineering Foundation` and the footer connection becomes `online`.
2. Open Session, Sources, Settings, and System; confirm each primary view renders without an error screen.
3. In Session, confirm Mic and System Audio controls, mode selection, Live Transcript, Conversation Hub, and Turn Inspector remain present.
4. Toggle the light/dark theme and confirm the layout remains usable; return to the preferred theme.
5. Open System and confirm component health and capability sections render. Do not interpret `DEGRADED` from absent native/provider configuration as a frontend build failure.
6. Do not enter an API key and do not start audio capture for this v0.11 engineering gate.
7. Return to Session, confirm there are no duplicated Q&A rails or developer telemetry in the central workspace, then stop the service with Ctrl+C.

## EXPECTED

- The build command reports two identical Vite builds, all tests passing, and exact artifact/manifest paths.
- The generated UI matches the preserved v0.10.12 product layout with v0.11.0 engineering metadata.
- Navigation is responsive, the UI connects to the unchanged `/v1` polling service, and no fatal UI recovery screen appears.
- No credential, runtime database, captured audio, binary, or generated artifact becomes tracked source.

## FAILURE DATA TO RETURN

- The full failing command and terminal output from the first `[v0.11]` failure onward.
- Whether the failure occurred during typecheck, frontend test, build pass 1, build pass 2/determinism comparison, regression tests, launch, or browser smoke.
- A screenshot of the visible UI failure, if rendering failed.
- Browser console error text, if available, with any private content removed.
- `git rev-parse HEAD`, `node --version`, and `npm --version`.
- Do not return API keys, tokens, raw audio, private transcripts, runtime databases, or unredacted private source content.
