# Auralis v0.12 — Windows Audio Hardware Gate

This gate validates only the Rust production capture/spool/ledger milestone. It does **not** claim neural VAD, streaming ASR, or v1 product readiness.

## Build

```powershell
cd <repo>
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-v012-windows-test.ps1
```

## Required tests

Run each in a fresh output directory:

```powershell
$kit = ".\dist\v0.12-windows-audio-test\run-v012-audio-test.ps1"
& $kit -Mode mic      -DurationSeconds 60  -OutputRoot ".\dist\v0.12-windows-audio-test\hardware-results\01-mic"
& $kit -Mode loopback -DurationSeconds 60  -OutputRoot ".\dist\v0.12-windows-audio-test\hardware-results\02-loopback"
& $kit -Mode both     -DurationSeconds 120 -OutputRoot ".\dist\v0.12-windows-audio-test\hardware-results\03-both"
```

During loopback/both, play continuous audio. During mic/both, speak periodically and include a quiet passage.

## PASS conditions

For every completed run inspect `capture-summary.json`:

- `result == CAPTURE_COMPLETE`
- `hardware_pass_claimed == false` is expected; human/CI decides PASS.
- requested channels exist and have `durable_sequence > 0`.
- `queue.dropped_buffers == 0` and `queue.dropped_samples == 0` for the acceptance run.
- `unknown_gap_count == 0` for uninterrupted runs.
- raw spool files exist and byte counts are non-zero.
- SQLite ledger opens and chunk sequence ranges are strictly increasing/non-overlapping per channel.
- right-channel-only fixture/regression remains covered before release.

## Lifecycle test

Start a longer mic or both run, disconnect/reconnect the endpoint or trigger sleep/resume. The run may exit with code `20` (`RESUME_REQUIRED`). Re-run the same command with `-Resume` after the endpoint is available. The interruption must be durable and must not become silent loss.

## 20-minute gate

Before promoting v0.12 to release candidate:

```powershell
& $kit -Mode both -DurationSeconds 1200 -OutputRoot ".\dist\v0.12-windows-audio-test\hardware-results\04-both-20m"
```

Required: unknown sample gaps `0`, queue loss `0`, both channels durable, process remains responsive, and no unbounded memory growth observed.

## Evidence to return

Return these files/directories, not raw private audio unless explicitly intended:

- `capture-summary.json`
- `logs\capture.log`
- `session-state.json`
- SHA-256 of `audio-ledger.sqlite`
- screenshot of Task Manager memory at start/end of the 20-minute run

Do not call v0.12 hardware PASS if these real Windows tests were not actually run.
