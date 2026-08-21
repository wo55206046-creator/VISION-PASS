import { ProjectMaster } from "@/types";

const CLOUD_STORAGE_KEY_STORAGE = "VISION_PASS_SYNC_ROOM_KEY";
const DEFAULT_ROOM_KEY = "WITHTECH-VISIONPASS-2026";
const KVDB_BUCKET_URL = "https://kvdb.io/Ank3p9L87m4aK9uE2vN6pQ/"; // 무료 공개 KV 엔드포인트

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

/**
 * 클라우드로 프로젝트 데이터 실시간 푸시
 */
export async function pushProjectsToCloud(
  projects: ProjectMaster[],
  roomKey: string = getSyncRoomKey()
): Promise<{ success: boolean; message?: string }> {
  try {
    const payload: CloudSyncPayload = {
      version: 1,
      roomKey,
      updatedAt: new Date().toISOString(),
      projects,
    };

    const url = `${KVDB_BUCKET_URL}${encodeURIComponent(roomKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      return { success: true };
    } else {
      return { success: false, message: `서버 응답 오류 (${res.status})` };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("Cloud push error:", msg);
    return { success: false, message: msg };
  }
}

/**
 * 클라우드에서 최신 프로젝트 데이터 실시간 풀
 */
export async function pullProjectsFromCloud(
  roomKey: string = getSyncRoomKey()
): Promise<{
  success: boolean;
  projects?: ProjectMaster[];
  updatedAt?: string;
  message?: string;
}> {
  try {
    const url = `${KVDB_BUCKET_URL}${encodeURIComponent(roomKey)}?t=${Date.now()}`;
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
    });

    if (res.status === 404) {
      return {
        success: false,
        message: "클라우드에 저장된 데이터가 없습니다. 먼저 [클라우드로 내보내기]를 실행하세요.",
      };
    }

    if (!res.ok) {
      return { success: false, message: `서버 응답 오류 (${res.status})` };
    }

    const data: CloudSyncPayload = await res.json();
    if (data && Array.isArray(data.projects) && data.projects.length > 0) {
      return {
        success: true,
        projects: data.projects,
        updatedAt: data.updatedAt,
      };
    }

    return { success: false, message: "유효한 프로젝트 데이터 형식이 아닙니다." };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("Cloud pull error:", msg);
    return { success: false, message: msg };
  }
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
