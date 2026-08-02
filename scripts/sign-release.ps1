[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [Parameter(Mandatory = $true)]
    [string]$NotesFile,
    [Parameter(Mandatory = $true)]
    [string]$PrivateKeyFile,
    [string]$ReleaseDirectory,
    [string]$CryptoTool
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $ReleaseDirectory) {
    $ReleaseDirectory = Join-Path $projectRoot "artifacts/releases/$Version"
}
$releaseDirectory = [System.IO.Path]::GetFullPath($ReleaseDirectory)
$archiveName = "P4FNV_${Version}_windows_x64_portable.zip"
$archivePath = Join-Path $releaseDirectory $archiveName
$archiveSignaturePath = "$archivePath.sig"
$metadataPath = Join-Path $releaseDirectory 'latest.json'
$metadataSignaturePath = "$metadataPath.sig"
if (-not $CryptoTool) {
    $CryptoTool = Join-Path $projectRoot 'src-tauri/target/release/p4fnv-release-crypto.exe'
}

function Get-Sha256([string]$Path) {
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($Path)
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}

& (Join-Path $PSScriptRoot 'verify-version.ps1') -ExpectedVersion $Version
foreach ($required in @($archivePath, $NotesFile, $PrivateKeyFile)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Release signing input not found: $required"
    }
}
if (-not (Get-Content -LiteralPath $NotesFile -Raw).Trim()) {
    throw 'Release notes must not be empty.'
}
if (-not (Test-Path -LiteralPath $CryptoTool -PathType Leaf)) {
    throw "P4FNV release crypto tool not found: $CryptoTool"
}
if (-not $env:P4FNV_UPDATE_PUBLIC_KEY) {
    throw 'P4FNV_UPDATE_PUBLIC_KEY must contain the base64-encoded raw Ed25519 public key.'
}

$encodedPublic = (& $CryptoTool public $PrivateKeyFile).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not derive the release public key.' }
if ($encodedPublic -ne $env:P4FNV_UPDATE_PUBLIC_KEY.Trim()) {
    throw 'The signing key does not match P4FNV_UPDATE_PUBLIC_KEY.'
}

& $CryptoTool sign $PrivateKeyFile $archivePath $archiveSignaturePath
if ($LASTEXITCODE -ne 0) { throw 'Could not sign the release archive.' }
$archiveSignature = (Get-Content -LiteralPath $archiveSignaturePath -Raw).Trim()

$archiveHash = Get-Sha256 $archivePath
$notes = Get-Content -LiteralPath $NotesFile -Raw
$metadata = [ordered]@{
    version = $Version
    notes = $notes.Trim()
    publishedAt = [DateTimeOffset]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
    archiveUrl = "https://github.com/Geckostya/PerforceFreshNewVisual/releases/download/v$Version/$archiveName"
    archiveSha256 = $archiveHash
    archiveSignature = $archiveSignature
}
$metadataJson = $metadata | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($metadataPath, "$metadataJson`n", [System.Text.UTF8Encoding]::new($false))

& $CryptoTool sign $PrivateKeyFile $metadataPath $metadataSignaturePath
if ($LASTEXITCODE -ne 0) { throw 'Could not sign the update metadata.' }

Write-Host "Signed release assets for $Version"
