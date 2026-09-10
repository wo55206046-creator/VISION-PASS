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

// Supabase 환경변수 (기본값 설정)
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://aodczkjhpejexhqwnhly.supabase.co";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvZGN6a2pocGVqZXhocXduaGx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4ODk5MzQsImV4cCI6MjEwNDQ2NTkzNH0.PzHD510QZ_dVCJC60eP1eGgKjX3Nn6dIJd3JozLSdjg";

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
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    return {
      provider: "supabase",
      endpoint: SUPABASE_URL,
      roomKey,
    };
  }
  const fbConf = getFirebaseConfig();
  if (isFirebaseConfigured()) {
    return {
      provider: "firebase",
      endpoint: `https://${fbConf.projectId}.firebaseio.com`,
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

  let supabaseSaved = false;
  let firestoreSaved = false;

  // 1. [Supabase REST 실시간 저장]
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const headers: Record<string, string> = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
      };

      const res = await fetch(`${SUPABASE_URL}/rest/v1/projects_sync?on_conflict=room_key`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          room_key: payload.roomKey,
          data: payload,
          updated_at: nowStr,
        }),
      });

      if (res.ok) {
        supabaseSaved = true;
      } else {
        const errBody = await res.text();
        console.warn("Supabase save error response:", res.status, errBody);
      }
    } catch (err: any) {
      console.warn("Supabase write warning", err);
    }
  }

  // 2. [Firebase Firestore CDN 실시간 저장 (동시 동기화)]
  if (isFirebaseConfigured()) {
    try {
      const db = await getFirestoreDb();
      if (db) {
        const cleanPayload = JSON.parse(JSON.stringify(payload));
        await db.collection("vision_pass_rooms").doc(cleanDocKey).set(cleanPayload);
        firestoreSaved = true;
      }
    } catch (err) {
      console.warn("Firebase Firestore write warning", err);
    }
  }

  if (supabaseSaved && firestoreSaved) {
    return { success: true, message: `클라우드 실시간 저장 완료 (Supabase + Firebase, ${projects.length}개 프로젝트)` };
  } else if (supabaseSaved) {
    return { success: true, message: `Supabase 클라우드 실시간 저장 완료 (${projects.length}개 프로젝트)` };
  } else if (firestoreSaved) {
    return { success: true, message: `Firebase Firestore 실시간 저장 완료 (${projects.length}개 프로젝트)` };
  }

  return { success: true, message: "로컬 스토리지에 안전하게 저장되었습니다." };
}

/**
 * 📥 프로젝트 데이터 로드 (메모리 / Supabase / Firestore / 로컬 스토리지 레거시 전수 복구)
 */
export async function fetchCentralProjects(
  roomKey: string = getSyncRoomKey()
): Promise<{
  success: boolean;
  projects?: ProjectMaster[];
  updatedAt?: string;
  message?: string;
}> {
  const cleanRoom = (roomKey || DEFAULT_ROOM_KEY).toUpperCase();
  const cleanDocKey = getCleanTopicKey(roomKey);

  // 1. [Supabase REST 조회 시도]
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/projects_sync?room_key=eq.${encodeURIComponent(cleanRoom)}&select=*`,
        {
          headers: {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
          },
        }
      );
      if (res.ok) {
        const rows = await res.json();
        if (
          Array.isArray(rows) &&
          rows.length > 0 &&
          rows[0].data?.projects &&
          Array.isArray(rows[0].data.projects) &&
          rows[0].data.projects.length > 0
        ) {
          const payload = rows[0].data;
          memoryCacheProjects = payload.projects;
          if (typeof window !== "undefined") {
            try {
              localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(payload.projects));
              if (payload.updatedAt) {
                localStorage.setItem(STORAGE_LAST_SYNC_KEY, payload.updatedAt);
              }
            } catch {}
          }
          return {
            success: true,
            projects: payload.projects,
            updatedAt: payload.updatedAt || rows[0].updated_at,
            message: `Supabase 클라우드 데이터 동기화 완료 (${payload.projects.length}개 프로젝트)`,
          };
        }
      }
    } catch (err: any) {
      console.warn("Supabase fetch warning, trying Firestore fallback", err);
    }
  }

  // 2. [Firebase Firestore 조회 시도 (Supabase에 없거나 이전 7개 프로젝트 DB 연동 복원)]
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
            // Supabase에도 자동 동기화(마이그레이션 백필)
            saveCentralProjects(data.projects, roomKey).catch(() => {});

            return {
              success: true,
              projects: data.projects,
              updatedAt: data.updatedAt || new Date().toISOString(),
              message: `Firebase Firestore 데이터 연동 복원 완료 (${data.projects.length}개 프로젝트)`,
            };
          }
        }
      }
    } catch (err) {
      console.warn("Firestore fetch warning", err);
    }
  }

  // 3. [로컬 스토리지 캐시 및 레거시(V7, V6, V5, V2, V1...) 전수 탐색 복구]
  if (typeof window !== "undefined") {
    try {
      const KNOWN_KEYS = [
        STORAGE_PROJECTS_KEY,
        "VISION_PASS_PROJECTS_DATA_V8",
        "VISION_PASS_PROJECTS_DATA_V7",
        "VISION_PASS_PROJECTS_DATA_V6",
        "VISION_PASS_PROJECTS_DATA_V5",
        "VISION_PASS_PROJECTS_DATA_V4",
        "VISION_PASS_PROJECTS_DATA_V3",
        "VISION_PASS_PROJECTS_DATA_V2",
        "VISION_PASS_PROJECTS_DATA_V1",
        "VISION_PASS_PROJECTS_V2",
        "VISION_PASS_PROJECTS_V1",
        "VISION_PASS_PROJECTS_DATA",
        "VISION_PASS_PROJECTS",
      ];

      let bestProjects: ProjectMaster[] | null = null;

      for (const k of KNOWN_KEYS) {
        const raw = localStorage.getItem(k);
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].pjtCode !== undefined) {
              if (!bestProjects || parsed.length > bestProjects.length) {
                bestProjects = parsed;
              }
            }
          } catch {}
        }
      }

      // localStorage 전체 키 전수 스캔 (사용자 정의 키나 임시 백업 탐색)
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && !KNOWN_KEYS.includes(k)) {
          try {
            const raw = localStorage.getItem(k);
            if (raw && (raw.includes("pjtCode") || raw.includes("equipmentUnits"))) {
              const parsed = JSON.parse(raw);
              const list = Array.isArray(parsed)
                ? parsed
                : parsed?.projects && Array.isArray(parsed.projects)
                ? parsed.projects
                : null;
              if (list && list.length > 0 && list[0].pjtCode) {
                if (!bestProjects || list.length > bestProjects.length) {
                  bestProjects = list;
                }
              }
            }
          } catch {}
        }
      }

      if (bestProjects && bestProjects.length > 0) {
        memoryCacheProjects = bestProjects;
        localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(bestProjects));
        // 클라우드에도 업로드 시도
        saveCentralProjects(bestProjects, roomKey).catch(() => {});
        return {
          success: true,
          projects: bestProjects,
          updatedAt: localStorage.getItem(STORAGE_LAST_SYNC_KEY) || new Date().toISOString(),
          message: `로컬 레거시 데이터 복원 완료 (${bestProjects.length}개 프로젝트)`,
        };
      }
    } catch {}
  }

  return { success: false, message: `[${cleanRoom}] 방에 저장된 데이터를 찾을 수 없습니다.` };
}

// ============================================================================
// 7. 실시간 동기화 리스너 (Supabase 스마트 폴링 & Firebase Firestore onSnapshot)
// ============================================================================
export function subscribeCentralRealtime(
  onUpdate: (projects: ProjectMaster[]) => void,
  roomKey: string = getSyncRoomKey()
): () => void {
  if (typeof window === "undefined") return () => {};

  const cleanRoom = (roomKey || DEFAULT_ROOM_KEY).toUpperCase();
  const cleanDocKey = getCleanTopicKey(roomKey);
  let isUnsubscribed = false;
  let unsubscribeFirestore: (() => void) | null = null;
  let supabasePollTimer: any = null;

  // 1. Supabase 실시간 동기화 (3.5초 주기 스마트 폴링)
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    let lastKnownTimestamp = "";
    supabasePollTimer = setInterval(async () => {
      if (isUnsubscribed) return;
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/projects_sync?room_key=eq.${encodeURIComponent(cleanRoom)}&select=data,updated_at`,
          {
            headers: {
              "apikey": SUPABASE_ANON_KEY,
              "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
            },
          }
        );
        if (res.ok) {
          const rows = await res.json();
          if (Array.isArray(rows) && rows.length > 0 && rows[0].data) {
            const payload = rows[0].data;
            const updatedTime = payload.updatedAt || rows[0].updated_at || "";
            if (
              updatedTime &&
              updatedTime !== lastKnownTimestamp &&
              payload.senderDeviceId !== getDeviceId() &&
              Array.isArray(payload.projects)
            ) {
              lastKnownTimestamp = updatedTime;
              memoryCacheProjects = payload.projects;
              if (typeof window !== "undefined") {
                try {
                  localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(payload.projects));
                  localStorage.setItem(STORAGE_LAST_SYNC_KEY, updatedTime);
                } catch {}
              }
              onUpdate(payload.projects);
            }
          }
        }
      } catch {}
    }, 3500);
  }

  // 2. Firebase Firestore가 설정되어 있을 때 Firestore 실시간 리스너 실행
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
    if (supabasePollTimer) {
      clearInterval(supabasePollTimer);
    }
    if (unsubscribeFirestore) {
      try {
        unsubscribeFirestore();
      } catch {}
    }
  };
}

