@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM 폴더 이름을 프로젝트 이름으로 사용
for %%I in ("%~dp0.") do set "NAME=%%~nxI"
title %NAME% git 동기화

REM USB(exFAT)는 소유권 기록이 없어 git이 저장소를 거부함 -> 이 폴더를 이 PC에 1회 예외 등록
set "REPO=%~dp0"
if "%REPO:~-1%"=="\" set "REPO=%REPO:~0,-1%"
set "REPO=%REPO:\=/%"
git config --global --get-all safe.directory 2>nul | findstr /c:"%REPO%" >nul || git config --global --add safe.directory "%REPO%" >nul 2>&1

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo.
  echo [!] git 저장소를 인식하지 못했어요.
  echo     VS Code로 이 폴더를 열고 클로드에게 "git 동기화 문제 해결해줘"라고 말하면 돼요.
  echo.
  pause
  exit /b 1
)

echo [1/3] 내 변경사항 저장 중...
git add -A
git commit -m "%NAME% sync (%COMPUTERNAME%)" >nul 2>&1

echo [2/3] 다른 컴퓨터의 최신 내용 받는 중...
git pull --rebase
if errorlevel 1 (
  echo.
  echo [!] 충돌이 났어요 — 같은 부분을 양쪽에서 고쳤다는 뜻이에요.
  echo     VS Code로 이 폴더를 열고 클로드에게 "동기화 충돌 해결해줘"라고 말하면 돼요.
  echo.
  pause
  exit /b 1
)

echo [3/3] 내 변경사항 올리는 중...
git push
if errorlevel 1 (
  echo.
  echo [!] 올리기 실패. 인터넷 연결과 원격 저장소 설정을 확인하세요. (git remote -v)
  echo.
  pause
  exit /b 1
)

echo.
echo   동기화 완료! GitHub 백업까지 최신 상태예요.
echo.
pause
