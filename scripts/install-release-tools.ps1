[CmdletBinding()]
param(
    [string]$ToolchainRoot
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $ToolchainRoot) {
    $ToolchainRoot = if ($env:P4FNV_TOOLCHAIN_ROOT) {
        $env:P4FNV_TOOLCHAIN_ROOT
    } else {
        Join-Path $projectRoot '.toolchain'
    }
}

$version = '2.7.1'
$expectedSha256 = '1d8f61ad747ecc3d375d2a563cebf2991748b7da1a9bda9a500804c3c499e3c0'
$downloadUrl = "https://github.com/slsa-framework/slsa-verifier/releases/download/v$version/slsa-verifier-windows-amd64.exe"
$toolsDirectory = Join-Path ([System.IO.Path]::GetFullPath($ToolchainRoot)) 'release-tools'
$destination = Join-Path $toolsDirectory 'slsa-verifier.exe'

function Get-Sha256([string]$Path) {
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
    } finally {
        $stream.Dispose()
        $algorithm.Dispose()
    }
}

if (Test-Path -LiteralPath $destination -PathType Leaf) {
    if ((Get-Sha256 $destination) -eq $expectedSha256) {
        Write-Host "SLSA verifier v$version is already installed: $destination"
        exit 0
    }
    throw "Existing SLSA verifier has an unexpected SHA-256: $destination"
}

New-Item -ItemType Directory -Path $toolsDirectory -Force | Out-Null
$temporary = Join-Path $toolsDirectory ("slsa-verifier.download-" + [guid]::NewGuid().ToString('N'))
try {
    Invoke-WebRequest -Uri $downloadUrl -OutFile $temporary
    $actualSha256 = Get-Sha256 $temporary
    if ($actualSha256 -ne $expectedSha256) {
        throw "Downloaded SLSA verifier SHA-256 mismatch: $actualSha256"
    }
    Move-Item -LiteralPath $temporary -Destination $destination
} finally {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
}

& $destination version | Out-Host
if ($LASTEXITCODE -ne 0) {
    throw 'The installed SLSA verifier could not start.'
}
Write-Host "Installed SLSA verifier v${version}: $destination"
