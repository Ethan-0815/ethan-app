@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0..\android"

set TC=D:\android-toolchain

echo.
echo   「工具箱」打包脚本
echo.

if not exist "%TC%\gradle-8.7\bin\gradle.bat" (
  echo   [提示] 未找到本机工具链 %TC%
  echo   可以改用 Android Studio 打开 android 目录构建，或把工具链放在该路径下。
  echo.
  pause
  exit /b 1
)

set JAVA_HOME=%TC%\jdk-ms\jdk-17.0.13+11
set ANDROID_HOME=%TC%\sdk
set GRADLE_USER_HOME=%TC%\gradle-home

rem 只有在本地代理端口确实在监听时才附加代理参数，避免换网络后构建失败
set PROXY=
netstat -an | findstr /c:"127.0.0.1:4240" >nul 2>nul && set PROXY=-Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=4240 -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=4240

echo   正在打包（首次约 4 分钟，之后 40 秒左右）...
call "%TC%\gradle-8.7\bin\gradle.bat" --no-daemon %PROXY% assembleRelease
if errorlevel 1 (
  echo.
  echo   [失败] 构建未通过，请查看上面的报错。
  pause
  exit /b 1
)

if not exist "..\dist" mkdir "..\dist"
copy /y "app\build\outputs\apk\release\app-release.apk" "..\dist\toolbox-0.1.0.apk" >nul

echo.
echo   [完成] 已生成：dist\toolbox-0.1.0.apk
echo   传到手机点击安装即可（首次需允许"未知来源"）。
echo.
pause
