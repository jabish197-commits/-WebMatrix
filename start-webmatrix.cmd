@echo off
title WebMatrix Development Server
cd /d "%~dp0"
echo Starting WebMatrix frontend and API...
echo Keep this window open while using the application.
echo.
call npm.cmd run dev
echo.
echo WebMatrix stopped. Review the error above before closing this window.
pause
