@echo off
title Anveshan Tracking Panel — Deploy to Netlify
echo.
echo ====================================================
echo   Anveshan Tracking Panel — Deploying to Netlify
echo ====================================================
echo.

cd /d "%~dp0"
set "PATH=%~dp0.node\node-v22.16.0-win-x64;%PATH%"
".node\node-v22.16.0-win-x64\node.exe" "node_modules\netlify-cli\bin\run.js" deploy --build --prod --message "Update from deploy.bat"

echo.
echo ====================================================
echo   Live at: https://anveshan-tracking-panel.netlify.app
echo ====================================================
echo.
pause
