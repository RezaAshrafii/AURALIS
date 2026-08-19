@echo off
setlocal
cd /d "%~dp0"
echo.
echo AURALIS RESUME AUTOPILOT
echo Starting from completed Pass 1 + Pass 2
echo GPT-5.6 Sol / AgentRouter / xhigh
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0AURALIS-RESUME-AUTOPILOT.ps1"
echo.
echo Finished. Press any key to close.
pause >nul
