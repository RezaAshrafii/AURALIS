$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
Push-Location $root
try {
  $version = (Get-Content (Join-Path $root 'VERSION') -Raw).Trim()
  if ($version -ne '0.14.1') { throw "Expected VERSION 0.14.1, got $version" }
  npm ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
  node --test "tests/*.test.mjs"
  if ($LASTEXITCODE -ne 0) { throw 'Node regression suite failed' }
  node scripts/run-v014-benchmarks.mjs
  if ($LASTEXITCODE -ne 0) { throw 'v0.14 intelligence benchmark failed' }
  npm run frontend:typecheck
  if ($LASTEXITCODE -ne 0) { throw 'TypeScript gate failed' }
  npm run frontend:build
  if ($LASTEXITCODE -ne 0) { throw 'Web build gate failed' }
  npm run verify
  if ($LASTEXITCODE -ne 0) { throw 'Source verification failed' }
  Write-Host 'AURALIS_V014_INTELLIGENCE_GATE_PASS'
}
finally {
  Pop-Location
}
