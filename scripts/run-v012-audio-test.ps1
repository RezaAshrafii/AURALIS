param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('mic', 'loopback', 'both')]
  [string]$Mode,

  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 86400)]
  [int]$DurationSeconds,

  [Parameter(Mandatory = $true)]
  [string]$OutputRoot,

  [switch]$Resume
)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$executable = Join-Path $scriptRoot 'auralis-audio-test.exe'
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
  throw "Missing test executable: $executable"
}

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputRoot)
$arguments = @(
  'capture',
  '--mode', $Mode,
  '--duration-seconds', $DurationSeconds,
  '--output', $resolvedOutput
)
if ($Resume) {
  $arguments += '--resume'
}

Write-Host "AURALIS v0.12 Windows audio test"
Write-Host "Mode: $Mode"
Write-Host "Duration: $DurationSeconds seconds"
Write-Host "Artifacts: $resolvedOutput"
& $executable @arguments
$testExitCode = $LASTEXITCODE
if ($testExitCode -eq 20) {
  Write-Host 'A device/power interruption was persisted. Re-run this command with -Resume after the endpoint is available.' -ForegroundColor Yellow
}
exit $testExitCode
