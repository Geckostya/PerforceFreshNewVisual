[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [Parameter(Mandatory = $true)]
    [string]$NotesFile
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
. (Join-Path $PSScriptRoot 'toolchain.ps1')
$tag = "v$Version"
$expectedRepository = 'Geckostya/PerforceFreshNewVisual'

& (Join-Path $PSScriptRoot 'verify-version.ps1') -ExpectedVersion $Version -ExpectedTag $tag
foreach ($command in @('git', 'gh', 'cargo', 'slsa-verifier')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Required release command is unavailable: $command"
    }
}
$verifierInfo = (& slsa-verifier version 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) { throw 'Could not determine the SLSA verifier version.' }
$verifierVersionMatch = [regex]::Match($verifierInfo, '(?m)^GitVersion:\s*v?(?<version>\d+\.\d+\.\d+)\s*$')
if (-not $verifierVersionMatch.Success -or [version]$verifierVersionMatch.Groups['version'].Value -lt [version]'2.7.1') {
    throw 'slsa-verifier v2.7.1 or newer is required.'
}
if (-not (Test-Path -LiteralPath $NotesFile -PathType Leaf)) {
    throw "Release notes file not found: $NotesFile"
}
if (-not (Get-Content -LiteralPath $NotesFile -Raw).Trim()) {
    throw 'Release notes must not be empty.'
}
git diff --quiet
if ($LASTEXITCODE -ne 0) { throw 'Tracked files contain uncommitted changes.' }
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { throw 'The Git index contains uncommitted changes.' }
if (git status --porcelain) { throw 'The release worktree must be completely clean.' }
git ls-files --error-unmatch -- $NotesFile | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Release notes must be committed in the release commit.' }
gh auth status
if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI authentication is required.' }
$repository = gh repo view --json nameWithOwner --jq '.nameWithOwner'
if ($LASTEXITCODE -ne 0 -or $repository.Trim() -ne $expectedRepository) {
    throw "Release publishing requires the GitHub repository $expectedRepository."
}
git rev-parse --verify --quiet "refs/tags/$tag" | Out-Null
if ($LASTEXITCODE -eq 0) { throw "Tag already exists: $tag" }
git ls-remote --exit-code --tags origin "refs/tags/$tag" | Out-Null
if ($LASTEXITCODE -eq 0) { throw "Remote tag already exists: $tag" }
if ($LASTEXITCODE -ne 2) { throw "Could not verify that remote tag $tag is unused." }
gh release view $tag | Out-Null
if ($LASTEXITCODE -eq 0) { throw "GitHub Release already exists: $tag" }

git tag --annotate $tag --file $NotesFile
if ($LASTEXITCODE -ne 0) { throw "Could not create tag $tag" }
git push origin $tag
if ($LASTEXITCODE -ne 0) { throw "Could not push tag $tag" }

$runId = $null
for ($attempt = 0; $attempt -lt 20 -and -not $runId; $attempt++) {
    $runs = gh run list --workflow release.yml --event push --limit 20 --json databaseId,headBranch | ConvertFrom-Json
    $run = $runs | Where-Object { $_.headBranch -eq $tag } | Select-Object -First 1
    if ($run) { $runId = [string]$run.databaseId }
    if (-not $runId) { Start-Sleep -Seconds 3 }
}
if (-not $runId) { throw 'The GitHub release workflow did not start.' }
gh run watch $runId --exit-status
if ($LASTEXITCODE -ne 0) { throw "Release workflow $runId failed; the release remains a draft." }

gh release edit $tag --notes-file $NotesFile
if ($LASTEXITCODE -ne 0) { throw 'Could not apply release notes; the release remains a draft.' }

$download = Join-Path ([System.IO.Path]::GetTempPath()) ("p4fnv-release-verify-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $download | Out-Null
try {
    cargo build --manifest-path src-tauri/Cargo.toml --release --bin p4fnv-release-crypto
    if ($LASTEXITCODE -ne 0) { throw 'Could not build the release verification tool.' }
    gh release download $tag --dir $download
    if ($LASTEXITCODE -ne 0) { throw 'Could not download draft release assets.' }
    $archiveName = "P4FNV_${Version}_windows_x64_portable.zip"
    $expected = @($archiveName, "$archiveName.sig", "$archiveName.intoto.jsonl", 'latest.json', 'latest.json.sig', 'SHA256SUMS.txt') | Sort-Object
    $actual = Get-ChildItem -LiteralPath $download -File | Select-Object -ExpandProperty Name | Sort-Object
    if (Compare-Object -ReferenceObject $expected -DifferenceObject $actual) {
        throw 'The draft release asset set is incomplete or contains unexpected files.'
    }
    & (Join-Path $PSScriptRoot 'verify-release-assets.ps1') -Version $Version -ReleaseDirectory $download -ExpectedTag $tag
    if ($LASTEXITCODE -ne 0) { throw 'Draft release verification failed.' }
} finally {
    Remove-Item -LiteralPath $download -Recurse -Force -ErrorAction SilentlyContinue
}

$isPrerelease = $Version.Contains('-')
$arguments = @('release', 'edit', $tag, '--draft=false')
if ($isPrerelease) { $arguments += '--prerelease' }
gh @arguments
if ($LASTEXITCODE -ne 0) { throw 'The verified release could not be published and remains a draft.' }
Write-Host "Published P4FNV $Version"
