@echo off
REM Build the Yogatik Windows desktop app (.exe) via Electron. No Rust needed.
REM Prereqs: Node 18+ only.
call "%~dp0scripts\build-win-common.bat" "Yogatik Desktop App" "build:desktop" "frontend\release-electron\win-unpacked\Yogatik.exe" "1" "release-electron\win-unpacked" "0"
exit /b %errorlevel%
