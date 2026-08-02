[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PrivateKeyFile,
    [string]$CryptoTool
)

$ErrorActionPreference = "Stop"
$privateKey = [System.IO.Path]::GetFullPath($PrivateKeyFile)
if (Test-Path -LiteralPath $privateKey) {
    throw "Refusing to overwrite an existing key: $privateKey"
}
$parent = Split-Path -Parent $privateKey
if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
    throw "The private key directory does not exist: $parent"
}
if (-not $CryptoTool) {
    $projectRoot = Split-Path -Parent $PSScriptRoot
    $CryptoTool = Join-Path $projectRoot 'src-tauri/target/release/p4fnv-release-crypto.exe'
}
if (-not (Test-Path -LiteralPath $CryptoTool -PathType Leaf)) {
    throw "Build p4fnv-release-crypto before generating a key: $CryptoTool"
}

$publicLine = & $CryptoTool keygen $privateKey
if ($LASTEXITCODE -ne 0) { throw 'Could not generate the Ed25519 release key.' }
Write-Host "Private key: $privateKey"
Write-Host $publicLine
Write-Host 'Store two protected backups before publishing a release.'
