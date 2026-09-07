import { ProjectMaster } from "@/types";
import {
  FIREBASE_CONFIG,
  getFirebaseConfig,
  isFirebaseConfigured,
} from "./firebase-config";

// ============================================================================
// 1. 중앙 원격 데이터베이스 설정 및 인터페이스 정의
// ============================================================================
export interface CentralDbConfig {
  provider: "firebase" | "supabase" | "local";
  endpoint: string;
  roomKey: string;
}

export interface CentralSyncPayload {
  version: number;
  roomKey: string;
  updatedAt: string;
  senderDeviceId: string;
  projects: ProjectMaster[];
}

const DEFAULT_ROOM_KEY = "WITHTECH-VISIONPASS-2026";
const STORAGE_ROOM_KEY = "VISION_PASS_SYNC_ROOM_KEY";
const STORAGE_DEVICE_ID = "VISION_PASS_DEVICE_ID";
const STORAGE_PROJECTS_KEY = "VISION_PASS_PROJECTS_DATA_V8";
const STORAGE_LAST_SYNC_KEY = "VISION_PASS_LAST_SYNC_TIME";

// Supabase 환경변수 (옵션)
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// ============================================================================
// 2. 디바이스 식별자 & 방 키 관리
// ============================================================================
export function getDeviceId(): string {
  if (typeof window === "undefined") return "server";
  try {
    let id = localStorage.getItem(STORAGE_DEVICE_ID);
    if (!id) {
      id = "dev_" + Math.random().toString(36).substring(2, 10) + "_" + Date.now().toString(36);
      localStorage.setItem(STORAGE_DEVICE_ID, id);
    }
    return id;
  } catch {
    return "dev_default";
  }
}

export function getSyncRoomKey(): string {
  if (typeof window === "undefined") return DEFAULT_ROOM_KEY;
  try {
    return localStorage.getItem(STORAGE_ROOM_KEY) || DEFAULT_ROOM_KEY;
  } catch {
    return DEFAULT_ROOM_KEY;
  }
}

export function setSyncRoomKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    const clean = key.trim().toUpperCase() || DEFAULT_ROOM_KEY;
    localStorage.setItem(STORAGE_ROOM_KEY, clean);
  } catch {}
}

export function getCleanTopicKey(roomKey: string = getSyncRoomKey()): string {
  const clean = (roomKey || DEFAULT_ROOM_KEY).toLowerCase().replace(/[^a-z0-9]/g, "");
  return clean || "withtechvisionpass2026";
}

export function getActiveDbConfig(): CentralDbConfig {
  const roomKey = getSyncRoomKey();
  const fbConf = getFirebaseConfig();
  if (isFirebaseConfigured()) {
    return {
      provider: "firebase",
      endpoint: `https://${fbConf.projectId}.firebaseio.com`,
      roomKey,
    };
  }
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    return {
      provider: "supabase",
      endpoint: SUPABASE_URL,
      roomKey,
    };
  }
  return {
    provider: "local",
    endpoint: "local-storage",
    roomKey,
  };
}

// ============================================================================
// 3. GZIP 초경량 압축 / 해제 유틸리티
// ============================================================================
export async function compressJson(str: string): Promise<string> {
  try {
    if (typeof CompressionStream !== "undefined") {
      const byteArray = new TextEncoder().encode(str);
      const stream = new Blob([byteArray]).stream();
      const compressedStream = stream.pipeThrough(new CompressionStream("gzip"));
      const arrayBuffer = await new Response(compressedStream).arrayBuffer();
      const u8 = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < u8.length; i++) {
        binary += String.fromCharCode(u8[i]);
      }
      return "GZ:" + btoa(binary);
    }
  } catch (e) {
    console.warn("Compression fallback", e);
  }
  return str;
}

export async function decompressJson(str: string): Promise<string> {
  try {
    if (str.startsWith("GZ:")) {
      const base64 = str.slice(3);
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const stream = new Blob([bytes]).stream();
      const decompressedStream = stream.pipeThrough(new DecompressionStream("gzip"));
      return await new Response(decompressedStream).text();
    }
  } catch (e) {
    console.warn("Decompression fallback", e);
  }
  return str;
}

// ============================================================================
// 4. 로컬 브로드캐스트 채널 (동일 기기 브라우저 탭 간 0.001초 즉시 동기화)
// ============================================================================
let localBroadcastChannel: BroadcastChannel | null = null;
if (typeof window !== "undefined" && "BroadcastChannel" in window) {
  try {
    localBroadcastChannel = new BroadcastChannel("VISION_PASS_CENTRAL_LOCAL_SYNC");
  } catch {}
}

export function broadcastLocalUpdate(projects: ProjectMaster[]) {
  try {
    if (localBroadcastChannel) {
      localBroadcastChannel.postMessage({
        type: "PROJECTS_UPDATED",
        projects,
        updatedAt: new Date().toISOString(),
      });
    }
  } catch {}
}

export function subscribeLocalBroadcast(onUpdate: (projects: ProjectMaster[]) => void) {
  if (!localBroadcastChannel) return () => {};

  const handler = (e: MessageEvent) => {
    if (e.data && e.data.type === "PROJECTS_UPDATED" && Array.isArray(e.data.projects)) {
      onUpdate(e.data.projects);
    }
  };

  localBroadcastChannel.addEventListener("message", handler);
  return () => {
    localBroadcastChannel?.removeEventListener("message", handler);
  };
}

// ============================================================================
// 5. Google Firebase Firestore CDN 동적 로더 & 인스턴스 싱글톤
// ============================================================================
let firestoreDbInstance: any = null;
let firestoreLoadingPromise: Promise<any> | null = null;

async function getFirestoreDb(): Promise<any> {
  if (firestoreDbInstance) return firestoreDbInstance;
  if (typeof window === "undefined") return null;

  if (firestoreLoadingPromise) return firestoreLoadingPromise;

  firestoreLoadingPromise = new Promise((resolve) => {
    const config = getFirebaseConfig();
    if ((window as any).firebase?.firestore) {
      const fb = (window as any).firebase;
      if (!fb.apps.length) {
        fb.initializeApp(config);
      }
      firestoreDbInstance = fb.firestore();
      return resolve(firestoreDbInstance);
    }

    // 1. Firebase App CDN 스크립트 로드
    const scriptApp = document.createElement("script");
    scriptApp.src = "https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js";
    scriptApp.async = true;

    scriptApp.onload = () => {
      // 2. Firebase Firestore CDN 스크립트 로드
      const scriptFirestore = document.createElement("script");
      scriptFirestore.src = "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore-compat.js";
      scriptFirestore.async = true;

      scriptFirestore.onload = () => {
        try {
          const fb = (window as any).firebase;
          if (fb && !fb.apps.length) {
            fb.initializeApp(config);
          }
          firestoreDbInstance = fb?.firestore ? fb.firestore() : null;
          resolve(firestoreDbInstance);
        } catch (e) {
          console.warn("Firestore initialization error", e);
          resolve(null);
        }
      };

      scriptFirestore.onerror = () => resolve(null);
      document.head.appendChild(scriptFirestore);
    };

    scriptApp.onerror = () => resolve(null);
    document.head.appendChild(scriptApp);
  });

  return firestoreLoadingPromise;
}

// ============================================================================
// 6. 데이터 저장 및 조회 (로컬 스토리지 우선 보존 + Firestore 연동)
// ============================================================================
let memoryCacheProjects: ProjectMaster[] | null = null;

/**
 * 💾 프로젝트 데이터 저장 (LocalStorage 기본 + Firebase Firestore 동기화)
 */
export async function saveCentralProjects(
  projects: ProjectMaster[],
  roomKey: string = getSyncRoomKey()
): Promise<{ success: boolean; message?: string }> {
  // 1. 로컬 탭 즉시 전파 및 브라우저 로컬 스토리지 안전 저장 (스캔 데이터 즉시 보존)
  broadcastLocalUpdate(projects);
  const nowStr = new Date().toISOString();

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(projects));
      localStorage.setItem(STORAGE_LAST_SYNC_KEY, nowStr);
    } catch (e) {
      console.warn("LocalStorage save error", e);
    }
  }

  memoryCacheProjects = projects;

  const payload: CentralSyncPayload = {
    version: 8,
    roomKey: (roomKey || DEFAULT_ROOM_KEY).toUpperCase(),
    updatedAt: nowStr,
    senderDeviceId: getDeviceId(),
    projects,
  };

  const cleanDocKey = getCleanTopicKey(roomKey);

  // 2. [Firebase Firestore CDN 실시간 저장]
  if (isFirebaseConfigured()) {
    try {
      const db = await getFirestoreDb();
      if (db) {
        const cleanPayload = JSON.parse(JSON.stringify(payload));
        await db.collection("vision_pass_rooms").doc(cleanDocKey).set(cleanPayload);
        return { success: true, message: "Firebase Firestore 실시간 저장 완료" };
      }
    } catch (err) {
      console.warn("Firebase Firestore write warning", err);
    }
  }

  // 3. [Supabase REST 저장 - 환경변수 있을 경우]
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/projects_sync`, {
        method: "POST",
        headers: {
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "resolution=merge-duplicates",
        },
        body: JSON.stringify({
          room_key: payload.roomKey,
          data: payload,
          updated_at: nowStr,
        }),
      });
      if (res.ok) {
        return { success: true, message: "Supabase DB 저장 완료" };
      }
    } catch {}
  }

  return { success: true, message: "로컬 스토리지에 안전하게 저장되었습니다." };
}

/**
 * 📥 프로젝트 데이터 로드 (메모리 / 로컬 스토리지 / Firestore)
 */
export async function fetchCentralProjects(
  roomKey: string = getSyncRoomKey()
): Promise<{
  success: boolean;
  projects?: ProjectMaster[];
  updatedAt?: string;
  message?: string;
}> {
  // 1. 메모리 캐시 확인
  if (memoryCacheProjects && memoryCacheProjects.length > 0) {
    return {
      success: true,
      projects: memoryCacheProjects,
      updatedAt: new Date().toISOString(),
      message: "메모리 캐시 사용",
    };
  }

  const cleanDocKey = getCleanTopicKey(roomKey);

  // 2. [Firebase Firestore 조회]
  if (isFirebaseConfigured()) {
    try {
      const db = await getFirestoreDb();
      if (db) {
        const docSnapshot = await db.collection("vision_pass_rooms").doc(cleanDocKey).get();
        if (docSnapshot.exists) {
          const data = docSnapshot.data();
          if (data && Array.isArray(data.projects) && data.projects.length > 0) {
            memoryCacheProjects = data.projects;
            if (typeof window !== "undefined") {
              try {
                localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(data.projects));
                if (data.updatedAt) {
                  localStorage.setItem(STORAGE_LAST_SYNC_KEY, data.updatedAt);
                }
              } catch {}
            }
            return { success: true, projects: data.projects, updatedAt: data.updatedAt };
          }
        }
      }
    } catch (err) {
      console.warn("Firestore fetch error", err);
    }
  }

  // 3. [로컬 스토리지 캐시 로드]
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(STORAGE_PROJECTS_KEY);
      if (raw) {
        const projects = JSON.parse(raw);
        if (Array.isArray(projects) && projects.length > 0) {
          memoryCacheProjects = projects;
          return {
            success: true,
            projects,
            updatedAt: localStorage.getItem(STORAGE_LAST_SYNC_KEY) || new Date().toISOString(),
            message: "로컬 스토리지 데이터 로드",
          };
        }
      }
    } catch {}
  }

  return { success: false, message: "저장된 데이터를 찾을 수 없습니다." };
}

// ============================================================================
// 7. 실시간 동기화 리스너 (Firebase Firestore onSnapshot 전용)
// ============================================================================
export function subscribeCentralRealtime(
  onUpdate: (projects: ProjectMaster[]) => void,
  roomKey: string = getSyncRoomKey()
): () => void {
  if (typeof window === "undefined") return () => {};

  const cleanDocKey = getCleanTopicKey(roomKey);
  let isUnsubscribed = false;
  let unsubscribeFirestore: (() => void) | null = null;

  // Firebase Firestore가 설정되어 있을 때만 Firestore 실시간 onSnapshot 리스너 실행
  if (isFirebaseConfigured()) {
    getFirestoreDb().then((db) => {
      if (isUnsubscribed || !db) return;

      try {
        unsubscribeFirestore = db
          .collection("vision_pass_rooms")
          .doc(cleanDocKey)
          .onSnapshot(
            (docSnapshot: any) => {
              if (isUnsubscribed || !docSnapshot || !docSnapshot.exists) return;
              const data = docSnapshot.data();
              if (
                data &&
                Array.isArray(data.projects) &&
                data.projects.length > 0 &&
                data.senderDeviceId !== getDeviceId()
              ) {
                memoryCacheProjects = data.projects;
                if (typeof window !== "undefined") {
                  try {
                    localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(data.projects));
                    if (data.updatedAt) {
                      localStorage.setItem(STORAGE_LAST_SYNC_KEY, data.updatedAt);
                    }
                  } catch {}
                }
                onUpdate(data.projects);
              }
            },
            (error: any) => {
              console.warn("Firestore snapshot listener warning", error);
            }
          );
      } catch (err) {
        console.warn("Failed to attach Firestore snapshot listener", err);
      }
    });
  }

  return () => {
    isUnsubscribed = true;
    if (unsubscribeFirestore) {
      try {
        unsubscribeFirestore();
      } catch {}
    }
  };
}
