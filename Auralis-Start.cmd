@echo off
cd /d "%~dp0"
start "Auralis v0.10.4 Live Transcript Validation" /b "%~dp0runtime\bun.exe" "%~dp0server.mjs"
exit /b 0
