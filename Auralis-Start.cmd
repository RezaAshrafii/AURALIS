@echo off
cd /d "%~dp0"
start "Auralis v0.11.2 Runtime Auth Stabilization" /b "%~dp0runtime\bun.exe" "%~dp0server.mjs"
exit /b 0
