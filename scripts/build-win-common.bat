@echo off
setlocal
REM Shared Windows Electron build helper for build-electron.bat and build-studio.bat
REM Args:
REM   %1 = Build title
REM   %2 = npm script name (e.g. build:desktop or electron:build:studio)
REM   %3 = Output executable path (for display)
REM   %4 = Run npm install first? (1=yes, 0=no)
REM   %5 = Optional relative folder inside frontend\ to open in Explorer
REM   %6 = Pause on completion? (1=yes, 0=no)

set "BUILD_TITLE=%~1"
set "NPM_SCRIPT=%~2"
set "OUTPUT_EXE=%~3"
set "DO_INSTALL=%~4"
set "EXPLORER_DIR=%~5"
set "DO_PAUSE=%~6"

echo ========================================================
echo   Building %BUILD_TITLE%
echo ========================================================

cd /d "%~dp0..\frontend" || goto :err

if "%DO_INSTALL%"=="1" (
  echo === Installing dependencies ===
  call npm install || goto :err
)

echo === Running %NPM_SCRIPT% ===
call npm run %NPM_SCRIPT% || goto :err

echo.
echo Done! Executable is ready:
echo   %OUTPUT_EXE%
if not "%EXPLORER_DIR%"=="" explorer "%EXPLORER_DIR%"
if "%DO_PAUSE%"=="1" pause
goto :eof

:err
echo Build failed. See output above.
if "%DO_PAUSE%"=="1" pause
exit /b 1
