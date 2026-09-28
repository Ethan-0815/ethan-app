@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo.
echo   「我的空间」核心逻辑测试
echo.
node tests/run-tests.mjs
echo.
pause
