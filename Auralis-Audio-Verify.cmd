@echo off
cd /d "%~dp0"
"%~dp0native\auralis-spool-inspect.exe" --root "%~dp0data\audio" > "%~dp0data\latest-audio-verification.json"
set EC=%ERRORLEVEL%
type "%~dp0data\latest-audio-verification.json"
echo.
if not "%EC%"=="0" echo VERIFY FAILED with exit code %EC%
if "%EC%"=="0" echo VERIFY PASS
pause
exit /b %EC%
