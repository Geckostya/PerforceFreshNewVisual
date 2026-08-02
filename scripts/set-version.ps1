[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Version
)

$ErrorActionPreference = "Stop"
$semverPattern = '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$'
if ($Version -notmatch $semverPattern) {
    throw "Invalid Semantic Version: $Version"
}

$projectRoot = Split-Path -Parent $PSScriptRoot

function Replace-ExactlyOnce([string]$Path, [string]$Pattern, [string]$Replacement) {
    $content = Get-Content -LiteralPath $Path -Raw
    $matches = [regex]::Matches($content, $Pattern)
    if ($matches.Count -ne 1) {
        throw "Expected exactly one version field in $Path, found $($matches.Count)"
    }
    $updated = [regex]::Replace($content, $Pattern, $Replacement, 1)
    [System.IO.File]::WriteAllText($Path, $updated, [System.Text.UTF8Encoding]::new($false))
}

Replace-ExactlyOnce (Join-Path $projectRoot 'package.json') '(?m)^(\s*"version"\s*:\s*")[^"]+("\s*,)' "`${1}$Version`${2}"
Replace-ExactlyOnce (Join-Path $projectRoot 'package-lock.json') '(?ms)^(\{\s*"name"\s*:\s*"p4fnv"\s*,\s*"version"\s*:\s*")[^"]+("\s*,)' "`${1}$Version`${2}"
Replace-ExactlyOnce (Join-Path $projectRoot 'package-lock.json') '(?ms)^(\{\s*"name"\s*:\s*"p4fnv"\s*,\s*"version"\s*:\s*"[^"]+"\s*,\s*"lockfileVersion".*?"packages"\s*:\s*\{\s*""\s*:\s*\{\s*"name"\s*:\s*"p4fnv"\s*,\s*"version"\s*:\s*")[^"]+("\s*,)' "`${1}$Version`${2}"
Replace-ExactlyOnce (Join-Path $projectRoot 'src-tauri/Cargo.toml') '(?ms)(^\[package\]\s+name\s*=\s*"p4fnv"\s+version\s*=\s*")[^"]+("\s*$)' "`${1}$Version`${2}"
Replace-ExactlyOnce (Join-Path $projectRoot 'src-tauri/Cargo.lock') '(?ms)(^\[\[package\]\]\s+name\s*=\s*"p4fnv"\s+version\s*=\s*")[^"]+("\s*$)' "`${1}$Version`${2}"

& (Join-Path $PSScriptRoot 'verify-version.ps1') -ExpectedVersion $Version

Write-Host "Updated P4FNV to version $Version"
