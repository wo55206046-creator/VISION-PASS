@echo off
chcp 65001 >nul
title [VISION-PASS] 깃허브 원클릭 자동 동기화 (Push)
cd /d "%~dp0"

echo ================================================================
echo   [VISION-PASS] 깃허브(GitHub) 자동 업로드를 시작합니다...
echo ================================================================
echo.

echo 1. 변경된 모든 파일 등록 중 (git add)...
git add .
if %errorlevel% neq 0 (
    echo [오류] git add 실패
    goto ERROR
)

echo 2. 자동 커밋 생성 중 (git commit)...
for /f "tokens=1-3 delims=-/ " %%a in ("%date%") do set TODAY=%%a-%%b-%%c
for /f "tokens=1-2 delims=: " %%a in ("%time%") do set NOW=%%a:%%b
git commit -m "update: auto-sync %TODAY% %NOW%"
if %errorlevel% neq 0 (
    echo [안내] 새로 커밋할 변경사항이 없거나 이미 최신 상태입니다.
)

echo 3. 깃허브로 전송 중 (git push origin main)...
git push origin main
if %errorlevel% neq 0 (
    echo [오류] 깃허브 전송(git push)에 실패했습니다.
    goto ERROR
)

echo.
echo ================================================================
echo   ★ 깃허브 업로드가 성공적으로 완료되었습니다!
echo ================================================================
echo.
timeout /t 3 >nul
exit /b 0

:ERROR
echo.
echo 깃허브 동기화 중 오류가 발생했습니다. 창을 닫으려면 아무 키나 누르세요.
pause >nul
exit /b 1
