@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\run-v012-gate-suite.ps1" -Suite Quick
set "EC=%ERRORLEVEL%"
pause
exit /b %EC%
