param([string]$Cargo = '')
$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifest = Join-Path $repoRoot 'native\Cargo.toml'
$artifactRoot = Join-Path $repoRoot 'dist\v0.14-windows-product-bridge'
$builtExecutable = Join-Path $repoRoot 'native\target\release\auralis-audio-test.exe'
$productExecutable = Join-Path $artifactRoot 'auralis-audio-bridge.exe'

if ([string]::IsNullOrWhiteSpace($Cargo) -or -not (Test-Path -LiteralPath $Cargo -PathType Leaf)) {
  $cargoCommand = Get-Command cargo -ErrorAction SilentlyContinue
  if ($null -eq $cargoCommand) { throw 'Rust cargo 1.97.0+ is required.' }
  $Cargo = $cargoCommand.Source
}

& $Cargo build --manifest-path $manifest --workspace --release --locked --bin auralis-audio-test
if ($LASTEXITCODE -ne 0) { throw "Rust release build failed: $LASTEXITCODE" }
if (-not (Test-Path -LiteralPath $builtExecutable -PathType Leaf)) {
  throw "Expected Rust executable was not produced: $builtExecutable"
}

if (Test-Path -LiteralPath $artifactRoot) { Remove-Item -LiteralPath $artifactRoot -Recurse -Force }
New-Item -ItemType Directory -Path $artifactRoot | Out-Null
Copy-Item -LiteralPath $builtExecutable -Destination $productExecutable
Copy-Item -LiteralPath (Join-Path $repoRoot 'V014_WINDOWS_PRODUCT_BRIDGE_GATE.md') -Destination (Join-Path $artifactRoot 'V014_WINDOWS_PRODUCT_BRIDGE_GATE.md')
Copy-Item -LiteralPath (Join-Path $repoRoot 'scripts\run-v014-product-bridge-gate.ps1') -Destination (Join-Path $artifactRoot 'run-v014-product-bridge-gate.ps1')

$hashLines = Get-ChildItem -LiteralPath $artifactRoot -File | Sort-Object Name | ForEach-Object {
  $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  $($_.Name)"
}
Set-Content -LiteralPath (Join-Path $artifactRoot 'SHA256SUMS.txt') -Value $hashLines -Encoding ASCII
Write-Host "AURALIS_V014_PRODUCT_BRIDGE=$productExecutable"
Write-Host 'Next: run RUN-V014-PRODUCT-BRIDGE-GATE.cmd'
