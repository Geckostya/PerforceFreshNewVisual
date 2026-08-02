[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [Parameter(Mandatory = $true)]
    [string]$ReleaseDirectory,
    [string]$ExpectedRepository = 'github.com/Geckostya/PerforceFreshNewVisual',
    [string]$ExpectedTag,
    [string]$CryptoTool
)

$ErrorActionPreference = "Stop"
if (-not $ExpectedTag) { $ExpectedTag = "v$Version" }
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $CryptoTool) {
    $CryptoTool = Join-Path $projectRoot 'src-tauri/target/release/p4fnv-release-crypto.exe'
}
$directory = [System.IO.Path]::GetFullPath($ReleaseDirectory)
$archiveName = "P4FNV_${Version}_windows_x64_portable.zip"
$provenanceName = "$archiveName.intoto.jsonl"
$expectedAssets = @($archiveName, "$archiveName.sig", $provenanceName, 'latest.json', 'latest.json.sig', 'SHA256SUMS.txt')

function Get-Sha256([string]$Path) {
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($Path)
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}
foreach ($asset in $expectedAssets) {
    $path = Join-Path $directory $asset
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Release asset is missing: $asset"
    }
}
if (-not $env:P4FNV_UPDATE_PUBLIC_KEY) {
    throw 'P4FNV_UPDATE_PUBLIC_KEY is required to verify release signatures.'
}
if (-not (Test-Path -LiteralPath $CryptoTool -PathType Leaf)) {
    throw "P4FNV release crypto tool not found: $CryptoTool"
}
if (-not (Get-Command slsa-verifier -ErrorAction SilentlyContinue)) {
    throw 'slsa-verifier v2.7.1 or newer is required to verify release provenance.'
}

$archivePath = Join-Path $directory $archiveName
$metadataPath = Join-Path $directory 'latest.json'
$expanded = Join-Path $directory '.verify-archive'
try {
    foreach ($signed in @(
        @{ Data = $archivePath; Signature = "$archivePath.sig" },
        @{ Data = $metadataPath; Signature = "$metadataPath.sig" }
    )) {
        & $CryptoTool verify $env:P4FNV_UPDATE_PUBLIC_KEY $signed.Data $signed.Signature
        if ($LASTEXITCODE -ne 0) { throw "Signature verification failed: $($signed.Data)" }
    }

    $hash = Get-Sha256 $archivePath
    $expectedHashLine = "$hash  $archiveName"
    if ((Get-Content -LiteralPath (Join-Path $directory 'SHA256SUMS.txt') -Raw).Trim() -ne $expectedHashLine) {
        throw 'SHA256SUMS.txt does not match the portable archive.'
    }
    $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
    if ([string]$metadata.version -ne $Version -or [string]$metadata.archiveSha256 -ne $hash) {
        throw 'latest.json does not match the requested version or archive hash.'
    }
    $archiveSignature = (Get-Content -LiteralPath "$archivePath.sig" -Raw).Trim()
    if ([string]$metadata.archiveSignature -ne $archiveSignature) {
        throw 'latest.json does not contain the published archive signature.'
    }
    $expectedUrl = "https://github.com/Geckostya/PerforceFreshNewVisual/releases/download/v$Version/$archiveName"
    if ([string]$metadata.archiveUrl -ne $expectedUrl) {
        throw 'latest.json contains an unexpected archive URL.'
    }

    if (Test-Path -LiteralPath $expanded) { Remove-Item -LiteralPath $expanded -Recurse -Force }
    Expand-Archive -LiteralPath $archivePath -DestinationPath $expanded
    $manifest = Get-Content -LiteralPath (Join-Path $expanded 'release-manifest.json') -Raw | ConvertFrom-Json
    if ([string]$manifest.version -ne $Version -or [int]$manifest.schemaVersion -ne 1) {
        throw 'The portable archive has an invalid release manifest.'
    }
    $managedPaths = @($manifest.managedPaths | ForEach-Object { [string]$_ })
    if (($managedPaths | Sort-Object -Unique).Count -ne $managedPaths.Count) {
        throw 'The release manifest contains duplicate managed paths.'
    }
    $actualPaths = @(Get-ChildItem -LiteralPath $expanded -File -Recurse | ForEach-Object {
        $_.FullName.Substring($expanded.TrimEnd('\').Length).TrimStart('\').Replace('\', '/')
    })
    if (Compare-Object -ReferenceObject @($managedPaths | Sort-Object) -DifferenceObject @($actualPaths | Sort-Object)) {
        throw 'The portable archive file set does not match its managed paths.'
    }
    foreach ($file in $manifest.files) {
        $relative = [string]$file.path
        if ($relative.Contains('\') -or $relative.Contains(':') -or $relative.Split('/') -contains '..') {
            throw "The release manifest contains an unsafe path: $relative"
        }
        $path = Join-Path $expanded $relative
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Managed file is missing: $relative" }
        if ((Get-Item -LiteralPath $path).Length -ne [long]$file.size) {
            throw "Managed file size mismatch: $relative"
        }
        $actual = Get-Sha256 $path
        if ($actual -ne [string]$file.sha256) { throw "Managed file hash mismatch: $relative" }
    }

    & slsa-verifier verify-artifact $archivePath --provenance-path (Join-Path $directory $provenanceName) --source-uri $ExpectedRepository --source-tag $ExpectedTag
    if ($LASTEXITCODE -ne 0) { throw 'SLSA provenance verification failed.' }
} finally {
    if (Test-Path -LiteralPath $expanded) { Remove-Item -LiteralPath $expanded -Recurse -Force }
}

Write-Host "Release assets and SLSA provenance verified for $ExpectedTag"
