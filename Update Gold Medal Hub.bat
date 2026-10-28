@echo off
setlocal
cd /d "%~dp0"
title Gold Medal Hub - update
set "ZIP="
for /f "delims=" %%F in ('dir /b /o-d "%USERPROFILE%\Downloads\GoldMedalHub-App-v*.zip" 2^>nul') do if not defined ZIP set "ZIP=%USERPROFILE%\Downloads\%%F"
if not defined ZIP goto nozip
echo.
echo Newest update file found:
echo   %ZIP%
echo.
echo Make sure Gold Medal Hub is CLOSED, then
pause
set "UPD=%TEMP%\gmh-update"
if exist "%UPD%" rmdir /s /q "%UPD%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%ZIP%' -DestinationPath '%UPD%' -Force"
if errorlevel 1 goto fail
if not exist "%UPD%\order-history-app\package.json" goto badzip
robocopy "%UPD%\order-history-app" "%~dp0." /E /XD node_modules data-private /XF .shortcuts-done "Update Gold Medal Hub.bat" /NFL /NDL /NJH /NJS /NP
if errorlevel 8 goto fail
rmdir /s /q "%UPD%"
if exist "node_modules\electron\dist\electron.exe" goto launch
echo Components are missing, downloading them (a few minutes)...
call npm install --no-audit --no-fund
if errorlevel 1 goto fail
:launch
echo.
echo Updated. Your data, Shopify connection and shared-database connection are untouched.
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
timeout /t 4 >nul
exit /b

:nozip
echo No file named GoldMedalHub-App-v....zip was found in your Downloads folder.
echo Download the new zip first, then run this again.
pause
exit /b

:badzip
echo That zip does not look like a Gold Medal Hub update. Nothing was changed.
pause
exit /b

:fail
echo.
echo The update did not finish. Copy the message above and send it over. Nothing in your data was changed.
pause
exit /b
