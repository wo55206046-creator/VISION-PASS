import { ProjectMaster } from "@/types";

const CLOUD_STORAGE_KEY_STORAGE = "VISION_PASS_SYNC_ROOM_KEY";
const DEFAULT_ROOM_KEY = "WITHTECH-VISIONPASS-2026";
const JSONBLOB_STORAGE_MAP = "VISION_PASS_JSONBLOB_MAP";

/**
 * JSONBlob ID 매핑 관리 (룸키별 영구 Blob ID 보관)
 */
function getStoredBlobId(roomKey: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(JSONBLOB_STORAGE_MAP);
    if (raw) {
      const map = JSON.parse(raw);
      return map[roomKey] || null;
    }
  } catch {}
  return null;
}

function setStoredBlobId(roomKey: string, blobId: string) {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(JSONBLOB_STORAGE_MAP);
    const map = raw ? JSON.parse(raw) : {};
    map[roomKey] = blobId;
    localStorage.setItem(JSONBLOB_STORAGE_MAP, JSON.stringify(map));
  } catch {}
}

export function getSyncRoomKey(): string {
  if (typeof window === "undefined") return DEFAULT_ROOM_KEY;
  return localStorage.getItem(CLOUD_STORAGE_KEY_STORAGE) || DEFAULT_ROOM_KEY;
}

export function setSyncRoomKey(key: string): void {
  if (typeof window === "undefined") return;
  const clean = key.trim().toUpperCase() || DEFAULT_ROOM_KEY;
  localStorage.setItem(CLOUD_STORAGE_KEY_STORAGE, clean);
}

export interface CloudSyncPayload {
  version: number;
  roomKey: string;
  updatedAt: string;
  projects: ProjectMaster[];
}

// 🌐 동일 브라우저/로컬 탭 간 0.001초 즉시 동기화용 BroadcastChannel
let localBroadcastChannel: BroadcastChannel | null = null;
if (typeof window !== "undefined" && "BroadcastChannel" in window) {
  try {
    localBroadcastChannel = new BroadcastChannel("VISION_PASS_LOCAL_SYNC");
  } catch {}
}

/**
 * 로컬 브로드캐스트 채널로 변경사항 즉시 전파
 */
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

/**
 * 로컬 브로드캐스트 채널 리스너 등록
 */
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

/**
 * 클라우드로 프로젝트 데이터 실시간 푸시 (BroadcastChannel + JSONBlob)
 */
export async function pushProjectsToCloud(
  projects: ProjectMaster[],
  roomKey: string = getSyncRoomKey()
): Promise<{ success: boolean; message?: string }> {
  // 1. 로컬 탭에 즉각 전파 (0.001초)
  broadcastLocalUpdate(projects);

  const payload: CloudSyncPayload = {
    version: 1,
    roomKey,
    updatedAt: new Date().toISOString(),
    projects,
  };
  const payloadJson = JSON.stringify(payload);

  try {
    const existingBlobId = getStoredBlobId(roomKey);

    if (existingBlobId) {
      // 기존 Blob 업데이트 (PUT)
      const res = await fetch(`https://jsonblob.com/api/jsonBlob/${existingBlobId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: payloadJson,
      });

      if (res.ok) return { success: true };
    }

    // 신규 Blob 생성 (POST)
    const createRes = await fetch("https://jsonblob.com/api/jsonBlob", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: payloadJson,
    });

    if (createRes.ok) {
      const location = createRes.headers.get("Location");
      if (location) {
        const blobId = location.split("/").pop();
        if (blobId) setStoredBlobId(roomKey, blobId);
      }
      return { success: true };
    }
  } catch (err) {
    // 오프라인 / 네트워크 지연 시에도 로컬 동기화는 정상 보장
  }

  return { success: true, message: "로컬 동기화 완료" };
}

/**
 * 클라우드에서 최신 프로젝트 데이터 실시간 풀 (조용하고 안전한 조회)
 */
export async function pullProjectsFromCloud(
  roomKey: string = getSyncRoomKey()
): Promise<{
  success: boolean;
  projects?: ProjectMaster[];
  updatedAt?: string;
  message?: string;
}> {
  if (typeof window === "undefined") return { success: false };
  const blobId = getStoredBlobId(roomKey);
  if (!blobId) return { success: false };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(`https://jsonblob.com/api/jsonBlob/${blobId}?t=${Date.now()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      const candidateProjects = Array.isArray(data)
        ? data
        : data?.projects && Array.isArray(data.projects)
        ? data.projects
        : null;

      if (candidateProjects && candidateProjects.length > 0) {
        return {
          success: true,
          projects: candidateProjects,
          updatedAt: data.updatedAt || new Date().toISOString(),
        };
      }
    }
  } catch {
    // 네트워크 실패 시 조용히 무시
  }

  return { success: false };
}

/**
 * JSON 백업 파일 다운로드
 */
export function exportBackupFile(projects: ProjectMaster[]) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const jsonStr = JSON.stringify(
    {
      appName: "VISION-PASS",
      version: "1.0",
      exportedAt: new Date().toISOString(),
      projects,
    },
    null,
    2
  );

  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `VISION_PASS_BACKUP_${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * JSON 백업 파일 불러오기
 */
export function importBackupFile(
  file: File
): Promise<{ success: boolean; projects?: ProjectMaster[]; message?: string }> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const parsed = JSON.parse(text);

        const projectList = Array.isArray(parsed)
          ? parsed
          : parsed.projects && Array.isArray(parsed.projects)
          ? parsed.projects
          : null;

        if (projectList && projectList.length > 0) {
          resolve({ success: true, projects: projectList });
        } else {
          resolve({
            success: false,
            message: "파일 내에 유효한 프로젝트 목록이 없습니다.",
          });
        }
      } catch (err) {
        resolve({
          success: false,
          message: "JSON 파일 파싱에 실패했습니다. 올바른 백업 파일인지 확인해주세요.",
        });
      }
    };
    reader.onerror = () => {
      resolve({ success: false, message: "파일을 읽는 중 오류가 발생했습니다." });
    };
    reader.readAsText(file);
  });
}
