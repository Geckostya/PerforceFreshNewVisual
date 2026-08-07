[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [Parameter(Mandatory = $true)]
    [string]$NotesFile,
    [switch]$ResumeDraft,
    [switch]$VerifyDraftOnly,
    [string]$WorkflowRunId
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
. (Join-Path $PSScriptRoot 'toolchain.ps1')
$tag = "v$Version"
$expectedRepository = 'Geckostya/PerforceFreshNewVisual'

function Normalize-ReleaseText {
    param([AllowEmptyString()][string]$Text)
    return (($Text -replace "`r`n?", "`n").Trim())
}

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
$releaseNotes = Normalize-ReleaseText (Get-Content -LiteralPath $NotesFile -Raw)
if (-not $releaseNotes) {
    throw 'Release notes must not be empty.'
}
$legacyTagNotes = Normalize-ReleaseText (($releaseNotes | git stripspace --strip-comments | Out-String))
if ($LASTEXITCODE -ne 0) { throw 'Could not normalize release notes for tag verification.' }
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
$runId = $null
$draftNeedsNotes = $false
if ($WorkflowRunId -and -not $ResumeDraft) {
    throw 'WorkflowRunId requires ResumeDraft.'
}
if ($ResumeDraft) {
    $tagType = git cat-file -t "refs/tags/$tag" 2>$null
    if ($LASTEXITCODE -ne 0 -or $tagType.Trim() -ne 'tag') {
        throw "The local release tag is missing or is not annotated: $tag"
    }
    $localTagCommit = (git rev-parse "$tag^{commit}").Trim()
    if ($LASTEXITCODE -ne 0) { throw "Could not resolve local tag $tag." }
    $remoteTag = git ls-remote origin "refs/tags/$tag^{}"
    if ($LASTEXITCODE -ne 0 -or -not $remoteTag) { throw "Remote annotated tag is missing: $tag" }
    $remoteTagCommit = ([string]($remoteTag | Select-Object -First 1)).Split("`t")[0].Trim()
    if ($remoteTagCommit -ne $localTagCommit) { throw "Local and remote tag commits differ for $tag." }
    git merge-base --is-ancestor $localTagCommit HEAD
    if ($LASTEXITCODE -ne 0) { throw "The release tag $tag is not an ancestor of HEAD." }
    $tagNotes = Normalize-ReleaseText (git tag -l $tag --format='%(contents)' | Out-String)
    if ($LASTEXITCODE -ne 0 -or ($tagNotes -ne $releaseNotes -and $tagNotes -ne $legacyTagNotes)) {
        throw "Release notes do not match the annotated tag $tag."
    }
    $releaseJson = gh release view $tag --json body,isDraft,tagName 2>$null
    if ($LASTEXITCODE -ne 0) { throw "Draft GitHub Release not found: $tag" }
    $release = $releaseJson | ConvertFrom-Json
    if (-not $release.isDraft -or [string]$release.tagName -ne $tag) {
        throw "GitHub Release $tag is not the expected draft."
    }
    $draftNotes = Normalize-ReleaseText ([string]$release.body)
    if ($draftNotes -and $draftNotes -ne $releaseNotes) {
        throw "GitHub Release notes do not match ${NotesFile}."
    }
    $draftNeedsNotes = -not $draftNotes
    if ($WorkflowRunId) {
        $run = gh run view $WorkflowRunId --json databaseId,displayTitle,name | ConvertFrom-Json
        if ($LASTEXITCODE -ne 0 -or [string]$run.displayTitle -ne "Portable release $tag") {
            throw "Workflow run $WorkflowRunId is not the expected release run for $tag."
        }
        $runId = [string]$run.databaseId
    } else {
        $runs = gh run list --workflow release.yml --event push --limit 50 --json databaseId,headBranch | ConvertFrom-Json
        $run = $runs | Where-Object { $_.headBranch -eq $tag } | Select-Object -First 1
        if ($run) { $runId = [string]$run.databaseId }
    }
} else {
    git rev-parse --verify --quiet "refs/tags/$tag" | Out-Null
    if ($LASTEXITCODE -eq 0) { throw "Tag already exists: $tag" }
    git ls-remote --exit-code --tags origin "refs/tags/$tag" | Out-Null
    if ($LASTEXITCODE -eq 0) { throw "Remote tag already exists: $tag" }
    if ($LASTEXITCODE -ne 2) { throw "Could not verify that remote tag $tag is unused." }
    gh release view $tag | Out-Null
    if ($LASTEXITCODE -eq 0) { throw "GitHub Release already exists: $tag" }

    git tag --cleanup=verbatim --annotate $tag --file $NotesFile
    if ($LASTEXITCODE -ne 0) { throw "Could not create tag $tag" }
    git push origin $tag
    if ($LASTEXITCODE -ne 0) { throw "Could not push tag $tag" }

    for ($attempt = 0; $attempt -lt 20 -and -not $runId; $attempt++) {
        $runs = gh run list --workflow release.yml --event push --limit 20 --json databaseId,headBranch | ConvertFrom-Json
        $run = $runs | Where-Object { $_.headBranch -eq $tag } | Select-Object -First 1
        if ($run) { $runId = [string]$run.databaseId }
        if (-not $runId) { Start-Sleep -Seconds 3 }
    }
}
if (-not $runId) { throw "The GitHub release workflow for $tag was not found." }
gh run watch $runId --exit-status
if ($LASTEXITCODE -ne 0) { throw "Release workflow $runId failed; the release remains a draft." }

if (-not $ResumeDraft -or $draftNeedsNotes) {
    gh release edit $tag --notes-file $NotesFile
    if ($LASTEXITCODE -ne 0) { throw 'Could not apply release notes; the release remains a draft.' }
}

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

if ($VerifyDraftOnly) {
    Write-Host "Verified draft P4FNV $Version"
    return
}

$isPrerelease = $Version.Contains('-')
$arguments = @('release', 'edit', $tag, '--draft=false')
if ($isPrerelease) { $arguments += '--prerelease' }
gh @arguments
if ($LASTEXITCODE -ne 0) { throw 'The verified release could not be published and remains a draft.' }
Write-Host "Published P4FNV $Version"
