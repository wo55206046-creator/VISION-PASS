/**
 * ============================================================================
 * 🌐 VISION-PASS Google Firebase Firestore 실시간 동기화 설정
 * ============================================================================
 * 
 * Firebase 콘솔(https://console.firebase.google.com)에서 무료 Spark 요금제 프로젝트 생성 후
 * [프로젝트 설정] > [내 앱] > [웹 앱]에서 발급받은 firebaseConfig를 아래에 입력하거나
 * .env.local 환경변수 또는 브라우저 로컬스토리지로 지정할 수 있습니다.
 */

export const DEFAULT_FIREBASE_CONFIG = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyAFHdV3Z3YWeGwqz0EhdplN-qfg5pPJBL0",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "vision-pass.firebaseapp.com",
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DB_URL || "https://vision-pass-default-rtdb.firebaseio.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "vision-pass",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "vision-pass.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "859226758620",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:859226758620:web:af5cb0e530f02c76624319",
};

export const FIREBASE_STORAGE_CONFIG_KEY = "VISION_PASS_FIREBASE_CUSTOM_CONFIG";

/**
 * 브라우저 로컬 스토리지에 저장된 사용자 정의 Firebase 설정 또는 기본 설정을 반환
 */
export function getFirebaseConfig() {
  if (typeof window !== "undefined") {
    try {
      const customRaw = localStorage.getItem(FIREBASE_STORAGE_CONFIG_KEY);
      if (customRaw) {
        const parsed = JSON.parse(customRaw);
        if (parsed.apiKey && parsed.projectId) {
          return parsed;
        }
      }
    } catch {}
  }
  return DEFAULT_FIREBASE_CONFIG;
}

export const FIREBASE_CONFIG = DEFAULT_FIREBASE_CONFIG;

/**
 * Firebase 설정이 실제 유효한 사용자 키로 입력되어 있는지 검증하는 함수
 */
export function isFirebaseConfigured(): boolean {
  const config = getFirebaseConfig();
  return Boolean(
    config.apiKey &&
    config.projectId &&
    !config.apiKey.includes("YOUR_") &&
    config.apiKey.startsWith("AIzaSy")
  );
}

/**
 * 런타임에 브라우저에서 Firebase 설정을 저장하는 헬퍼 함수
 */
export function saveCustomFirebaseConfig(config: typeof DEFAULT_FIREBASE_CONFIG) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FIREBASE_STORAGE_CONFIG_KEY, JSON.stringify(config));
  } catch {}
}
