param(
  [Parameter(Mandatory = $true)]
  [string]$Summary,
  [ValidateSet('mic','loopback','both')]
  [string]$Mode = 'both'
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Summary -PathType Leaf)) {
  throw "Missing capture summary: $Summary"
}
$data = Get-Content -LiteralPath $Summary -Raw | ConvertFrom-Json
$failures = [System.Collections.Generic.List[string]]::new()

if ($data.result -ne 'CAPTURE_COMPLETE') { $failures.Add("result=$($data.result)") }
if ([int64]$data.unknown_gap_count -ne 0) { $failures.Add("unknown_gap_count=$($data.unknown_gap_count)") }

$requiredKinds = switch ($Mode) {
  'mic' { @('microphone') }
  'loopback' { @('system-loopback') }
  default { @('microphone','system-loopback') }
}

foreach ($kind in $requiredKinds) {
  $ch = @($data.channels | Where-Object { [string]$_.format.source_kind -eq $kind }) | Select-Object -First 1
  if ($null -eq $ch) {
    $failures.Add("missing channel: $kind")
    continue
  }
  if ([int64]$ch.durable_sequence -le 0) { $failures.Add("$kind durable_sequence=$($ch.durable_sequence)") }
  if ([int64]$ch.queue.dropped_buffers -ne 0) { $failures.Add("$kind dropped_buffers=$($ch.queue.dropped_buffers)") }
  if ([int64]$ch.queue.dropped_samples -ne 0) { $failures.Add("$kind dropped_samples=$($ch.queue.dropped_samples)") }
  if ([int64]$ch.energy.raw_bytes -le 0) { $failures.Add("$kind raw_bytes=$($ch.energy.raw_bytes)") }
}

Write-Host "AURALIS v0.12 capture summary" -ForegroundColor Cyan
Write-Host "  mode: $Mode"
Write-Host "  result: $($data.result)"
Write-Host "  unknown gaps: $($data.unknown_gap_count)"
foreach ($ch in @($data.channels)) {
  Write-Host ("  {0}: seq={1} dropped_buffers={2} dropped_samples={3} raw_bytes={4}" -f $ch.format.source_kind,$ch.durable_sequence,$ch.queue.dropped_buffers,$ch.queue.dropped_samples,$ch.energy.raw_bytes)
}

if ($failures.Count -gt 0) {
  Write-Host 'GATE_RESULT=FAIL' -ForegroundColor Red
  $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  exit 1
}
Write-Host 'GATE_RESULT=PASS' -ForegroundColor Green
exit 0
