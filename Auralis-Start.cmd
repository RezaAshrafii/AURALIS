@echo off
cd /d "%~dp0"
start "Auralis v0.10.5 Audio Path Hardening" /b "%~dp0runtime\bun.exe" "%~dp0server.mjs"
exit /b 0
