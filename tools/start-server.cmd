@echo off
rem ETHAN Super App · 一键启动本地 H5 服务并打开浏览器
setlocal
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 node，请先安装 Node.js
  pause
  exit /b 1
)
start "" http://127.0.0.1:8923/
node tools\serve.mjs 8923
