@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."

rem ============================================================
rem  工具箱 · 端到端测试（真实浏览器 + 真实 Canvas）
rem  1) 起一个本地静态服务（H5 必须通过 http 打开，file:// 下部分能力被浏览器禁用）
rem  2) 起一个带调试端口的 Chrome / Edge
rem  3) 用 Node 通过 DevTools Protocol 驱动浏览器跑完整用例
rem ============================================================

set PORT=8790
set CDP=9333
set NODE=
where node >nul 2>nul && set NODE=node
set PY=
where py >nul 2>nul && set PY=py -3
if "%PY%"=="" ( where python >nul 2>nul && set PY=python )

if "%NODE%"=="" (
  echo   需要先安装 Node.js 18 以上版本。
  pause
  exit /b 1
)
if "%PY%"=="" (
  echo   需要先安装 Python 3 才能起本地预览服务。
  pause
  exit /b 1
)

set BROWSER=
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe
if "%BROWSER%"=="" if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe
if "%BROWSER%"=="" if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe
if "%BROWSER%"=="" if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe

if "%BROWSER%"=="" (
  echo   未找到 Chrome 或 Edge，无法运行端到端测试。
  pause
  exit /b 1
)

set PROFILE=%TEMP%\toolbox-e2e-profile

echo.
echo   启动本地服务与浏览器…
start "toolbox-server" /min %PY% -m http.server %PORT% --bind 127.0.0.1 --directory "app"
start "toolbox-browser" /min "%BROWSER%" --remote-debugging-port=%CDP% --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check about:blank
timeout /t 6 /nobreak >nul

%NODE% tools\e2e.mjs http://127.0.0.1:%PORT%/index.html %CDP%

echo.
echo   测试结束。若浏览器或服务窗口仍在，可手动关闭。
pause
