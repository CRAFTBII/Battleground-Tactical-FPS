@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   战地突击 Battleground Tactical FPS
echo ============================================
echo.
echo   本游戏必须通过本服务运行（模型为 .glb，需 HTTP 加载）
echo   启动后请用浏览器打开: http://localhost:8080
echo.
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [错误] 未找到 Node.js，请先安装 https://nodejs.org/
  pause
  exit /b 1
)
if not exist "modelssoldier.glb" (
  echo [警告] 未找到 modelssoldier.glb
  echo        如果是刚拉取的仓库，请先执行: node tools/export_assets.cjs
  echo.
)
node server.js
pause