@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-v014-product-bridge-gate.ps1"
exit /b %ERRORLEVEL%
