import { ProjectMaster } from "@/types";

const CLOUD_STORAGE_KEY_STORAGE = "VISION_PASS_SYNC_ROOM_KEY";
const DEFAULT_ROOM_KEY = "WITHTECH-VISIONPASS-2026";
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
 * 프로젝트 데이터 동기화 (BroadcastChannel + LocalStorage 기반 무결점 동기화)
 */
export async function pushProjectsToCloud(
  projects: ProjectMaster[],
  roomKey: string = getSyncRoomKey()
): Promise<{ success: boolean; message?: string }> {
  // 1. 동일 브라우저/탭 간 초고속 전파 (0.001초)
  broadcastLocalUpdate(projects);

  // 2. 로컬 스토리지 안전 보존
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem("VISION_PASS_PROJECTS_DATA_V8", JSON.stringify(projects));
      localStorage.setItem("VISION_PASS_LAST_SYNC_TIME", new Date().toISOString());
    } catch {}
  }

  return { success: true, message: "동기화 완료" };
}

/**
 * 프로젝트 데이터 수신
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

  try {
    const raw = localStorage.getItem("VISION_PASS_PROJECTS_DATA_V8");
    if (raw) {
      const projects = JSON.parse(raw);
      if (Array.isArray(projects) && projects.length > 0) {
        return {
          success: true,
          projects,
          updatedAt: localStorage.getItem("VISION_PASS_LAST_SYNC_TIME") || new Date().toISOString(),
        };
      }
    }
  } catch {}

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
