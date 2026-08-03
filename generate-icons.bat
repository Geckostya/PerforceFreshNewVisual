@echo off
setlocal

set "P4FNV_PROJECT_ROOT=%~dp0"

if not exist "%P4FNV_PROJECT_ROOT%assets\app-icon.svg" (
  echo Icon source was not found: assets\app-icon.svg
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "Set-Location -LiteralPath $env:P4FNV_PROJECT_ROOT;" ^
  ". .\scripts\toolchain.ps1;" ^
  "npm run icons;" ^
  "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }"

set "P4FNV_ICON_EXIT_CODE=%ERRORLEVEL%"
if not "%P4FNV_ICON_EXIT_CODE%"=="0" (
  echo Icon generation failed with exit code %P4FNV_ICON_EXIT_CODE%.
  exit /b %P4FNV_ICON_EXIT_CODE%
)

echo Icons generated in src-tauri\icons.
pause
exit /b 0
