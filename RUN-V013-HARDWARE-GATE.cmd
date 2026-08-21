@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-v013-speech-gate.ps1" -RunAudioHardware -AudioSuite Quick
exit /b %ERRORLEVEL%
