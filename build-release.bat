@echo off
setlocal

set "P4FNV_PROJECT_ROOT=%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "Set-Location -LiteralPath $env:P4FNV_PROJECT_ROOT;" ^
  ". .\scripts\toolchain.ps1;" ^
  "npm run build:portable;" ^
  "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }"

set "P4FNV_BUILD_EXIT_CODE=%ERRORLEVEL%"
if not "%P4FNV_BUILD_EXIT_CODE%"=="0" (
  echo Release build failed with exit code %P4FNV_BUILD_EXIT_CODE%.
  exit /b %P4FNV_BUILD_EXIT_CODE%
)

echo Done
pause
exit /b 0
