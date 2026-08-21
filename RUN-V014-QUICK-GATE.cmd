@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-v014-intelligence-gate.ps1"
if errorlevel 1 exit /b %errorlevel%
echo AURALIS_V014_QUICK_GATE_PASS
