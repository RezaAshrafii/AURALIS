@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-v013-speech-gate.ps1" -LocalWhisperUrl http://127.0.0.1:8080
exit /b %ERRORLEVEL%
