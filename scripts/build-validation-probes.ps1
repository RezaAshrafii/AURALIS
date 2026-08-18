$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$probe = Join-Path $root 'native-probe'
$out = Join-Path $root 'native'
if (!(Test-Path $probe)) {
  throw 'native-probe source is not included in this Portable package. Use the complete source repository to rebuild validation probes.'
}
New-Item -ItemType Directory -Force -Path $out | Out-Null
Push-Location $probe
try {
  $env:CGO_ENABLED='0'
  go build -trimpath -ldflags='-s -w' -o (Join-Path $out 'auralis-capture-probe.exe') .
  go build -trimpath -ldflags='-s -w' -o (Join-Path $out 'auralis-spool-inspect.exe') .\cmd\spool-inspect
} finally { Pop-Location }
Write-Host 'Validation probes built:'
Get-Item (Join-Path $out 'auralis-capture-probe.exe'), (Join-Path $out 'auralis-spool-inspect.exe') | Format-Table Name,Length,LastWriteTime
