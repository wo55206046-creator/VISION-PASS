import { ProjectMaster } from "@/types";
import { mergeProjectLists, countVerifiedSerials } from "./project-merger";
import {
  getDeletedProjectKeys,
  markProjectsAsDeletedBulk,
  isProjectDeleted,
  cleanStorageFromDeleted,
} from "./deleted-projects";

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
  deletedKeys?: string[];
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
 * 🔍 로컬 브라우저에 저장된 최신 프로젝트 데이터 직접 조회
 */
function loadDirectLocalProjects(): ProjectMaster[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw =
      localStorage.getItem(STORAGE_PROJECTS_KEY) ||
      localStorage.getItem("VISION_PASS_PERMANENT_SERIALS_SNAPSHOT");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const delKeys = getDeletedProjectKeys();
        const filtered = parsed.filter((p) => p && !isProjectDeleted(p.id, p.pjtCode, delKeys));
        return filtered;
      }
    }
  } catch {}
  return null;
}

/**
 * 💾 프로젝트 데이터 저장 (Supabase 클라우드 실시간 저장 + LocalStorage 안전 보관)
 */
export async function saveCentralProjects(
  projects: ProjectMaster[],
  roomKey: string = getSyncRoomKey()
): Promise<{ success: boolean; message?: string }> {
  const delKeys = getDeletedProjectKeys();
  const cleanProjects = (projects || []).filter((p) => p && !isProjectDeleted(p.id, p.pjtCode, delKeys));

  // 1. 로컬 탭 즉시 전파 및 브라우저 로컬 스토리지 안전 저장 (스캔 데이터 즉시 보존)
  broadcastLocalUpdate(cleanProjects);
  const nowStr = new Date().toISOString();

  if (typeof window !== "undefined") {
    try {
      const pJson = JSON.stringify(cleanProjects);
      localStorage.setItem(STORAGE_PROJECTS_KEY, pJson);
      localStorage.setItem("VISION_PASS_PERMANENT_SERIALS_SNAPSHOT", pJson);
      localStorage.setItem(STORAGE_LAST_SYNC_KEY, nowStr);
      cleanStorageFromDeleted(delKeys);
    } catch (e) {
      console.warn("LocalStorage save error", e);
    }
  }

  memoryCacheProjects = cleanProjects;

  const payload: CentralSyncPayload = {
    version: 8,
    roomKey: (roomKey || DEFAULT_ROOM_KEY).toUpperCase(),
    updatedAt: nowStr,
    senderDeviceId: getDeviceId(),
    projects: cleanProjects,
    deletedKeys: Array.from(delKeys),
  };

  // 2. [Supabase REST 실시간 저장 - 3단계 안전 Upsert 보장]
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const baseHeaders: Record<string, string> = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      };

      const bodyPayload = JSON.stringify({
        room_key: payload.roomKey,
        data: payload,
        updated_at: nowStr,
      });

      // 1단계: PostgREST merge-duplicates Upsert 시도
      let res = await fetch(`${SUPABASE_URL}/rest/v1/projects_sync?on_conflict=room_key`, {
        method: "POST",
        headers: {
          ...baseHeaders,
          "Prefer": "resolution=merge-duplicates",
        },
        body: bodyPayload,
      });

      // 2단계: Upsert 실패 시(테이블 고유키 제약조건 차이 등), PATCH(수정) 시도
      if (!res.ok) {
        res = await fetch(`${SUPABASE_URL}/rest/v1/projects_sync?room_key=eq.${encodeURIComponent(payload.roomKey)}`, {
          method: "PATCH",
          headers: {
            ...baseHeaders,
            "Prefer": "return=representation",
          },
          body: JSON.stringify({
            data: payload,
            updated_at: nowStr,
          }),
        });

        // 3단계: 기존 레코드가 없어 0건 수정되었거나 오류인 경우 일반 INSERT 시도
        if (!res.ok) {
          res = await fetch(`${SUPABASE_URL}/rest/v1/projects_sync`, {
            method: "POST",
            headers: baseHeaders,
            body: bodyPayload,
          });
        }
      }

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
          if (payload.deletedKeys && Array.isArray(payload.deletedKeys)) {
            markProjectsAsDeletedBulk(payload.deletedKeys);
          }
          const delKeys = getDeletedProjectKeys();
          cleanStorageFromDeleted(delKeys);

          const cloudProjects = (payload.projects || []).filter((p) => p && !isProjectDeleted(p.id, p.pjtCode, delKeys));
          const localProjects = (loadDirectLocalProjects() || []).filter((p) => p && !isProjectDeleted(p.id, p.pjtCode, delKeys));

          // ★ 핵심: 클라우드 데이터로 로컬을 무조건 덮어쓰지 않고 스마트 병합!
          // 로컬에 이미 입력된 시리얼 번호는 절대 지워지지 않도록 보호하고, 삭제된 프로젝트는 배제!
          const merged = localProjects && localProjects.length > 0
            ? mergeProjectLists(localProjects, cloudProjects, delKeys)
            : cloudProjects;

          memoryCacheProjects = merged;
          if (typeof window !== "undefined") {
            try {
              const mJson = JSON.stringify(merged);
              localStorage.setItem(STORAGE_PROJECTS_KEY, mJson);
              localStorage.setItem("VISION_PASS_PERMANENT_SERIALS_SNAPSHOT", mJson);
              if (payload.updatedAt) {
                localStorage.setItem(STORAGE_LAST_SYNC_KEY, payload.updatedAt);
              }
            } catch {}
          }

          // 로컬에 시리얼이 더 많이 입력되어 있다면 클라우드로 즉시 역동기화(Auto-heal)
          if (localProjects && countVerifiedSerials(merged) > countVerifiedSerials(cloudProjects)) {
            saveCentralProjects(merged, roomKey).catch(() => {});
          }

          return {
            success: true,
            projects: merged,
            updatedAt: payload.updatedAt || rows[0].updated_at,
            message: `Supabase 클라우드 데이터 동기화 완료 (${merged.length}개 프로젝트)`,
          };
        }
      }
    } catch (err: any) {
      console.warn("Supabase fetch warning, checking local storage", err);
    }
  }

  // 2. [로컬 스토리지 캐시 및 레거시 전수 복구]
  if (typeof window !== "undefined") {
    try {
      const KNOWN_KEYS = [
        "VISION_PASS_PERMANENT_SERIALS_SNAPSHOT",
        STORAGE_PROJECTS_KEY,
        "VISION_PASS_PROJECTS_DATA_V8",
        "VISION_PASS_PROJECTS_DATA_V7",
        "VISION_PASS_PROJECTS_DATA_V6",
      ];

      // 현재 V8 또는 영구 백업에 데이터가 있으면 최우선 반환
      const directLocal = loadDirectLocalProjects();
      if (directLocal && directLocal.length > 0) {
        memoryCacheProjects = directLocal;
        return {
          success: true,
          projects: directLocal,
          updatedAt: localStorage.getItem(STORAGE_LAST_SYNC_KEY) || new Date().toISOString(),
          message: `로컬 스토리지 데이터 로드 완료 (${directLocal.length}개 프로젝트)`,
        };
      }

      let bestProjects: ProjectMaster[] | null = null;
      let bestSerialCount = -1;

      const delKeys = getDeletedProjectKeys();
      cleanStorageFromDeleted(delKeys);

      for (const k of KNOWN_KEYS) {
        const raw = localStorage.getItem(k);
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0 && (parsed[0].pjtCode !== undefined || parsed[0].site !== undefined)) {
              const sanitized = parsed.filter((p) => p && !isProjectDeleted(p.id, p.pjtCode, delKeys));
              const serialCount = countVerifiedSerials(sanitized);
              if (!bestProjects || serialCount > bestSerialCount) {
                bestProjects = sanitized;
                bestSerialCount = serialCount;
              }
            }
          } catch {}
        }
      }

      if (bestProjects && bestProjects.length > 0) {
        memoryCacheProjects = bestProjects;
        const pJson = JSON.stringify(bestProjects);
        localStorage.setItem(STORAGE_PROJECTS_KEY, pJson);
        localStorage.setItem("VISION_PASS_PERMANENT_SERIALS_SNAPSHOT", pJson);
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
// 6. 실시간 동기화 리스너 (Supabase 3.5초 스마트 폴링 + 로컬 시리얼 100% 보존)
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
              if (payload.deletedKeys && Array.isArray(payload.deletedKeys)) {
                markProjectsAsDeletedBulk(payload.deletedKeys);
              }
              const delKeys = getDeletedProjectKeys();
              cleanStorageFromDeleted(delKeys);

              const incomingProjects = (payload.projects || []).filter((p) => p && !isProjectDeleted(p.id, p.pjtCode, delKeys));
              const localProjects = (loadDirectLocalProjects() || []).filter((p) => p && !isProjectDeleted(p.id, p.pjtCode, delKeys));

              // ★ 스마트 병합을 적용하여 기존 로컬 시리얼 100% 보존 & 삭제 프로젝트 배제
              const merged = localProjects && localProjects.length > 0
                ? mergeProjectLists(localProjects, incomingProjects, delKeys)
                : incomingProjects;

              memoryCacheProjects = merged;
              if (typeof window !== "undefined") {
                try {
                  const mJson = JSON.stringify(merged);
                  localStorage.setItem(STORAGE_PROJECTS_KEY, mJson);
                  localStorage.setItem("VISION_PASS_PERMANENT_SERIALS_SNAPSHOT", mJson);
                  localStorage.setItem(STORAGE_LAST_SYNC_KEY, updatedTime);
                } catch {}
              }
              onUpdate(merged);
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

