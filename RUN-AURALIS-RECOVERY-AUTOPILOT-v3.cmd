@echo off
cd /d "%~dp0"
echo AURALIS RECOVERY AUTOPILOT v3
echo GPT-5.6 Sol / AgentRouter / xhigh
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0AURALIS-RECOVERY-AUTOPILOT-v3.ps1"
echo.
echo Finished. Press any key.
pause >nul
