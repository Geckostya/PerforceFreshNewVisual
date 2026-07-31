@echo off
setlocal

set "P4FNV_PROJECT_ROOT=%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "Set-Location -LiteralPath $env:P4FNV_PROJECT_ROOT;" ^
  ". .\scripts\toolchain.ps1;" ^
  "npm run build;" ^
  "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE };" ^
  "$artifact = Join-Path (Get-Location) 'src-tauri\target\release\p4fnv.exe';" ^
  "if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) { Write-Error ('Release artifact not found: ' + $artifact); exit 1 };" ^
  "$sha256 = [System.Security.Cryptography.SHA256]::Create();" ^
  "$stream = [System.IO.File]::OpenRead($artifact);" ^
  "try { $hash = [BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() } finally { $stream.Dispose(); $sha256.Dispose() };" ^
  "Write-Host '';" ^
  "Write-Host ('Release artifact: ' + $artifact);" ^
  "Write-Host ('SHA256: ' + $hash)"

echo Done
pause

set "P4FNV_BUILD_EXIT_CODE=%ERRORLEVEL%"
if not "%P4FNV_BUILD_EXIT_CODE%"=="0" echo Release build failed with exit code %P4FNV_BUILD_EXIT_CODE%.
exit /b %P4FNV_BUILD_EXIT_CODE%
