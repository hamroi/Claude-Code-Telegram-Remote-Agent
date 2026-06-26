@echo off
title Claude Telegram Bot
cd /d "%~dp0"
echo Starting Claude Telegram bot...
echo (Keep this window open. Press Ctrl+C to stop.)
echo.
call npm start
echo.
echo Bot stopped. Press any key to close.
pause >nul
