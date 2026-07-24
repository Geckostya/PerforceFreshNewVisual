$projectRoot = Split-Path -Parent $PSScriptRoot
$toolchainRoot = Join-Path $projectRoot ".toolchain"

$env:CARGO_HOME = Join-Path $toolchainRoot "cargo"
$env:RUSTUP_HOME = Join-Path $toolchainRoot "rustup"
$env:npm_config_cache = Join-Path $toolchainRoot "npm-cache"
$env:PATH = @(
    (Join-Path $toolchainRoot "node")
    (Join-Path $env:CARGO_HOME "bin")
    $env:PATH
) -join ";"

Write-Host "P4FNV toolchain is active: Node $(node --version), Rust $(rustc --version)"
