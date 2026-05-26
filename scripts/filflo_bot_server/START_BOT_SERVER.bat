@echo off
REM Filflo Command Center launcher — place this next to bot_server.py inside Filflo_Bot.
REM If you use a virtual environment, replace "python" below with its python.exe path.
title Filflo Command Center
cd /d "%~dp0"
echo Starting Filflo Command Center on http://127.0.0.1:8765 ...
REM Open the browser a couple seconds after the server starts listening.
start "" /b cmd /c "timeout /t 2 >nul & start "" http://127.0.0.1:8765"
python bot_server.py
echo.
echo Command Center stopped.
pause
