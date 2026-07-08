@echo off
echo 正在启动 FanBox...
cd /d "%~dp0"
start http://localhost:4567
node server.js
pause
