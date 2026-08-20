@echo off
chcp 65001 > nul
title VISION-PASS Android APK 빌더

echo ================================================================
echo   [VISION-PASS] 안드로이드 앱 (APK) 자동 빌드 스크립트
echo ================================================================
echo.

echo [1/4] Next.js 정적 웹 번들(out) 빌드 중...
call npm run build
if %errorlevel% neq 0 (
    echo [오류] Next.js 빌드에 실패하였습니다.
    pause
    exit /b %errorlevel%
)

echo.
echo [2/4] Android 플랫폼 초기화 및 동기화 확인 중...
if not exist "android" (
    echo [안내] 안드로이드 네이티브 프로젝트 폴더를 생성합니다...
    call npx cap add android
)

echo [3/4] 최신 웹 리소스를 Android 프로젝트로 동기화(Sync) 중...
call npx cap sync android
if %errorlevel% neq 0 (
    echo [오류] Capacitor 동기화에 실패하였습니다.
    pause
    exit /b %errorlevel%
)

echo.
echo [4/4] APK 빌드 진행
echo ----------------------------------------------------------------
echo 1) Android Studio로 열어서 직접 빌드 (권장: 메뉴 - Build - Build APK)
echo 2) Gradle CLI로 debug APK 즉시 빌드 시도 (JDK/SDK 환경변수 필요)
echo ----------------------------------------------------------------
set /p choice="원하시는 작업 번호를 입력해주세요 (1 또는 2): "

if "%choice%"=="1" (
    echo Android Studio를 실행합니다...
    call npx cap open android
) else if "%choice%"=="2" (
    echo Gradle 빌드를 시작합니다...
    cd android
    call gradlew.bat assembleDebug
    if exist "app\build\outputs\apk\debug\app-debug.apk" (
        echo.
        echo ================================================================
        echo  [성공] APK 파일이 정상적으로 생성되었습니다!
        echo  경로: android\app\build\outputs\apk\debug\app-debug.apk
        echo ================================================================
        explorer "app\build\outputs\apk\debug"
    ) else (
        echo [안내] Gradle CLI 빌드가 완료되지 않았습니다. Android Studio에서 열어 빌드해주세요.
        cd ..
        call npx cap open android
    )
    cd ..
) else (
    echo Android Studio를 실행합니다...
    call npx cap open android
)

echo.
pause
