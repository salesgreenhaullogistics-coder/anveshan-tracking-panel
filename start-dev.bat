@echo off
title Anveshan Tracking Panel — Dev Server
echo.
echo ====================================================
echo   Anveshan Tracking Panel — Development Server
echo ====================================================
echo.

cd /d "%~dp0"
".node\node-v22.16.0-win-x64\node.exe" "node_modules\vite\bin\vite.js" --host

pause
