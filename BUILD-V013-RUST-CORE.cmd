@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-v013-windows-speech-test.ps1"
exit /b %ERRORLEVEL%
