param(
  [string]$Cargo = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$artifactRoot = Join-Path $repoRoot 'dist\v0.12-windows-audio-test'
$manifest = Join-Path $repoRoot 'native\Cargo.toml'
$builtExecutable = Join-Path $repoRoot 'native\target\release\auralis-audio-test.exe'

if ([string]::IsNullOrWhiteSpace($Cargo) -or -not (Test-Path -LiteralPath $Cargo -PathType Leaf)) {
  $cargoCommand = Get-Command cargo -ErrorAction SilentlyContinue
  if ($null -eq $cargoCommand) {
    throw 'Rust cargo is required. Install the pinned stable toolchain or pass -Cargo with its absolute path.'
  }
  $Cargo = $cargoCommand.Source
}

& $Cargo build --manifest-path $manifest --workspace --release --locked --bin auralis-audio-test
if ($LASTEXITCODE -ne 0) {
  throw "Release build failed with exit code $LASTEXITCODE"
}
if (-not (Test-Path -LiteralPath $builtExecutable -PathType Leaf)) {
  throw "Release executable was not produced: $builtExecutable"
}

$resolvedArtifactRoot = [System.IO.Path]::GetFullPath($artifactRoot)
$expectedPrefix = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'dist')) + [System.IO.Path]::DirectorySeparatorChar
if (-not $resolvedArtifactRoot.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to replace artifact path outside repository dist: $resolvedArtifactRoot"
}
if (Test-Path -LiteralPath $resolvedArtifactRoot) {
  Remove-Item -LiteralPath $resolvedArtifactRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $resolvedArtifactRoot | Out-Null

Copy-Item -LiteralPath $builtExecutable -Destination (Join-Path $resolvedArtifactRoot 'auralis-audio-test.exe')
Copy-Item -LiteralPath (Join-Path $repoRoot 'scripts\run-v012-audio-test.ps1') -Destination (Join-Path $resolvedArtifactRoot 'run-v012-audio-test.ps1')
Copy-Item -LiteralPath (Join-Path $repoRoot 'scripts\verify-v012-capture-summary.ps1') -Destination (Join-Path $resolvedArtifactRoot 'verify-v012-capture-summary.ps1')
Copy-Item -LiteralPath (Join-Path $repoRoot 'docs\testing\V012_WINDOWS_AUDIO_GATE.md') -Destination (Join-Path $resolvedArtifactRoot 'HARDWARE-TEST-CHECKLIST.md')

$readme = @'
AURALIS v0.12 Production Windows Audio Core — REAL_WINDOWS_HARDWARE test build

This package does not claim hardware PASS automatically.
Run the commands in HARDWARE-TEST-CHECKLIST.md and return the requested evidence.
The executable writes raw audio, SQLite WAL state, logs, and capture-summary.json under the chosen output directory.
'@
Set-Content -LiteralPath (Join-Path $resolvedArtifactRoot 'README.txt') -Value $readme -Encoding UTF8

$hashLines = Get-ChildItem -LiteralPath $resolvedArtifactRoot -File |
  Sort-Object Name |
  ForEach-Object {
    $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $($_.Name)"
  }
Set-Content -LiteralPath (Join-Path $resolvedArtifactRoot 'SHA256SUMS.txt') -Value $hashLines -Encoding ASCII

Write-Host "TEST BUILD: $resolvedArtifactRoot"
Write-Host "START: powershell -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $resolvedArtifactRoot 'run-v012-audio-test.ps1')`" -Mode both -DurationSeconds 60 -OutputRoot `"$(Join-Path $resolvedArtifactRoot 'hardware-results\03-both')`""
