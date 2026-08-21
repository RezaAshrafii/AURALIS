@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-v014-windows-product-bridge.ps1"
exit /b %ERRORLEVEL%
