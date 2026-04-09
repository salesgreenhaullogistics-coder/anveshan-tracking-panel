@echo off
title Anveshan Tracking Panel — Public Tunnel
echo.
echo ====================================================
echo   Anveshan Tracking Panel — Starting Public Tunnel
echo ====================================================
echo.
echo   Make sure the dev server is already running first:
echo   Run "start-dev.bat" in another terminal window.
echo.

cd /d "%~dp0"
".node\node-v22.16.0-win-x64\node.exe" tunnel.cjs

pause
