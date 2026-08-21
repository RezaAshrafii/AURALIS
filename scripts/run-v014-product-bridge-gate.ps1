param(
  [ValidateRange(8, 60)][int]$DurationSeconds = 12,
  [ValidateRange(2, 10)][int]$ChunkSeconds = 3
)
$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$exe = Join-Path $repoRoot 'dist\v0.14-windows-product-bridge\auralis-audio-bridge.exe'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
  throw 'Product bridge is missing. Run BUILD-V014-PRODUCT-BRIDGE.cmd first.'
}

$gateId = 'gate-' + [Guid]::NewGuid().ToString('N')
$gateRoot = Join-Path $repoRoot (Join-Path 'data\hardware-gates' $gateId)
$captureRoot = Join-Path $gateRoot 'capture'
$stdoutPath = Join-Path $gateRoot 'events.jsonl'
$stderrPath = Join-Path $gateRoot 'stderr.log'
New-Item -ItemType Directory -Path $gateRoot -Force | Out-Null

$process = Start-Process -FilePath $exe -ArgumentList @(
  'capture', '--mode', 'mic', '--duration-seconds', [string]$DurationSeconds,
  '--output', $captureRoot, '--chunk-seconds', [string]$ChunkSeconds,
  '--event-protocol', 'jsonl-v1', '--event-session-id', $gateId
) -Wait -PassThru -NoNewWindow -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
if ($process.ExitCode -ne 0) {
  $detail = if (Test-Path -LiteralPath $stderrPath) { (Get-Content -LiteralPath $stderrPath -Raw).Trim() } else { '' }
  throw "Product bridge exited with code $($process.ExitCode). $detail"
}

$events = @()
foreach ($line in Get-Content -LiteralPath $stdoutPath) {
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  try { $event = $line | ConvertFrom-Json -ErrorAction Stop }
  catch { throw "Non-JSON stdout violates jsonl-v1: $line" }
  if ($event.protocol -ne 'auralis.native/jsonl-v1') { throw 'Unexpected native event protocol.' }
  if ($event.session_id -ne $gateId) { throw 'Native event session binding mismatch.' }
  $events += $event
}

$started = @($events | Where-Object { $_.type -eq 'capture.channel_started' -and $_.channel_id -eq 'user-mic' })
$heartbeats = @($events | Where-Object { $_.type -eq 'probe.heartbeat' })
$chunks = @($events | Where-Object { $_.type -eq 'audio.chunk_closed' -and $_.channel_id -eq 'user-mic' })
$stopped = @($events | Where-Object { $_.type -eq 'capture.channel_stopped' -and $_.channel_id -eq 'user-mic' })
if ($started.Count -lt 1) { throw 'No capture.channel_started event was observed.' }
if ($heartbeats.Count -lt 1) { throw 'No probe.heartbeat event was observed.' }
if ($chunks.Count -lt 1) { throw 'No durable audio.chunk_closed event was observed. Speak during the gate and retry.' }
if ($stopped.Count -lt 1) { throw 'No capture.channel_stopped event was observed.' }

foreach ($event in $chunks) {
  $payload = $event.payload
  $path = [string]$payload.path
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Chunk file is missing: $path" }
  $item = Get-Item -LiteralPath $path
  if ([int64]$payload.byte_length -ne $item.Length) { throw "Chunk byte length mismatch: $path" }
  $sha = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($sha -ne ([string]$payload.sha256).ToLowerInvariant()) { throw "Chunk SHA-256 mismatch: $path" }
  if ([string]::IsNullOrWhiteSpace([string]$payload.sample_format)) { throw 'Chunk sample_format is missing.' }
}

Write-Host "AURALIS_V014_PRODUCT_BRIDGE_GATE_PASS chunks=$($chunks.Count) events=$($events.Count)"
Write-Host "Gate evidence: $gateRoot"
