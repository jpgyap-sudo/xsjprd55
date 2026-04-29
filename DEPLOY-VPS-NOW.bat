@echo off
REM ============================================================
REM One-click VPS deploy from Windows
REM Double-click this file to deploy the latest code to your VPS
REM ============================================================

echo ========================================
echo  Trading Bot VPS Deploy
echo  VPS: 165.22.110.111
echo ========================================
echo.
echo This will SSH into your VPS and:
echo   1. Pull latest code from GitHub
echo   2. Install dependencies
echo   3. Restart all PM2 workers
echo.
echo You will be prompted for your root password.
echo.
pause

echo.
echo [1/4] Connecting to VPS...
ssh -o StrictHostKeyChecking=accept-new root@165.22.110.111 "cd ~/xsjprd55 && git fetch origin main && git reset --hard origin/main && echo '---CODE UPDATED---'"
if errorlevel 1 (
  echo.
  echo ERROR: Failed to update code on VPS.
  echo Make sure you can SSH with: ssh root@165.22.110.111
  pause
  exit /b 1
)

echo.
echo [2/4] Installing dependencies...
ssh root@165.22.110.111 "cd ~/xsjprd55 && npm install"
if errorlevel 1 (
  echo WARNING: npm install may have had issues, continuing...
)

echo.
echo [3/4] Restarting PM2 processes...
ssh root@165.22.110.111 "cd ~/xsjprd55 && pm2 restart ecosystem.config.cjs --update-env && pm2 save"
if errorlevel 1 (
  echo ERROR: PM2 restart failed.
  pause
  exit /b 1
)

echo.
echo [4/4] Running health check...
ssh root@165.22.110.111 "sleep 3 && curl -sf http://localhost:3000/api/health && echo ' ---HEALTHY' || echo ' ---HEALTH CHECK FAILED'"

echo.
echo ========================================
echo  Deploy complete!
echo ========================================
echo.
echo Check status:  ssh root@165.22.110.111 "pm2 status"
echo View logs:    ssh root@165.22.110.111 "pm2 logs trading-signal-bot --lines 20"
echo.
pause
