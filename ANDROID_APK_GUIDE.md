# 📱 VISION-PASS 안드로이드 앱 (APK) 생성 및 설치 가이드

본 문서는 **VISION-PASS** 시리얼 리포트 시스템을 안드로이드 스마트폰/태블릿에 직접 설치할 수 있는 **`.apk` 파일**로 빌드하는 방법을 안내합니다.

---

## 🚀 방법 1. 원클릭 자동 빌드 스크립트 실행 (가장 추천)

프로젝트 루트 폴더에 생성된 **`build-apk.bat`** 파일을 더블 클릭하여 실행합니다.

1. **`build-apk.bat`** 더블 클릭 실행
2. 자동으로 Next.js 정적 빌드(`out/`) 생성 및 안드로이드 프로젝트 동기화 진행
3. 프롬프트에서 `1` (Android Studio로 열기) 또는 `2` (CLI 즉시 빌드) 선택
   - **`1` 선택 시**: Android Studio가 자동으로 열립니다. 상단 메뉴에서 `Build` ➔ `Build Bundle(s) / APK(s)` ➔ `Build APK(s)`를 누르면 즉시 APK가 생성됩니다.
   - **`2` 선택 시**: 콘솔에서 직접 `gradlew assembleDebug`가 실행되어 `android/app/build/outputs/apk/debug/app-debug.apk`가 생성되고 탐색기가 자동으로 열립니다.

---

## 🛠️ 방법 2. VS Code / 터미널 명령어로 빌드

### 1단계: 패키지 설치
```bash
npm install
```

### 2단계: 안드로이드 프로젝트 동기화
```bash
npm run android:sync
```
*(처음 실행 시 `npx cap add android`가 자동으로 안드로이드 네이티브 폴더를 구성합니다.)*

### 3단계: Android Studio 열기 및 APK 추출
```bash
npm run android:open
```
- Android Studio 화면이 열리면 상단 메뉴:
  👉 **`Build` ➔ `Build Bundle(s) / APK(s)` ➔ `Build APK(s)`** 클릭
- 빌드가 완료되면 우측 하단 팝업에서 **`locate`** 링크를 클릭하여 생성된 `app-debug.apk`를 확인할 수 있습니다.

---

## 📲 스마트폰에 APK 설치 방법

1. 생성된 **`app-debug.apk`** 파일을 카카오톡, 구글 드라이브, 또는 USB 케이블을 통해 안드로이드 기기(갤럭시 등)로 전송합니다.
2. 기기에서 다운로드한 `app-debug.apk`를 터치하여 설치합니다.
   *(※ "출처를 알 수 없는 앱 설치 허용" 팝업이 뜨면 **허용**을 선택해주세요)*
3. 앱을 실행하면 PC와 동일하게 카메라 OCR 스캔 및 PJT/호기별 시리얼 리스트 관리, 엑셀 저장을 독립된 모바일 앱으로 사용할 수 있습니다!

---

## ⚙️ 주요 네이티브 설정 내역
- **앱 ID (Package Name)**: `com.withtech.visionpass`
- **앱 이름**: `VISION-PASS`
- **카메라 권한**: Storage-Zero 인메모리 광학 OCR 스캔 지원 (`android.permission.CAMERA`)
- **저장소 권한**: 엑셀(.xlsx) 보고서 모바일 다운로드 지원
- **오프라인 동작**: 완전한 독립형 로컬 저장소 및 정적 번들 탑재
