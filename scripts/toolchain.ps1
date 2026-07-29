$projectRoot = Split-Path -Parent $PSScriptRoot
$toolchainRoot = Join-Path $projectRoot ".toolchain"

if (-not (Test-Path (Join-Path $toolchainRoot "node"))) {
    $gitCommonDirectory = & git -C $projectRoot rev-parse --path-format=absolute --git-common-dir 2>$null
    if ($LASTEXITCODE -eq 0 -and $gitCommonDirectory) {
        $primaryCheckoutRoot = Split-Path -Parent $gitCommonDirectory.Trim()
        $sharedToolchainRoot = Join-Path $primaryCheckoutRoot ".toolchain"
        if (Test-Path (Join-Path $sharedToolchainRoot "node")) {
            $toolchainRoot = $sharedToolchainRoot
        }
    }
}

$env:CARGO_HOME = Join-Path $toolchainRoot "cargo"
$env:RUSTUP_HOME = Join-Path $toolchainRoot "rustup"
$env:npm_config_cache = Join-Path $toolchainRoot "npm-cache"
$env:PATH = @(
    (Join-Path $toolchainRoot "node")
    (Join-Path $env:CARGO_HOME "bin")
    $env:PATH
) -join ";"

Write-Host "P4FNV toolchain is active: Node $(node --version), Rust $(rustc --version)"
