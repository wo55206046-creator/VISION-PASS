import { ProjectMaster } from "@/types";

const CLOUD_STORAGE_KEY_STORAGE = "VISION_PASS_SYNC_ROOM_KEY";
const DEFAULT_ROOM_KEY = "WITHTECH-VISIONPASS-2026";
const KVDB_BUCKET_STORAGE = "VISION_PASS_KVDB_BUCKET_ID";

/**
 * KVDB 영구 버킷 자동 발급/캐시 (만료/삭제 시 자동 재생성)
 */
async function getOrProvisionKvdbBucket(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  let bucket = localStorage.getItem(KVDB_BUCKET_STORAGE);

  if (!bucket) {
    try {
      const res = await fetch("https://kvdb.io", { method: "POST" });
      if (res.ok) {
        const text = (await res.text()).trim();
        if (text && text.length > 5) {
          bucket = text;
          localStorage.setItem(KVDB_BUCKET_STORAGE, bucket);
        }
      }
    } catch {
      return null;
    }
  }
  return bucket;
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
 * 클라우드로 프로젝트 데이터 실시간 푸시 (자동 버킷 발급 & 무중단 동기화)
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

  const cleanKey = encodeURIComponent(roomKey.replace(/[^a-zA-Z0-9_-]/g, ""));
  let bucket = await getOrProvisionKvdbBucket();

  if (!bucket) {
    return { success: true, message: "로컬 동기화 완료" };
  }

  try {
    const url = `https://kvdb.io/${bucket}/${cleanKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payloadJson,
    });

    if (res.ok) {
      return { success: true };
    }

    // 만약 이전 버킷이 만료(404)된 경우 버킷 재발급 후 재시도
    if (res.status === 404) {
      localStorage.removeItem(KVDB_BUCKET_STORAGE);
      const newBucket = await getOrProvisionKvdbBucket();
      if (newBucket) {
        const retryRes = await fetch(`https://kvdb.io/${newBucket}/${cleanKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payloadJson,
        });
        if (retryRes.ok) return { success: true };
      }
    }
  } catch (err) {
    // 오프라인 / 네트워크 지연 시에도 로컬 데이터는 안전하게 보존
  }

  return { success: true, message: "로컬 캐시 동기화 완료" };
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
  const bucket = localStorage.getItem(KVDB_BUCKET_STORAGE);
  if (!bucket) {
    return { success: false, message: "동기화 버킷 미등록" };
  }

  const cleanKey = encodeURIComponent(roomKey.replace(/[^a-zA-Z0-9_-]/g, ""));

  try {
    const url = `https://kvdb.io/${bucket}/${cleanKey}?t=${Date.now()}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(url, {
      method: "GET",
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
