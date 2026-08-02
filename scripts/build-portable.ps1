[CmdletBinding()]
param(
    [string]$OutputDirectory,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

function Get-Sha256([string]$Path) {
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($Path)
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}

& (Join-Path $PSScriptRoot 'verify-version.ps1')

$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $projectRoot "artifacts/releases/$version"
}
$output = [System.IO.Path]::GetFullPath($OutputDirectory)
$staging = Join-Path $output 'portable'
$archiveName = "P4FNV_${version}_windows_x64_portable.zip"
$archivePath = Join-Path $output $archiveName

if (-not $SkipBuild) {
    npm run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    cargo build --manifest-path src-tauri/Cargo.toml --release --bin p4fnv-update-helper
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$sourceFiles = [ordered]@{
    'p4fnv.exe' = Join-Path $projectRoot 'src-tauri/target/release/p4fnv.exe'
    'p4fnv-update-helper.exe' = Join-Path $projectRoot 'src-tauri/target/release/p4fnv-update-helper.exe'
    'THIRD_PARTY_NOTICES.md' = Join-Path $projectRoot 'THIRD_PARTY_NOTICES.md'
}
foreach ($source in $sourceFiles.Values) {
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Release input not found: $source"
    }
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'locales') -PathType Container)) {
    throw 'Release input not found: locales'
}

if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
}
New-Item -ItemType Directory -Path $staging -Force | Out-Null

foreach ($entry in $sourceFiles.GetEnumerator()) {
    Copy-Item -LiteralPath $entry.Value -Destination (Join-Path $staging $entry.Key)
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'locales') -Destination (Join-Path $staging 'locales') -Recurse

$managedFiles = Get-ChildItem -LiteralPath $staging -File -Recurse | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($staging.TrimEnd('\').Length).TrimStart('\').Replace('\', '/')
    [ordered]@{
        path = $relative
        sha256 = Get-Sha256 $_.FullName
        size = $_.Length
    }
}
$manifest = [ordered]@{
    schemaVersion = 1
    version = [string]$version
    managedPaths = @($managedFiles.path) + @('release-manifest.json')
    files = @($managedFiles)
}
$manifestPath = Join-Path $staging 'release-manifest.json'
$manifestJson = $manifest | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($manifestPath, "$manifestJson`n", [System.Text.UTF8Encoding]::new($false))

if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
}
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $archivePath -CompressionLevel Optimal

$archiveHash = Get-Sha256 $archivePath
$hashFile = Join-Path $output 'SHA256SUMS.txt'
[System.IO.File]::WriteAllText($hashFile, "$archiveHash  $archiveName`n", [System.Text.UTF8Encoding]::new($false))

$expanded = Join-Path $output 'verification'
if (Test-Path -LiteralPath $expanded) {
    Remove-Item -LiteralPath $expanded -Recurse -Force
}
Expand-Archive -LiteralPath $archivePath -DestinationPath $expanded
$roundTripManifest = Get-Content -LiteralPath (Join-Path $expanded 'release-manifest.json') -Raw | ConvertFrom-Json
$roundTripManagedPaths = @($roundTripManifest.managedPaths | ForEach-Object { [string]$_ })
$roundTripPaths = @(Get-ChildItem -LiteralPath $expanded -File -Recurse | ForEach-Object {
    $_.FullName.Substring($expanded.TrimEnd('\').Length).TrimStart('\').Replace('\', '/')
})
if (($roundTripManagedPaths | Sort-Object -Unique).Count -ne $roundTripManagedPaths.Count) {
    throw 'Archive manifest contains duplicate managed paths.'
}
if (Compare-Object -ReferenceObject @($roundTripManagedPaths | Sort-Object) -DifferenceObject @($roundTripPaths | Sort-Object)) {
    throw 'Archive file set does not match its managed paths.'
}
foreach ($file in $roundTripManifest.files) {
    $candidate = Join-Path $expanded ([string]$file.path)
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "Archive is missing managed file: $($file.path)"
    }
    if ((Get-Item -LiteralPath $candidate).Length -ne [long]$file.size) {
        throw "Archive size mismatch for $($file.path)"
    }
    $actualHash = Get-Sha256 $candidate
    if ($actualHash -ne [string]$file.sha256) {
        throw "Archive hash mismatch for $($file.path)"
    }
}

Write-Host "Portable release: $archivePath"
Write-Host "SHA256: $archiveHash"
