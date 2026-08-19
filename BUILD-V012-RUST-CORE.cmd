@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\build-v012-windows-test.ps1"
set "EC=%ERRORLEVEL%"
if not "%EC%"=="0" pause
exit /b %EC%
