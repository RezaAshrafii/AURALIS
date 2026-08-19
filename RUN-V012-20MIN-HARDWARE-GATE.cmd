@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\run-v012-gate-suite.ps1" -Suite Soak20
set "EC=%ERRORLEVEL%"
pause
exit /b %EC%
