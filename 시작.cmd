@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE=node"
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined DATA_DIR if exist "%USERPROFILE%\.aside\u\0" set "DATA_DIR=%USERPROFILE%\.aside\u\0\personal-studio-data"
if not defined DATA_DIR set "DATA_DIR=%~dp0.data"
if not defined PORT set "PORT=4318"
echo 나의 창작실 로컬 서버를 시작합니다.
echo 자동 배포나 자동 AI 호출은 하지 않습니다.
echo AI 연결 설정에서 키를 입력하고 실행한 요청은 외부 전송 및 비용이 발생할 수 있습니다.
echo 데이터 폴더: %DATA_DIR%
"%NODE%" src\server.mjs
pause
