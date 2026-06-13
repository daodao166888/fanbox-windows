@echo off
echo 正在启动 FanBox...
cd /d E:\fanbox
start http://localhost:4567
node server.js
pause
