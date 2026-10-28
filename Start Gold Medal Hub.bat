@echo off
setlocal
cd /d "%~dp0"
title Gold Medal Hub - setup
where node >nul 2>nul
if errorlevel 1 goto nonode
if exist node_modules goto haveModules
echo First run: downloading the app's components. This takes a few minutes...
call npm install --no-audit --no-fund
if errorlevel 1 goto installfail
:haveModules
if exist ".shortcuts-done" goto launch
echo.
echo Add a Gold Medal Hub icon to your Desktop?  Yes is recommended (it happens automatically after 20 seconds).
choice /c YN /t 20 /d Y /m "Desktop icon"
set DESK=1
if errorlevel 2 set DESK=0
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\make-shortcuts.ps1" -AppDir "%~dp0." -Desktop %DESK%
if errorlevel 1 goto shortcutfail
echo done> .shortcuts-done
echo.
echo Done. Open it from the Desktop icon, or press the Windows key and type Gold Medal or GMAA.
echo.
goto launch

:shortcutfail
echo.
echo The icon could not be created. Copy the red message above and send it over.
echo You can try again later with "Create Desktop Icon.bat".
pause
goto launch

:nonode
echo Node.js is not installed. Installing the free Node.js LTS with winget...
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
echo.
echo Node.js was installed. Please CLOSE this window and double-click this file again.
pause
exit /b

:installfail
echo Install failed. Copy the message above and send it over.
pause
exit /b

:launch
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
exit /b
