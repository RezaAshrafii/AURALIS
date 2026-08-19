@echo off
setlocal
cd /d "%~dp0"
echo.
echo AURALIS AUTOPILOT
echo GPT-5.6 Sol / AgentRouter / xhigh
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0AURALIS-AUTOPILOT.ps1"
echo.
echo Autopilot finished. Press any key to close.
pause >nul
