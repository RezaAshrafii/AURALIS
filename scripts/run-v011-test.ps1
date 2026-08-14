[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$BunPath,

  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$resolvedBun = (Resolve-Path -LiteralPath $BunPath).Path
$artifactIndex = Join-Path $repositoryRoot 'dist\web\index.html'

if (-not (Test-Path -LiteralPath $artifactIndex -PathType Leaf)) {
  throw 'The v0.11 test artifact is missing. Run: npm run build:v0.11:test'
}

if ([System.IO.Path]::GetExtension($resolvedBun) -ne '.exe') {
  throw 'BunPath must point to the trusted Windows bun.exe runtime.'
}

$env:AURALIS_USE_VITE_BUILD = '1'
if ($NoBrowser) {
  $env:AURALIS_NO_BROWSER = '1'
} else {
  Remove-Item Env:AURALIS_NO_BROWSER -ErrorAction SilentlyContinue
}

Write-Output "AURALIS v0.11 test artifact: $artifactIndex"
Write-Output 'Stop the local service with Ctrl+C after testing.'
Push-Location -LiteralPath $repositoryRoot
try {
  & $resolvedBun 'server.mjs'
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
