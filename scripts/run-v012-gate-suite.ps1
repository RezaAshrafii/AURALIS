param(
  [ValidateSet('Quick','Soak20')]
  [string]$Suite = 'Quick'
)

$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$buildScript = Join-Path $PSScriptRoot 'build-v012-windows-test.ps1'
$artifactRoot = Join-Path $repoRoot 'dist\v0.12-windows-audio-test'
$runner = Join-Path $artifactRoot 'run-v012-audio-test.ps1'
$verify = Join-Path $PSScriptRoot 'verify-v012-capture-summary.ps1'

Write-Host 'Building Auralis v0.12 Rust audio core...' -ForegroundColor Cyan
& $buildScript
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$results = Join-Path $artifactRoot 'hardware-results'
New-Item -ItemType Directory -Path $results -Force | Out-Null

function Run-Gate([string]$Mode,[int]$Seconds,[string]$Name) {
  $out = Join-Path $results $Name
  if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Recurse -Force }
  Write-Host "`n[$Name] mode=$Mode duration=${Seconds}s" -ForegroundColor Yellow
  if ($Mode -eq 'loopback' -or $Mode -eq 'both') {
    Write-Host 'Play continuous system audio during this run.' -ForegroundColor Yellow
  }
  if ($Mode -eq 'mic' -or $Mode -eq 'both') {
    Write-Host 'Speak periodically into the microphone during this run.' -ForegroundColor Yellow
  }
  & $runner -Mode $Mode -DurationSeconds $Seconds -OutputRoot $out
  $ec = $LASTEXITCODE
  if ($ec -ne 0) {
    Write-Host "Capture runner exit code: $ec" -ForegroundColor Red
    return $false
  }
  & $verify -Summary (Join-Path $out 'capture-summary.json') -Mode $Mode
  return ($LASTEXITCODE -eq 0)
}

$ok = $true
if ($Suite -eq 'Quick') {
  $ok = (Run-Gate mic 60 '01-mic') -and $ok
  $ok = (Run-Gate loopback 60 '02-loopback') -and $ok
  $ok = (Run-Gate both 120 '03-both') -and $ok
} else {
  $ok = (Run-Gate both 1200 '04-both-20m') -and $ok
}

if (-not $ok) {
  Write-Host "`nAURALIS_V012_GATE=FAIL" -ForegroundColor Red
  exit 1
}
Write-Host "`nAURALIS_V012_GATE=PASS" -ForegroundColor Green
Write-Host 'This validates the requested capture run conditions only; it is not a substitute for the full 120-minute release soak.'
exit 0
