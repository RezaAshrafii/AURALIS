param(
  [switch]$RunAudioHardware,
  [switch]$AllowRustSkip,
  [ValidateSet('Quick','Soak20')]
  [string]$AudioSuite = 'Quick',
  [string]$LocalWhisperUrl = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location $repoRoot

function Run-Step([string]$Name, [scriptblock]$Action) {
  Write-Host "`n== $Name ==" -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
}

Run-Step 'JS/contract regression suite' { npm test }
Run-Step 'TypeScript typecheck' { npm run frontend:typecheck }
Run-Step 'Deterministic web build' { npm run frontend:build }
Run-Step 'Repository verifier' { npm run verify }

$cargo = Get-Command cargo -ErrorAction SilentlyContinue
if ($null -ne $cargo) {
  Run-Step 'Rust fmt' { cargo fmt --manifest-path native/Cargo.toml --all -- --check }
  Run-Step 'Rust clippy' { cargo clippy --manifest-path native/Cargo.toml --workspace --all-targets --locked -- -D warnings }
  Run-Step 'Rust tests' { cargo test --manifest-path native/Cargo.toml --workspace --locked }
  Write-Host 'RUST_GATE=PASS' -ForegroundColor Green
} else {
  if (-not $AllowRustSkip) { throw 'RUST_GATE=FAIL (cargo not found). Use -AllowRustSkip only for a non-release JS-only diagnostic run.' }
  Write-Host "`nRUST_GATE=SKIP_NON_RELEASE (cargo not found)" -ForegroundColor Yellow
}

if (-not [string]::IsNullOrWhiteSpace($LocalWhisperUrl)) {
  $uri = [Uri]$LocalWhisperUrl
  $allowed = @('127.0.0.1','localhost','::1')
  if ($uri.Scheme -ne 'http' -or $allowed -notcontains $uri.Host) {
    throw 'LocalWhisperUrl must be loopback HTTP only.'
  }
  Write-Host "`n== Local whisper.cpp probe ==" -ForegroundColor Cyan
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $LocalWhisperUrl -TimeoutSec 3
    Write-Host "LOCAL_WHISPER_GATE=PASS HTTP=$($response.StatusCode)" -ForegroundColor Green
  } catch {
    if ($_.Exception.Response) {
      Write-Host 'LOCAL_WHISPER_GATE=PASS (HTTP listener reachable)' -ForegroundColor Green
    } else {
      throw "Local whisper.cpp is not reachable: $($_.Exception.Message)"
    }
  }
} else {
  Write-Host "`nLOCAL_WHISPER_GATE=SKIP (no URL supplied)" -ForegroundColor Yellow
}

if ($RunAudioHardware) {
  Write-Host "`n== v0.12 audio regression hardware suite ==" -ForegroundColor Cyan
  & (Join-Path $PSScriptRoot 'run-v012-gate-suite.ps1') -Suite $AudioSuite
  if ($LASTEXITCODE -ne 0) { throw 'Audio hardware regression gate failed.' }
}

Write-Host "`nAURALIS_V013_SOFTWARE_GATE=PASS" -ForegroundColor Green
Write-Host 'Neural Silero inference and cloud gRPC partial latency remain separate Windows release gates; see V013_WINDOWS_SPEECH_GATE.md.'
