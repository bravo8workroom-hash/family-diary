@echo off
cd /d "%~dp0"

REM ---------------------------------------------------------------
REM  This file is intentionally ASCII-only.
REM  cmd.exe re-reads a batch file by byte offset after each line,
REM  so non-ASCII text (Korean) can split a command in half and run
REM  a fragment for real. That once passed an empty value to
REM  "git config --global --add safe.directory", which wiped the
REM  whole safe.directory list for every project. Keep it ASCII.
REM ---------------------------------------------------------------

for %%I in ("%~dp0.") do set "NAME=%%~nxI"
title %NAME% sync

set "REPO=%~dp0"
if "%REPO:~-1%"=="\" set "REPO=%REPO:~0,-1%"
set "REPO=%REPO:\=/%"

REM USB(exFAT) has no ownership record -> register this folder once per PC.
REM Never run the add with an empty value: an empty entry RESETS the list.
if not "%REPO%"=="" (
  git config --global --get-all safe.directory 2>nul | findstr /c:"%REPO%" >nul || git config --global --add safe.directory "%REPO%" >nul 2>&1
)

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [!] Not a git repository.
  echo       Open this folder in VS Code and ask Claude to fix git sync.
  echo.
  pause
  exit /b 1
)

echo.
echo   [1/3] saving your changes...
git add -A
git commit -m "%NAME% sync (%COMPUTERNAME%)" >nul 2>&1

echo   [2/3] pulling changes from the other PC...
git pull --rebase
if errorlevel 1 (
  echo.
  echo   [!] Conflict - the same part was edited on both PCs.
  echo       Open this folder in VS Code and ask Claude to resolve it.
  echo.
  pause
  exit /b 1
)

echo   [3/3] pushing your changes...
git push
if errorlevel 1 (
  echo.
  echo   [!] Push failed. Check your internet and the remote setting.
  echo       Open this folder in VS Code and ask Claude to check it.
  echo.
  pause
  exit /b 1
)

echo.
echo   Done. GitHub backup is up to date.
echo.
pause
