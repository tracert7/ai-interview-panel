@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or later is required. Install the LTS version from https://nodejs.org/
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<22)process.exit(1)"
if errorlevel 1 (
  echo Node.js 22 or later is required. Please update Node.js first.
  pause
  exit /b 1
)
if not exist "node_modules\jose\package.json" (
  echo Installing the locked login-verification dependency...
  call npm.cmd ci --ignore-scripts --no-fund
  if errorlevel 1 (
    echo Dependency installation failed. No sign-in or AI request was sent.
    pause
    exit /b 1
  )
)
echo Starting your local interview room. Keep this window open while using it.
node server.mjs --open
pause
