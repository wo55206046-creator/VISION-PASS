import { ProjectMaster } from "@/types";
import { countVerifiedSerials } from "./project-merger";

// ============================================================================
// 1. 중앙 원격 데이터베이스 설정 및 인터페이스 정의 (Supabase 전용)
// ============================================================================
export interface CentralDbConfig {
  provider: "supabase" | "local";
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
// 5. 데이터 저장 및 조회 (Supabase 클라우드 + 로컬 스토리지 전수 복구)
// ============================================================================
let memoryCacheProjects: ProjectMaster[] | null = null;

/**
 * 💾 프로젝트 데이터 저장 (Supabase 클라우드 실시간 저장 + LocalStorage 안전 보관)
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
      const pJson = JSON.stringify(projects);
      localStorage.setItem(STORAGE_PROJECTS_KEY, pJson);
      localStorage.setItem("VISION_PASS_PERMANENT_SERIALS_SNAPSHOT", pJson);
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

  // 2. [Supabase REST 실시간 저장]
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
        return { success: true, message: `Supabase 클라우드 실시간 저장 완료 (${projects.length}개 프로젝트)` };
      } else {
        const errBody = await res.text();
        console.warn("Supabase save error response:", res.status, errBody);
      }
    } catch (err: any) {
      console.warn("Supabase write warning", err);
    }
  }

  return { success: true, message: "로컬 스토리지에 안전하게 저장되었습니다." };
}

/**
 * 📥 프로젝트 데이터 로드 (Supabase 클라우드 / 로컬 스토리지 레거시 전수 복구)
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
      console.warn("Supabase fetch warning, checking local storage", err);
    }
  }

  // 2. [로컬 스토리지 캐시 및 레거시(V7, V6, V5, V2, V1...) 전수 탐색 복구]
  if (typeof window !== "undefined") {
    try {
      const KNOWN_KEYS = [
        "VISION_PASS_PERMANENT_SERIALS_SNAPSHOT",
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
      let bestSerialCount = -1;

      for (const k of KNOWN_KEYS) {
        const raw = localStorage.getItem(k);
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0 && (parsed[0].pjtCode !== undefined || parsed[0].site !== undefined)) {
              const serialCount = countVerifiedSerials(parsed);
              if (!bestProjects || serialCount > bestSerialCount || (serialCount === bestSerialCount && parsed.length > bestProjects.length)) {
                bestProjects = parsed;
                bestSerialCount = serialCount;
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
              if (list && list.length > 0 && (list[0].pjtCode || list[0].site)) {
                const serialCount = countVerifiedSerials(list);
                if (!bestProjects || serialCount > bestSerialCount || (serialCount === bestSerialCount && list.length > bestProjects.length)) {
                  bestProjects = list;
                  bestSerialCount = serialCount;
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
// 6. 실시간 동기화 리스너 (Supabase 3.5초 스마트 폴링)
// ============================================================================
export function subscribeCentralRealtime(
  onUpdate: (projects: ProjectMaster[]) => void,
  roomKey: string = getSyncRoomKey()
): () => void {
  if (typeof window === "undefined") return () => {};

  const cleanRoom = (roomKey || DEFAULT_ROOM_KEY).toUpperCase();
  let isUnsubscribed = false;
  let supabasePollTimer: any = null;

  // Supabase 실시간 동기화 (3.5초 주기 스마트 폴링)
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

  return () => {
    isUnsubscribed = true;
    if (supabasePollTimer) {
      clearInterval(supabasePollTimer);
    }
  };
}

