@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."

set NODE=
where node >nul 2>nul && set NODE=node
if "%NODE%"=="" (
  echo.
  echo   需要先安装 Node.js 18 以上版本才能运行测试。
  echo.
  pause
  exit /b 1
)

echo.
echo   工具箱 · 逻辑单元测试
echo.
%NODE% tests\run-tests.mjs
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)
echo.
pause
