@echo off
REM Build the Yogatik Studio Edition (Standalone Agent Engine) via Electron.
call "%~dp0scripts\build-win-common.bat" "Yogatik Studio Edition (Standalone Agent Engine)" "electron:build:studio" "frontend\release-studio\win-unpacked\Yogatik Studio.exe" "0" "" "1"
exit /b %errorlevel%
