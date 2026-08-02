[CmdletBinding()]
param(
    [string]$ExpectedVersion,
    [string]$ExpectedTag
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

function Read-JsonFile([string]$Path) {
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Read-CargoPackageVersion([string]$Path) {
    $content = Get-Content -LiteralPath $Path -Raw
    $package = [regex]::Match($content, '(?ms)^\[package\]\s+.*?^version\s*=\s*"(?<version>[^"]+)"')
    if (-not $package.Success) {
        throw "Could not read the package version from $Path"
    }
    return $package.Groups['version'].Value
}

function Read-CargoLockVersion([string]$Path) {
    $content = Get-Content -LiteralPath $Path -Raw
    $package = [regex]::Match($content, '(?ms)^\[\[package\]\]\s+name\s*=\s*"p4fnv"\s+version\s*=\s*"(?<version>[^"]+)"')
    if (-not $package.Success) {
        throw "Could not read the p4fnv version from $Path"
    }
    return $package.Groups['version'].Value
}

function Read-PackageLockVersions([string]$Path) {
    $content = Get-Content -LiteralPath $Path -Raw
    $root = [regex]::Match($content, '(?ms)^\{\s*"name"\s*:\s*"p4fnv"\s*,\s*"version"\s*:\s*"(?<version>[^"]+)"')
    $package = [regex]::Match($content, '(?ms)^\{\s*"name"\s*:\s*"p4fnv"\s*,\s*"version"\s*:\s*"[^"]+"\s*,\s*"lockfileVersion".*?"packages"\s*:\s*\{\s*""\s*:\s*\{\s*"name"\s*:\s*"p4fnv"\s*,\s*"version"\s*:\s*"(?<version>[^"]+)"')
    if (-not $root.Success -or -not $package.Success) {
        throw "Could not read the p4fnv versions from $Path"
    }
    return @($root.Groups['version'].Value, $package.Groups['version'].Value)
}

$packageJson = Read-JsonFile (Join-Path $projectRoot 'package.json')
$packageLockVersions = Read-PackageLockVersions (Join-Path $projectRoot 'package-lock.json')
$tauriConfig = Read-JsonFile (Join-Path $projectRoot 'src-tauri/tauri.conf.json')
$cargoVersion = Read-CargoPackageVersion (Join-Path $projectRoot 'src-tauri/Cargo.toml')
$cargoLockVersion = Read-CargoLockVersion (Join-Path $projectRoot 'src-tauri/Cargo.lock')
$version = [string]$packageJson.version
$semverPattern = '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$'

if ($version -notmatch $semverPattern) {
    throw "package.json contains an invalid Semantic Version: $version"
}

$versions = [ordered]@{
    'package-lock.json root' = $packageLockVersions[0]
    'package-lock.json package' = $packageLockVersions[1]
    'src-tauri/Cargo.toml' = $cargoVersion
    'src-tauri/Cargo.lock' = $cargoLockVersion
}
foreach ($entry in $versions.GetEnumerator()) {
    if ($entry.Value -ne $version) {
        throw "$($entry.Key) version '$($entry.Value)' does not match package.json '$version'"
    }
}

if ([string]$tauriConfig.version -ne '../package.json') {
    throw "src-tauri/tauri.conf.json must read its version from ../package.json"
}
if ($ExpectedVersion -and $ExpectedVersion -ne $version) {
    throw "Expected version '$ExpectedVersion', found '$version'"
}
if ($ExpectedTag -and $ExpectedTag -ne "v$version") {
    throw "Expected tag '$ExpectedTag', but the version requires 'v$version'"
}

Write-Host "Version verified: $version"
