@echo off
REM ========================================================
REM 鸿蒙 DevEco Studio 项目说明
REM ========================================================
REM 
REM 1. 打开 DevEco Studio
REM 2. File -> Open -> 选择 harmony/ 目录
REM 3. DevEco Studio 会自动识别为 HarmonyOS 项目
REM 4. 等待 Sync 完成 (会自动 ohpm install)
REM 5. 连接手机或启动模拟器
REM 6. 点击 Run 按钮
REM
REM 首次打开前请运行:
REM   npm run build:harmony:js
REM
REM 如果遇到依赖问题，在 harmony/ 目录下运行:
REM   ohpm install
REM
REM 签名配置: File -> Project Structure -> Signing Configs
REM (调试可用自动签名)
REM ========================================================
echo 请用 DevEco Studio 打开 harmony/ 目录
pause
