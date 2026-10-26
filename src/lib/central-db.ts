import { ProjectMaster, PjtModelTemplate } from "@/types";
import { mergeProjectLists, countVerifiedSerials } from "./project-merger";
import {
  getDeletedProjectKeys,
  markProjectsAsDeletedBulk,
  isProjectDeleted,
  unmarkProjectAsDeleted,
  getDeletedPartKeys,
  markPartsAsDeletedBulk,
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
  templates?: PjtModelTemplate[];
  deletedKeys?: string[];
  deletedPartKeys?: string[];
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

/**
 * 🩺 Supabase 중앙 데이터베이스 연결 상태 및 실제 클라우드 적재 프로젝트 수량 정밀 진단
 */
export async function pingCentralDb(): Promise<{
  ok: boolean;
  latencyMs: number;
  message: string;
  cloudProjectCount?: number;
  cloudUpdatedTime?: string;
  cloudPjtCodes?: string[];
  rlsWarning?: boolean;
}> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, latencyMs: 0, message: "Supabase 설정 누락 (오프라인 모드)" };
  }
  const roomKey = getSyncRoomKey();
  const start = performance.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/projects_sync?room_key=eq.${encodeURIComponent(roomKey)}&select=room_key,data,updated_at&order=updated_at.desc&limit=1`,
      {
        method: "GET",
        headers: {
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - start);
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0 && rows[0].data) {
        const payload = rows[0].data;
        const pList = payload.projects || [];
        const pjtCodes = pList.map((p: any) => p.pjtCode || p.id).filter(Boolean);
        return {
          ok: true,
          latencyMs,
          cloudProjectCount: pList.length,
          cloudUpdatedTime: payload.updatedAt || rows[0].updated_at,
          cloudPjtCodes: pjtCodes,
          message: `DB 정상 연결 (${latencyMs}ms) | 클라우드 실제 적재: ${pList.length}개 PJT (${pjtCodes.slice(0, 5).join(", ")}${pjtCodes.length > 5 ? " 외 " + (pjtCodes.length - 5) + "개" : ""})`,
        };
      }
      return {
        ok: true,
        latencyMs,
        cloudProjectCount: 0,
        message: `DB 연결 정상 (${latencyMs}ms) | 현재 [${roomKey}] 방에 저장된 데이터 없음 (신규 생성 대기)`,
      };
    }
    const errText = await res.text().catch(() => "");
    const isRls = errText.includes("row-level security") || res.status === 401 || res.status === 403;
    return {
      ok: false,
      latencyMs,
      rlsWarning: isRls,
      message: isRls
        ? `Supabase RLS(보안정책) 차단 오류 (HTTP ${res.status}): 테이블 쓰기 권한이 필요합니다.`
        : `DB 응답 오류: HTTP ${res.status} (${errText})`,
    };
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      ok: false,
      latencyMs,
      message: err.name === "AbortError" ? "DB 연결 타임아웃 (6초 초과)" : `DB 연결 실패: ${err.message || "오프라인"}`,
    };
  }
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

export const STORAGE_TEMPLATES_KEY = "VISION_PASS_PJT_TEMPLATES_V2";

/**
 * 💡 로컬에 저장된 사용자 커스텀/표준 템플릿 목록 로드
 */
export function loadDirectLocalTemplates(): PjtModelTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw =
      localStorage.getItem(STORAGE_TEMPLATES_KEY) ||
      localStorage.getItem("VISION_PASS_TEMPLATES_V2");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return [];
}

/**
 * 💾 클라우드에서 동기화된 템플릿 목록을 로컬 스토리지에 안전 반영 및 전파
 */
export function saveDirectLocalTemplates(templates: PjtModelTemplate[]): void {
  if (typeof window === "undefined" || !Array.isArray(templates) || templates.length === 0) return;
  try {
    localStorage.setItem(STORAGE_TEMPLATES_KEY, JSON.stringify(templates));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("VISION_PASS_TEMPLATES_UPDATED", { detail: templates }));
    }
  } catch {}
}

/**
 * 🔍 로컬 브라우저에 저장된 최신 프로젝트 데이터 직접 조회
 */
export function loadDirectLocalProjects(): ProjectMaster[] | null {
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
 * 💾 프로젝트 데이터 저장 (Supabase 클라우드 실시간 저장 + LocalStorage 안전 보관 + 템플릿 동기화)
 */
export async function saveCentralProjects(
  projects: ProjectMaster[],
  roomKey: string = getSyncRoomKey()
): Promise<{ success: boolean; message?: string }> {
  const delKeys = getDeletedProjectKeys();
  const delPartKeys = getDeletedPartKeys();
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
      cleanStorageFromDeleted(delKeys, delPartKeys);
    } catch (e) {
      console.warn("LocalStorage save error, attempting cleanup...", e);
      try {
        // 용량 부족 시 구버전 레거시 스냅샷 정리 후 재시도
        for (let v = 1; v <= 7; v++) {
          localStorage.removeItem(`VISION_PASS_PROJECTS_DATA_V${v}`);
        }
        localStorage.removeItem("VISION_PASS_PROJECTS_V1");
        localStorage.removeItem("VISION_PASS_PROJECTS_V2");
        localStorage.removeItem("VISION_PASS_PROJECTS");
        const pJson = JSON.stringify(cleanProjects);
        localStorage.setItem(STORAGE_PROJECTS_KEY, pJson);
        localStorage.setItem("VISION_PASS_PERMANENT_SERIALS_SNAPSHOT", pJson);
      } catch (retryErr) {
        console.error("Critical: LocalStorage save failed even after cleanup", retryErr);
      }
    }
  }

  memoryCacheProjects = cleanProjects;

  const localTemplates = loadDirectLocalTemplates();

  const payload: CentralSyncPayload = {
    version: 8,
    roomKey: (roomKey || DEFAULT_ROOM_KEY).toUpperCase(),
    updatedAt: nowStr,
    senderDeviceId: getDeviceId(),
    projects: cleanProjects,
    templates: localTemplates && localTemplates.length > 0 ? localTemplates : undefined,
    deletedKeys: Array.from(delKeys),
    deletedPartKeys: Array.from(delPartKeys),
  };

  // 2. [Supabase REST 실시간 저장 - 3단계 안전 Upsert 보장]
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const baseHeaders: Record<string, string> = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      };

      // 전송용 표준 행 데이터 페이로드
      const rowData = {
        room_key: payload.roomKey,
        data: payload,
        updated_at: nowStr,
      };
      // 전송용 표준 행 데이터
      const standardPayload = {
        room_key: payload.roomKey,
        data: payload,
        updated_at: nowStr,
      };

      let res: Response | null = null;
      let isSuccess = false;

      // 1순위: Supabase 공식 Upsert (room_key 기본키 중복 시 자동 UPDATE)
      try {
        res = await fetch(`${SUPABASE_URL}/rest/v1/projects_sync`, {
          method: "POST",
          headers: {
            ...baseHeaders,
            "Prefer": "resolution=merge-duplicates,return=representation",
          },
          body: JSON.stringify(standardPayload),
        });
        if (res.ok) {
          isSuccess = true;
        }
      } catch (upsertErr) {
        console.warn("Supabase upsert error, trying fallback PATCH/POST:", upsertErr);
      }

      // 2순위 (폴백): 기존 레코드 유무 확인 후 PATCH 또는 POST
      if (!isSuccess) {
        try {
          const checkRes = await fetch(
            `${SUPABASE_URL}/rest/v1/projects_sync?room_key=eq.${encodeURIComponent(payload.roomKey)}&select=room_key&limit=1`,
            { headers: baseHeaders }
          );
          let hasExisting = false;
          if (checkRes.ok) {
            const rows = await checkRes.json();
            if (Array.isArray(rows) && rows.length > 0) {
              hasExisting = true;
            }
          }

          if (hasExisting) {
            // 기존 레코드 덮어쓰기 (PATCH)
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
            if (res.ok) isSuccess = true;
          } else {
            // 신규 레코드 삽입 (POST)
            res = await fetch(`${SUPABASE_URL}/rest/v1/projects_sync`, {
              method: "POST",
              headers: {
                ...baseHeaders,
                "Prefer": "return=representation",
              },
              body: JSON.stringify(standardPayload),
            });
            if (res.ok) isSuccess = true;
          }
        } catch (fallbackErr) {
          console.warn("Supabase fallback write failed:", fallbackErr);
        }
      }

      if (isSuccess) {
        return { success: true, message: `Supabase 클라우드 실시간 저장 완료 (${projects.length}개 프로젝트)` };
      } else {
        const errBody = res ? await res.text().catch(() => "Unknown error") : "저장 응답 없음";
        const isRls = errBody.includes("row-level security") || res?.status === 401 || res?.status === 403;
        console.warn("Supabase save error response:", res?.status, errBody);
        return {
          success: false,
          message: isRls
            ? `Supabase RLS 보안정책 오류: projects_sync 테이블의 RLS를 비활성화하거나 anon 쓰기 정책을 허용해주세요.`
            : `클라우드 DB 저장 실패 (HTTP ${res?.status || "ERR"}): ${errBody}`,
        };
      }
    } catch (err: any) {
      console.warn("Supabase write warning", err);
      return {
        success: false,
        message: `클라우드 DB 연결 오류: ${err.message || "네트워크를 확인해주세요"}`,
      };
    }
  }

  return { success: true, message: "로컬 스토리지에 안전하게 저장되었습니다." };
}

/**
 * 📥 프로젝트 데이터 로드 (Supabase 클라우드 / 로컬 스토리지 레거시 전수 복구)
 */
export async function fetchCentralProjects(
  roomKey: string = getSyncRoomKey(),
  forceOverwrite: boolean = false
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
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/projects_sync?room_key=eq.${encodeURIComponent(cleanRoom)}&select=*&order=updated_at.desc&limit=1`,
        {
          headers: {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
          },
          signal: controller.signal,
        }
      );
      clearTimeout(timer);

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
          if (payload.templates && Array.isArray(payload.templates) && payload.templates.length > 0) {
            saveDirectLocalTemplates(payload.templates);
          }
          const directLocalProjects = loadDirectLocalProjects() || [];
          if (payload.deletedKeys && Array.isArray(payload.deletedKeys)) {
            markProjectsAsDeletedBulk(payload.deletedKeys, directLocalProjects);
          }
          if (payload.deletedPartKeys && Array.isArray(payload.deletedPartKeys)) {
            markPartsAsDeletedBulk(payload.deletedPartKeys);
          }
          const delKeys = getDeletedProjectKeys();
          const delPartKeys = getDeletedPartKeys();
          cleanStorageFromDeleted(delKeys, delPartKeys);

          const rawCloudProjects: ProjectMaster[] = Array.isArray(payload.projects) ? payload.projects : [];
          // 🛡️ 핵심: 클라우드에 현재 적재되어 있는 프로젝트는 로컬 삭제 묘비(Tombstone)에서 즉시 사면/해제!
          for (const cp of rawCloudProjects) {
            if (cp) unmarkProjectAsDeleted(cp.id, cp.pjtCode);
          }

          const delKeys = getDeletedProjectKeys();
          const delPartKeys = getDeletedPartKeys();
          cleanStorageFromDeleted(delKeys, delPartKeys);

          const cloudProjects = rawCloudProjects.filter((p: ProjectMaster) => p && !isProjectDeleted(p.id, p.pjtCode, delKeys));
          const localProjects = directLocalProjects.filter((p: ProjectMaster) => p && !isProjectDeleted(p.id, p.pjtCode, delKeys));

          // 🛡️ 핵심: 클라우드에 프로젝트가 1개라도 있다면 무조건 클라우드 프로젝트 전수 채택! (엣지/스마트폰 100% 동기화 보장)
          let merged: ProjectMaster[];
          if (forceOverwrite || cloudProjects.length >= localProjects.length || localProjects.length === 0) {
            merged = cloudProjects.length > 0 ? cloudProjects : localProjects;
          } else {
            merged = mergeProjectLists(localProjects, cloudProjects, delKeys, delPartKeys);
          }

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

          // 로컬에 더 최신 수정사항이 있는 경우에만 클라우드로 역동기화(Auto-heal)
          const hasNewerLocal = localProjects && localProjects.some((lp: ProjectMaster) => {
            const cp = cloudProjects.find((c: ProjectMaster) => c.id === lp.id || c.pjtCode === lp.pjtCode);
            return cp && new Date(lp.updatedAt || 0) > new Date(cp.updatedAt || 0);
          });
          if (hasNewerLocal && localProjects.length >= cloudProjects.length) {
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
      ];

      // 현재 V8 또는 영구 백업에 데이터가 이미 있으면 최우선 반환 (과거 레거시 덮어쓰기 절대 금지!)
      const directLocal = loadDirectLocalProjects();
      if (directLocal && directLocal.length > 0) {
        memoryCacheProjects = directLocal;
        // 최신 데이터가 건재하므로 저장공간 확보를 위해 구버전 레거시 키 정리
        try {
          for (let v = 1; v <= 7; v++) {
            localStorage.removeItem(`VISION_PASS_PROJECTS_DATA_V${v}`);
          }
          localStorage.removeItem("VISION_PASS_PROJECTS_V1");
          localStorage.removeItem("VISION_PASS_PROJECTS_V2");
          localStorage.removeItem("VISION_PASS_PROJECTS");
        } catch {}
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
  let lastKnownTimestamp = "";

  // Supabase 실시간 동기화 (즉시 실행 + 2초 주기 초고속 스마트 폴링 + 탭 포커스 즉시 감지)
  const checkUpdates = async () => {
    if (isUnsubscribed) return;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;

    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/projects_sync?room_key=eq.${encodeURIComponent(cleanRoom)}&select=data,updated_at&order=updated_at.desc&limit=1`,
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
          const incomingProjectsRaw = payload.projects;

          if (
            updatedTime &&
            Array.isArray(incomingProjectsRaw) &&
            incomingProjectsRaw.length > 0
          ) {
            // 🛡️ 핵심: 클라우드에서 내려온 프로젝트는 로컬 삭제 묘비(Tombstone)에서 즉시 사면/해제!
            for (const ip of incomingProjectsRaw) {
              if (ip) unmarkProjectAsDeleted(ip.id, ip.pjtCode);
            }

            const delKeys = getDeletedProjectKeys();
            const delPartKeys = getDeletedPartKeys();
            const localProjects = (loadDirectLocalProjects() || []).filter((p) => p && !isProjectDeleted(p.id, p.pjtCode, delKeys));

            const isTimeChanged = updatedTime !== lastKnownTimestamp;
            const isCountDifferent = incomingProjectsRaw.length !== localProjects.length;

            // 1. 클라우드에 더 많은 데이터가 있거나 최신 업데이트인 경우 -> 로컬 전수 자동 반영!
            if (
              incomingProjectsRaw.length > localProjects.length ||
              (isTimeChanged && incomingProjectsRaw.length >= localProjects.length)
            ) {
              lastKnownTimestamp = updatedTime;
              if (payload.templates && Array.isArray(payload.templates) && payload.templates.length > 0) {
                saveDirectLocalTemplates(payload.templates);
              }
              if (payload.deletedKeys && Array.isArray(payload.deletedKeys)) {
                markProjectsAsDeletedBulk(payload.deletedKeys, localProjects);
              }
              if (payload.deletedPartKeys && Array.isArray(payload.deletedPartKeys)) {
                markPartsAsDeletedBulk(payload.deletedPartKeys);
              }
              cleanStorageFromDeleted(delKeys, delPartKeys);

              const incomingProjects = incomingProjectsRaw.filter((p: ProjectMaster) => p && !isProjectDeleted(p.id, p.pjtCode, delKeys));

              const merged = incomingProjects.length >= localProjects.length
                ? incomingProjects
                : mergeProjectLists(localProjects, incomingProjects, delKeys, delPartKeys);

              memoryCacheProjects = merged;
              try {
                const mJson = JSON.stringify(merged);
                localStorage.setItem(STORAGE_PROJECTS_KEY, mJson);
                localStorage.setItem("VISION_PASS_PERMANENT_SERIALS_SNAPSHOT", mJson);
                localStorage.setItem(STORAGE_LAST_SYNC_KEY, updatedTime);
              } catch {}
              onUpdate(merged);
            }
            // 2. 만약 로컬에 10개가 있고 클라우드에 5개만 있는 경우 -> 클라우드로 10개 즉시 자동 업로드(Auto-Heal)!
            else if (localProjects.length > incomingProjectsRaw.length && localProjects.length > 0) {
              lastKnownTimestamp = new Date().toISOString();
              saveCentralProjects(localProjects, cleanRoom).catch(() => {});
            }
          }
        }
      }
    } catch {}
  };

  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    // 마운트 즉시 1회 실행 후 2초 주기 폴링
    checkUpdates();
    supabasePollTimer = setInterval(checkUpdates, 2000);

    // 사용자가 창으로 복귀하거나 모바일 화면을 켰을 때 0.05초만에 즉시 업데이트
    const onVisibilityOrFocus = () => {
      checkUpdates();
    };
    window.addEventListener("focus", onVisibilityOrFocus);
    document.addEventListener("visibilitychange", onVisibilityOrFocus);

    return () => {
      isUnsubscribed = true;
      if (supabasePollTimer) {
        clearInterval(supabasePollTimer);
      }
      window.removeEventListener("focus", onVisibilityOrFocus);
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
    };
  }

  return () => {
    isUnsubscribed = true;
  };
}

