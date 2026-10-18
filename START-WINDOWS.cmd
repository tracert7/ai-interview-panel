@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13 or later is required. Install the LTS version from https://nodejs.org/
  pause
  exit /b 1
)
node -e "const [major,minor]=process.versions.node.split('.').map(Number);if(major<22||(major===22&&minor<13))process.exit(1)"
if errorlevel 1 (
  echo Node.js 22.13 or later is required. Please update Node.js first.
  pause
  exit /b 1
)
node -e "for(const name of ['jose','unpdf','pdfjs-dist','yauzl','saxes']) require.resolve(name)" >nul 2>nul
if errorlevel 1 (
  echo Installing locked sign-in and document-reading dependencies...
  call npm.cmd ci --omit=dev --omit=optional --ignore-scripts --no-fund
  if errorlevel 1 (
    echo Dependency installation failed. No sign-in or AI request was sent.
    pause
    exit /b 1
  )
)
echo Starting your local interview room. Keep this window open while using it.
node server.mjs --open
pause
