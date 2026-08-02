$projectRoot = Split-Path -Parent $PSScriptRoot
$toolchainRoot = if ($env:P4FNV_TOOLCHAIN_ROOT) {
    $env:P4FNV_TOOLCHAIN_ROOT
} else {
    Join-Path $projectRoot ".toolchain"
}

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
$rustToolchainBin = Get-ChildItem (Join-Path $env:RUSTUP_HOME "toolchains") -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName "bin" } |
    Where-Object { Test-Path (Join-Path $_ "rustc.exe") } |
    Select-Object -First 1
$env:PATH = @(
    (Join-Path $toolchainRoot "node")
    $rustToolchainBin
    (Join-Path $env:CARGO_HOME "bin")
    (Join-Path $toolchainRoot "release-tools")
    $env:PATH
) -join ";"
$env:RUSTC = Join-Path $rustToolchainBin "rustc.exe"
$env:RUSTDOC = Join-Path $rustToolchainBin "rustdoc.exe"

Write-Host "P4FNV toolchain is active: Node $(node --version), Rust $(rustc --version)"
