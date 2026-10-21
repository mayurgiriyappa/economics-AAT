@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 or newer is required. Install it from https://nodejs.org/ and reopen this file.
  pause
  exit /b 1
)
if not exist node_modules\express (
  echo Installing required server packages. This step needs an internet connection.
  call npm install
  if errorlevel 1 (
    echo Package installation failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)
echo Starting Strategy Court. Open http://localhost:3000 in your browser.
call npm start
pause
