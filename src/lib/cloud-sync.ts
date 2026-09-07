import { ProjectMaster } from "@/types";

const CLOUD_STORAGE_KEY_STORAGE = "VISION_PASS_SYNC_ROOM_KEY";
const DEFAULT_ROOM_KEY = "WITHTECH-VISIONPASS-2026";
const STORAGE_PROJECTS_KEY = "VISION_PASS_PROJECTS_DATA_V8";
const STORAGE_LAST_SYNC_KEY = "VISION_PASS_LAST_SYNC_TIME";

// 🌐 실시간 크로스 디바이스(PC ↔ 모바일) 동기화용 Cloud KV 엔드포인트
const CLOUD_SYNC_BUCKET = "B5M7K8N2q7m4D2y8";
const CLOUD_API_BASE = `https://kvdb.io/${CLOUD_SYNC_BUCKET}`;

// 디바이스 ID (자기 자신의 메아리 루프 방지)
function getDeviceId(): string {
  if (typeof window === "undefined") return "server";
  try {
    let id = localStorage.getItem("VISION_PASS_DEVICE_ID");
    if (!id) {
      id = "dev_" + Math.random().toString(36).substring(2, 10) + "_" + Date.now().toString(36);
      localStorage.setItem("VISION_PASS_DEVICE_ID", id);
    }
    return id;
  } catch {
    return "dev_default";
  }
}

export function getSyncRoomKey(): string {
  if (typeof window === "undefined") return DEFAULT_ROOM_KEY;
  try {
    return localStorage.getItem(CLOUD_STORAGE_KEY_STORAGE) || DEFAULT_ROOM_KEY;
  } catch {
    return DEFAULT_ROOM_KEY;
  }
}

export function setSyncRoomKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    const clean = key.trim().toUpperCase() || DEFAULT_ROOM_KEY;
    localStorage.setItem(CLOUD_STORAGE_KEY_STORAGE, clean);
  } catch {}
}

export interface CloudSyncPayload {
  version: number;
  roomKey: string;
  updatedAt: string;
  senderDeviceId: string;
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
 * ☁️ PC ➔ 클라우드 ➔ 모바일 실시간 양방향 프로젝트 데이터 업로드
 */
export async function pushProjectsToCloud(
  projects: ProjectMaster[],
  roomKey: string = getSyncRoomKey()
): Promise<{ success: boolean; message?: string }> {
  // 1. 로컬 탭 전파 & LocalStorage 즉각 저장 (오프라인 무중단)
  broadcastLocalUpdate(projects);
  const nowStr = new Date().toISOString();

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(projects));
      localStorage.setItem(STORAGE_LAST_SYNC_KEY, nowStr);
    } catch {}
  }

  // 2. 실시간 클라우드 KV 서버로 전송 (PC와 모바일 공유)
  try {
    const cleanKey = encodeURIComponent(roomKey || DEFAULT_ROOM_KEY);
    const payload: CloudSyncPayload = {
      version: 8,
      roomKey: roomKey || DEFAULT_ROOM_KEY,
      updatedAt: nowStr,
      senderDeviceId: getDeviceId(),
      projects,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(`${CLOUD_API_BASE}/${cleanKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      return { success: true, message: "클라우드 동기화 완료" };
    }
  } catch (err) {
    // 네트워크 일시 불안정 시 로컬 저장으로 안전하게 유지
  }

  return { success: true, message: "로컬 저장 완료" };
}

/**
 * ☁️ 모바일/PC ➔ 클라우드 최신 프로젝트 데이터 실시간 다운로드
 */
export async function pullProjectsFromCloud(
  roomKey: string = getSyncRoomKey()
): Promise<{
  success: boolean;
  projects?: ProjectMaster[];
  updatedAt?: string;
  message?: string;
}> {
  const cleanKey = encodeURIComponent(roomKey || DEFAULT_ROOM_KEY);

  // 1. 클라우드 서버에서 최신 데이터 조회
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(`${CLOUD_API_BASE}/${cleanKey}?t=${Date.now()}`, {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const payload: CloudSyncPayload = await res.json();
      if (payload && Array.isArray(payload.projects) && payload.projects.length > 0) {
        return {
          success: true,
          projects: payload.projects,
          updatedAt: payload.updatedAt || new Date().toISOString(),
          message: "클라우드 데이터 수신 성공",
        };
      }
    }
  } catch (err) {
    // 클라우드 연결 실패 시 로컬 캐시로 안전하게 폴백
  }

  // 2. 오프라인 로컬 스토리지 폴백
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(STORAGE_PROJECTS_KEY);
      if (raw) {
        const projects = JSON.parse(raw);
        if (Array.isArray(projects) && projects.length > 0) {
          return {
            success: true,
            projects,
            updatedAt: localStorage.getItem(STORAGE_LAST_SYNC_KEY) || new Date().toISOString(),
            message: "로컬 캐시 데이터 로드",
          };
        }
      }
    } catch {}
  }

  return { success: false, message: "동기화 데이터를 찾을 수 없습니다." };
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
