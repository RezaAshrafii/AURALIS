@echo off
cd /d "%~dp0"
set AURALIS_KEEPALIVE=1
"%~dp0runtime\bun.exe" "%~dp0server.mjs"
pause
