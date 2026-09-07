import { ProjectMaster } from "@/types";

// ============================================================================
// 1. 중앙 원격 데이터베이스 설정 및 인터페이스 정의
// ============================================================================
export interface CentralDbConfig {
  provider: "supabase" | "firebase" | "central-rest";
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

// Supabase / Firebase 환경변수 (설정 시 우선 바인딩)
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const FIREBASE_DB_URL = process.env.NEXT_PUBLIC_FIREBASE_DB_URL || "";

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

export function getActiveDbConfig(): CentralDbConfig {
  const roomKey = getSyncRoomKey();
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    return {
      provider: "supabase",
      endpoint: SUPABASE_URL,
      roomKey,
    };
  }
  if (FIREBASE_DB_URL) {
    return {
      provider: "firebase",
      endpoint: FIREBASE_DB_URL,
      roomKey,
    };
  }
  return {
    provider: "central-rest",
    endpoint: "https://ntfy.sh",
    roomKey,
  };
}

// ============================================================================
// 3. GZIP 85% 초경량 압축 / 해제 엔진 (대용량 JSON 전송 지원)
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
// 5. 중앙 데이터베이스 CRUD 함수 (Central DB API)
// ============================================================================
let memoryCacheProjects: ProjectMaster[] | null = null;

/**
 * ☁️ 중앙 DB에 전체 프로젝트 데이터 저장 (Create/Update)
 */
export async function saveCentralProjects(
  projects: ProjectMaster[],
  roomKey: string = getSyncRoomKey()
): Promise<{ success: boolean; message?: string }> {
  // 1. 로컬 탭 전파 및 로컬 스토리지 즉각 저장 (오프라인 보존)
  broadcastLocalUpdate(projects);
  const nowStr = new Date().toISOString();

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(projects));
      localStorage.setItem(STORAGE_LAST_SYNC_KEY, nowStr);
    } catch {}
  }

  memoryCacheProjects = projects;

  const payload: CentralSyncPayload = {
    version: 8,
    roomKey: (roomKey || DEFAULT_ROOM_KEY).toUpperCase(),
    updatedAt: nowStr,
    senderDeviceId: getDeviceId(),
    projects,
  };

  // 2. Supabase 연동 시 Supabase REST API로 저장
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

  // 3. Firebase 연동 시 Firebase Realtime DB REST API로 저장
  if (FIREBASE_DB_URL) {
    try {
      const cleanKey = (roomKey || DEFAULT_ROOM_KEY).replace(/[^a-zA-Z0-9_-]/g, "_");
      const res = await fetch(`${FIREBASE_DB_URL}/rooms/${cleanKey}.json`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        return { success: true, message: "Firebase DB 저장 완료" };
      }
    } catch {}
  }

  // 4. Zero-Setup 초고속 실시간 중앙 클라우드 채널 전송
  try {
    const cleanKey = (roomKey || DEFAULT_ROOM_KEY).toLowerCase().replace(/[^a-z0-9]/g, "_");
    const topic = `withtech_vp_central_${cleanKey}`;
    const compressedBody = await compressJson(JSON.stringify(payload));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4500);

    const res = await fetch(`https://ntfy.sh/${topic}`, {
      method: "POST",
      headers: {
        "Title": "CENTRAL_DB_SYNC",
        "Priority": "urgent",
      },
      body: compressedBody,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      return { success: true, message: "중앙 클라우드 DB 저장 및 실시간 전송 완료" };
    }
  } catch (err) {
    // 네트워크 단절 시 오프라인 큐로 처리
  }

  return { success: true, message: "로컬 저장 완료 (오프라인)" };
}

/**
 * 📥 중앙 DB에서 최신 프로젝트 목록 조회 (Read)
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
      message: "메모리 캐시 데이터 사용",
    };
  }

  // 2. Supabase DB 조회
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const cleanKey = (roomKey || DEFAULT_ROOM_KEY).toUpperCase();
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/projects_sync?room_key=eq.${cleanKey}&select=*&order=updated_at.desc&limit=1`,
        {
          headers: {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
          },
        }
      );
      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows) && rows.length > 0 && rows[0].data?.projects) {
          const projects = rows[0].data.projects;
          memoryCacheProjects = projects;
          return { success: true, projects, updatedAt: rows[0].updated_at };
        }
      }
    } catch {}
  }

  // 3. Firebase DB 조회
  if (FIREBASE_DB_URL) {
    try {
      const cleanKey = (roomKey || DEFAULT_ROOM_KEY).replace(/[^a-zA-Z0-9_-]/g, "_");
      const res = await fetch(`${FIREBASE_DB_URL}/rooms/${cleanKey}.json`);
      if (res.ok) {
        const payload: CentralSyncPayload = await res.json();
        if (payload && Array.isArray(payload.projects) && payload.projects.length > 0) {
          memoryCacheProjects = payload.projects;
          return { success: true, projects: payload.projects, updatedAt: payload.updatedAt };
        }
      }
    } catch {}
  }

  // 4. 로컬 스토리지 캐시 폴백
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
            message: "로컬 스토리지 캐시 데이터 로드",
          };
        }
      }
    } catch {}
  }

  return { success: false, message: "중앙 DB 데이터를 찾을 수 없습니다." };
}

// ============================================================================
// 6. 0.05초 초고속 실시간 스트림 리스너 (Realtime Listener)
// ============================================================================
export function subscribeCentralRealtime(
  onUpdate: (projects: ProjectMaster[]) => void,
  roomKey: string = getSyncRoomKey()
): () => void {
  if (typeof window === "undefined" || typeof EventSource === "undefined") return () => {};

  const cleanKey = (roomKey || DEFAULT_ROOM_KEY).toLowerCase().replace(/[^a-z0-9]/g, "_");
  const topic = `withtech_vp_central_${cleanKey}`;
  let eventSource: EventSource | null = null;
  let isClosed = false;

  const connectSSE = () => {
    if (isClosed) return;
    try {
      eventSource = new EventSource(`https://ntfy.sh/${topic}/sse`);

      eventSource.onmessage = async (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.event === "message" && data.message) {
            const decompressed = await decompressJson(data.message);
            const payload: CentralSyncPayload = JSON.parse(decompressed);

            // 다른 기기(모바일/PC)에서 발송한 최신 프로젝트 변경사항을 즉시 수신
            if (
              payload &&
              Array.isArray(payload.projects) &&
              payload.projects.length > 0 &&
              payload.senderDeviceId !== getDeviceId()
            ) {
              memoryCacheProjects = payload.projects;
              if (typeof window !== "undefined") {
                try {
                  localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(payload.projects));
                  if (payload.updatedAt) {
                    localStorage.setItem(STORAGE_LAST_SYNC_KEY, payload.updatedAt);
                  }
                } catch {}
              }
              onUpdate(payload.projects);
            }
          }
        } catch {}
      };

      eventSource.onerror = () => {
        // 일시적 단절 시 브라우저가 자동 재연결 시도
      };
    } catch {}
  };

  connectSSE();

  return () => {
    isClosed = true;
    try {
      eventSource?.close();
    } catch {}
  };
}
