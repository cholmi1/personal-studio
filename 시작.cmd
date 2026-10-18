@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE=node"
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined DATA_DIR if exist "%USERPROFILE%\.aside\u\0" set "DATA_DIR=%USERPROFILE%\.aside\u\0\personal-studio-data"
if not defined DATA_DIR set "DATA_DIR=%~dp0.data"
if not defined PORT set "PORT=4318"
echo 나의 창작실 로컬 서버를 시작합니다.
echo 외부 배포나 AI API 호출은 하지 않습니다.
echo 데이터 폴더: %DATA_DIR%
"%NODE%" src\server.mjs
pause
