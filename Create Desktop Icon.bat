@echo off
cd /d "%~dp0"
echo Creating the Gold Medal Hub desktop icon and Start-menu entry...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\make-shortcuts.ps1" -AppDir "%~dp0." -Desktop 1
if errorlevel 1 (
  echo.
  echo Something went wrong. Take a photo or copy the red message above and send it over.
) else (
  echo.
  echo Done. Look for "Gold Medal Hub (GMAA)" on your Desktop, or press the Windows key and type Gold Medal.
)
echo.
pause
