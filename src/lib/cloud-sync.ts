import { ProjectMaster } from "@/types";
import {
  saveCentralProjects,
  fetchCentralProjects,
  subscribeCentralRealtime,
  getSyncRoomKey,
  setSyncRoomKey,
  broadcastLocalUpdate,
  subscribeLocalBroadcast,
  compressJson,
  decompressJson,
  getDeviceId,
  CentralSyncPayload,
  CentralDbConfig,
} from "./central-db";
import { enqueueSyncTask, processSyncQueue, initOfflineQueueListener } from "./offline-sync-queue";

// central-db 및 offline-sync-queue 전체 re-export
export * from "./central-db";
export * from "./offline-sync-queue";

// 기존 CloudSyncPayload 하위 호환성 별칭
export type CloudSyncPayload = CentralSyncPayload;

/**
 * ☁️ PC ➔ 중앙 DB ➔ 모바일 실시간 양방향 프로젝트 데이터 업로드
 */
export async function pushProjectsToCloud(
  projects: ProjectMaster[],
  roomKey: string = getSyncRoomKey()
): Promise<{ success: boolean; message?: string }> {
  // 오프라인 대비 큐에 먼저 안전 적재
  enqueueSyncTask(projects, roomKey);
  return await saveCentralProjects(projects, roomKey);
}

/**
 * 📥 모바일/PC ➔ 중앙 DB 최신 프로젝트 데이터 조회
 */
export async function pullProjectsFromCloud(
  roomKey: string = getSyncRoomKey(),
  force: boolean = false
): Promise<{
  success: boolean;
  projects?: ProjectMaster[];
  updatedAt?: string;
  message?: string;
}> {
  return await fetchCentralProjects(roomKey);
}

/**
 * ⚡ 0.05초 초고속 실시간 스트림 리스너
 */
export function subscribeCloudRealtime(
  onUpdate: (projects: ProjectMaster[]) => void,
  roomKey: string = getSyncRoomKey()
): () => void {
  return subscribeCentralRealtime(onUpdate, roomKey);
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
