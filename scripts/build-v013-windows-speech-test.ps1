param([string]$Cargo = '')
$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifest = Join-Path $repoRoot 'native\Cargo.toml'
$artifactRoot = Join-Path $repoRoot 'dist\v0.13-windows-speech-test'
$builtExecutable = Join-Path $repoRoot 'native\target\release\auralis-audio-test.exe'

if ([string]::IsNullOrWhiteSpace($Cargo) -or -not (Test-Path -LiteralPath $Cargo -PathType Leaf)) {
  $cargoCommand = Get-Command cargo -ErrorAction SilentlyContinue
  if ($null -eq $cargoCommand) { throw 'Rust cargo 1.97.1+ is required.' }
  $Cargo = $cargoCommand.Source
}

& $Cargo build --manifest-path $manifest --workspace --release --locked --bin auralis-audio-test
if ($LASTEXITCODE -ne 0) { throw "Rust release build failed: $LASTEXITCODE" }

if (Test-Path $artifactRoot) { Remove-Item $artifactRoot -Recurse -Force }
New-Item -ItemType Directory -Path $artifactRoot | Out-Null
Copy-Item $builtExecutable (Join-Path $artifactRoot 'auralis-audio-test.exe')
Copy-Item (Join-Path $repoRoot 'V013_WINDOWS_SPEECH_GATE.md') (Join-Path $artifactRoot 'V013_WINDOWS_SPEECH_GATE.md')
Copy-Item (Join-Path $repoRoot 'scripts\run-v013-speech-gate.ps1') (Join-Path $artifactRoot 'run-v013-speech-gate.ps1')
Copy-Item (Join-Path $repoRoot 'scripts\run-v012-audio-test.ps1') (Join-Path $artifactRoot 'run-v012-audio-test.ps1')

$hashLines = Get-ChildItem $artifactRoot -File | Sort-Object Name | ForEach-Object {
  $hash=(Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  $($_.Name)"
}
Set-Content (Join-Path $artifactRoot 'SHA256SUMS.txt') $hashLines -Encoding ASCII
Write-Host "AURALIS_V013_WINDOWS_BUILD=$artifactRoot"
