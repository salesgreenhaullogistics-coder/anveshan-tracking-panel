@echo off
title Filflo Bot Server - Public Tunnel (Cloudflare)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bot_tunnel.ps1"
pause
