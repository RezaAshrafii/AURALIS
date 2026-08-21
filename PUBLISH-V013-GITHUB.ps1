param(
  [string]$Repo = "$env:USERPROFILE\Desktop\AURALIS-FIX",
  [string]$ExpectedRemote = "https://github.com/RezaAshrafii/AURALIS.git"
)

$ErrorActionPreference = 'Stop'
$Source = [System.IO.Path]::GetFullPath($PSScriptRoot)
$Repo = [System.IO.Path]::GetFullPath($Repo)
if ($Source.TrimEnd('\') -eq $Repo.TrimEnd('\')) { throw 'Extract the v0.13 Source outside AURALIS-FIX; source and target repo must be different folders.' }

if (-not (Test-Path (Join-Path $Repo '.git'))) { throw "Git repo not found: $Repo" }
Set-Location $Repo

$remote = (git remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot read origin remote.' }
if ($remote -ne $ExpectedRemote) { throw "Unexpected origin: $remote" }

if ((git status --porcelain)) { throw 'Target repo has uncommitted changes. Clean/commit them first.' }

git checkout main
if ($LASTEXITCODE -ne 0) { throw 'checkout main failed' }
git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw 'pull --ff-only failed' }
$OriginalHead = (git rev-parse HEAD).Trim()

if ((git tag --list 'v0.13.0')) { throw 'Local tag v0.13.0 already exists.' }
$remoteTag = git ls-remote --tags origin refs/tags/v0.13.0
if ($remoteTag) { throw 'Remote tag v0.13.0 already exists.' }

try {
  # Replace the tracked working tree while preserving .git.
  Get-ChildItem -LiteralPath $Repo -Force |
    Where-Object { $_.Name -ne '.git' } |
    Remove-Item -Recurse -Force

  $exclude = @('node_modules','dist','data','.git')
  Get-ChildItem -LiteralPath $Source -Force | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $Repo -Recurse -Force
  }

  Set-Location $Repo

  git config user.name 'RezaAshrafii'
  git config user.email 'rezaashrafi361@gmail.com'

  npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
  npm test
  if ($LASTEXITCODE -ne 0) { throw 'npm test failed' }
  npm run verify
  if ($LASTEXITCODE -ne 0) { throw 'npm run verify failed' }

  # node_modules/dist/data are ignored/untracked runtime artifacts and are not release source.
  git add -A
  if (-not (git status --porcelain)) { throw 'No v0.13 changes were staged.' }

  git commit -m 'release: AURALIS v0.13.0 speech engine reliability'
  if ($LASTEXITCODE -ne 0) { throw 'commit failed' }

} catch {
  Write-Host "Publish preflight failed; restoring target repo to $OriginalHead" -ForegroundColor Yellow
  git reset --hard $OriginalHead | Out-Null
  git clean -fd | Out-Null
  throw
}

git tag -a v0.13.0 -m 'AURALIS v0.13.0 Speech Engine Reliability'
if ($LASTEXITCODE -ne 0) { throw 'tag failed' }

git push origin main
if ($LASTEXITCODE -ne 0) { throw 'main push failed' }
git push origin v0.13.0
if ($LASTEXITCODE -ne 0) { throw 'tag push failed' }

Write-Host "`nAURALIS_V013_GITHUB_PUSH=PASS" -ForegroundColor Green
git --no-pager log -5 --date=short --format='%h  %ad  %s'
