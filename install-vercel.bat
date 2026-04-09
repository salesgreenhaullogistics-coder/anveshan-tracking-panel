@echo off
cd /d "%~dp0"
set "PATH=%~dp0.node\node-v22.16.0-win-x64;%PATH%"
call ".node\node-v22.16.0-win-x64\npm.cmd" install vercel --save-dev
pause
