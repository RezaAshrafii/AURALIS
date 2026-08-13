@echo off
cd /d "%~dp0"
start "Auralis v0.10.12 Focused Workspace Conversation Hub" /b "%~dp0runtime\bun.exe" "%~dp0server.mjs"
exit /b 0
