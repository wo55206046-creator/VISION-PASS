import { ProjectMaster } from "@/types";
import { saveCentralProjects, getSyncRoomKey } from "./central-db";

const OFFLINE_QUEUE_KEY = "VISION_PASS_OFFLINE_MUTATION_QUEUE_V1";

export interface OfflineSyncTask {
  id: string;
  roomKey: string;
  createdAt: string;
  retryCount: number;
  projects: ProjectMaster[];
}

/**
 * 📦 오프라인 큐에서 대기 중인 작업 목록 로드
 */
export function getOfflineQueue(): OfflineSyncTask[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

/**
 * 📥 오프라인 큐에 새 동기화 작업 추가 (가장 최신 프로젝트 상태로 큐 압축)
 */
export function enqueueSyncTask(projects: ProjectMaster[], roomKey: string = getSyncRoomKey()): void {
  if (typeof window === "undefined") return;
  try {
    const task: OfflineSyncTask = {
      id: "task_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
      roomKey,
      createdAt: new Date().toISOString(),
      retryCount: 0,
      projects,
    };

    // 최신 상태 단일 큐로 압축하여 불필요한 중복 네트워크 요청 방지
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify([task]));
  } catch {}
}

/**
 * 🧹 오프라인 큐 비우기
 */
export function clearOfflineQueue(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(OFFLINE_QUEUE_KEY);
  } catch {}
}

/**
 * ⚡ 대기 중인 오프라인 큐 처리 및 중앙 DB 자동 Flush
 */
export async function processSyncQueue(): Promise<{ success: boolean; processedCount: number }> {
  if (typeof window === "undefined") return { success: true, processedCount: 0 };
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { success: false, processedCount: 0 };
  }

  const queue = getOfflineQueue();
  if (queue.length === 0) return { success: true, processedCount: 0 };

  const latestTask = queue[queue.length - 1];
  try {
    const res = await saveCentralProjects(latestTask.projects, latestTask.roomKey);
    if (res.success) {
      clearOfflineQueue();
      return { success: true, processedCount: queue.length };
    }
  } catch {
    // 다음 기회에 재시도
  }

  return { success: false, processedCount: 0 };
}

/**
 * 🌐 오프라인 큐 이벤트 리스너 초기화 (온라인 복구 시 자동 업로드)
 */
export function initOfflineQueueListener(): () => void {
  if (typeof window === "undefined") return () => {};

  const handleOnline = () => {
    processSyncQueue();
  };

  window.addEventListener("online", handleOnline);

  // 20초 주기 백그라운드 큐 정리 확인
  const intervalId = setInterval(() => {
    if (typeof navigator !== "undefined" && navigator.onLine) {
      const queue = getOfflineQueue();
      if (queue.length > 0) {
        processSyncQueue();
      }
    }
  }, 20000);

  return () => {
    window.removeEventListener("online", handleOnline);
    clearInterval(intervalId);
  };
}
