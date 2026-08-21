@echo off
chcp 65001 >nul
title [VISION-PASS] 로컬 실시간 개발 서버
cd /d "%~dp0"

echo ================================================================
echo   [VISION-PASS] 로컬 실시간 미리보기 서버 실행 중...
echo ================================================================
echo.
echo   1. 로컬 서버(Next.js)가 준비될 때까지 약 3초간 기다립니다.
echo   2. 준비가 완료되면 브라우저(http://localhost:3000)가 자동으로 뜹니다.
echo   3. 코드를 수정하면 화면이 0.1초 만에 즉시 실시간으로 바뀝니다!
echo.
echo   ※ 주의: 테스트하시는 동안 이 까만 창을 닫지 마세요.
echo ================================================================
echo.

start "" powershell -NoProfile -Command "Start-Sleep -Seconds 4; Start-Process 'http://localhost:3000'"
call npm.cmd run dev
if %errorlevel% neq 0 (
    echo.
    echo [오류] npm run dev 실행 중 문제가 발생했습니다.
    pause
)
