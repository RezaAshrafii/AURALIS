@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
set "BUN="
for %%P in (
  "%ROOT%runtime\bun.exe"
  "%USERPROFILE%\.bun\bin\bun.exe"
) do if not defined BUN if exist "%%~fP" set "BUN=%%~fP"
if not defined BUN (
  echo A portable Bun runtime was not found.
  echo Use the Windows Portable package, or install Bun for source development.
  pause
  exit /b 2
)

rem IMPORTANT: v0.12 Rust core is hardware-gated separately.
rem The interactive product keeps the validated event-producing capture bridge
rem until v0.13 provides the production Rust speech/event integration.
set "AURALIS_EXPERIMENTAL_V012_CAPTURE=0"
set "AURALIS_NO_BROWSER=0"
pushd "%ROOT%"
"%BUN%" run server.mjs
set "EXIT_CODE=%errorlevel%"
popd
exit /b %EXIT_CODE%
