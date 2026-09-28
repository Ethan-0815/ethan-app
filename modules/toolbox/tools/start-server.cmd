@echo off
chcp 65001 >nul
setlocal
set ROOT=%~dp0..
set PY=

where py >nul 2>nul && set PY=py -3
if "%PY%"=="" ( where python >nul 2>nul && set PY=python )

if "%PY%"=="" (
  echo.
  echo   需要先安装 Python 3 才能启动本地预览服务。
  echo   也可以直接用 Android Studio 打开 android 目录运行正式版本。
  echo.
  pause
  exit /b 1
)

echo.
echo   「工具箱」本地预览
echo   地址：http://127.0.0.1:8790/
echo   按 Ctrl+C 结束服务
echo.

start "" http://127.0.0.1:8790/
%PY% -m http.server 8790 --bind 127.0.0.1 --directory "%ROOT%\app"
