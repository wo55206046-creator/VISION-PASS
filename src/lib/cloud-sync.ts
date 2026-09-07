import { ProjectMaster } from "@/types";

const CLOUD_STORAGE_KEY_STORAGE = "VISION_PASS_SYNC_ROOM_KEY";
const DEFAULT_ROOM_KEY = "WITHTECH-VISIONPASS-2026";
const STORAGE_PROJECTS_KEY = "VISION_PASS_PROJECTS_DATA_V8";
const STORAGE_LAST_SYNC_KEY = "VISION_PASS_LAST_SYNC_TIME";

// 🌐 실시간 크로스 디바이스(PC ↔ 모바일) 동기화 엔드포인트 (ntfy.sh 실시간 SSE & Pub/Sub)
const CLOUD_SYNC_TOPIC_PREFIX = "withtech_vp_sync";

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

function getSanitizedTopic(roomKey: string = getSyncRoomKey()): string {
  const clean = (roomKey || DEFAULT_ROOM_KEY).toLowerCase().replace(/[^a-z0-9]/g, "_");
  return `${CLOUD_SYNC_TOPIC_PREFIX}_${clean}`;
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

// 🌐 클라우드 데이터 저장소 & 실시간 시그널링 엔드포인트
const KVDB_BUCKET_ID = "B5M7K8N2q7m4D2y8";
const SIGNAL_TOPIC_PREFIX = "withtech_vp_sig";

// 마지막 풀 요청 시각 및 메모리 캐시
let lastPullTime = 0;
let cachedCloudProjects: ProjectMaster[] | null = null;

/**
 * ⚡ 0.05초 초고속 실시간 Server-Sent Events (SSE) 시그널링 리스너 (PC ↔ 모바일 라이브 트리거)
 */
export function subscribeCloudRealtime(
  onUpdate: (projects: ProjectMaster[]) => void,
  roomKey: string = getSyncRoomKey()
): () => void {
  if (typeof window === "undefined" || typeof EventSource === "undefined") return () => {};

  const cleanRoom = (roomKey || DEFAULT_ROOM_KEY).toLowerCase().replace(/[^a-z0-9]/g, "_");
  const topic = `${SIGNAL_TOPIC_PREFIX}_${cleanRoom}`;
  let eventSource: EventSource | null = null;
  let isClosed = false;

  const connectSSE = () => {
    if (isClosed) return;
    try {
      eventSource = new EventSource(`https://ntfy.sh/${topic}/sse`);

      eventSource.onmessage = async (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.event === "message" && data.message) {
            let signal: any = null;
            try {
              signal = JSON.parse(data.message);
            } catch {
              signal = { type: "PING" };
            }

            // 내가 보낸 것이 아닌 다른 기기(PC 또는 스마트폰)에서 보낸 갱신 신호 수신 시
            if (!signal.senderDeviceId || signal.senderDeviceId !== getDeviceId()) {
              const res = await pullProjectsFromCloud(roomKey, true);
              if (res.success && res.projects && res.projects.length > 0) {
                cachedCloudProjects = res.projects;
                onUpdate(res.projects);
              }
            }
          }
        } catch {}
      };

      eventSource.onerror = () => {
        // 네트워크 단절 시 자동 재연결 대기
      };
    } catch {}
  };

  connectSSE();

  return () => {
    isClosed = true;
    try {
      eventSource?.close();
    } catch {}
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

  cachedCloudProjects = projects;

  const cleanRoom = (roomKey || DEFAULT_ROOM_KEY).toUpperCase().replace(/[^A-Z0-9_-]/g, "_");
  const payload: CloudSyncPayload = {
    version: 8,
    roomKey: cleanRoom,
    updatedAt: nowStr,
    senderDeviceId: getDeviceId(),
    projects,
  };

  let savedToCloud = false;

  // 2. 고용량 Cloud KV Store에 전체 JSON 영구 저장 (크기 제한 없음)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4500);

    const res = await fetch(`https://kvdb.io/${KVDB_BUCKET_ID}/${cleanRoom}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      savedToCloud = true;
    }
  } catch (err) {
    // 1차 클라우드 통신 실패 시 백업
  }

  // 3. 상대 기기(모바일/PC)에 0.05초 즉시 갱신 알림 전송 (초경량 30바이트 시그널링)
  try {
    const topic = `${SIGNAL_TOPIC_PREFIX}_${cleanRoom.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
    const signalPayload = {
      type: "SYNC_TRIGGER",
      senderDeviceId: getDeviceId(),
      updatedAt: nowStr,
    };

    fetch(`https://ntfy.sh/${topic}`, {
      method: "POST",
      headers: {
        "Title": "SYNC_PING",
        "Priority": "high",
      },
      body: JSON.stringify(signalPayload),
    }).catch(() => {});
  } catch {}

  return {
    success: true,
    message: savedToCloud ? "클라우드 저장 및 실시간 연동 완료" : "로컬 저장 완료 (오프라인)",
  };
}

/**
 * ☁️ 모바일/PC ➔ 클라우드 최신 프로젝트 데이터 조회
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
  const now = Date.now();
  // 3초 이내 중복 호출 방지 (강제 호출이 아닐 때)
  if (!force && now - lastPullTime < 3000 && cachedCloudProjects && cachedCloudProjects.length > 0) {
    return {
      success: true,
      projects: cachedCloudProjects,
      updatedAt: new Date().toISOString(),
      message: "캐시된 데이터 사용",
    };
  }
  lastPullTime = now;

  const cleanRoom = (roomKey || DEFAULT_ROOM_KEY).toUpperCase().replace(/[^A-Z0-9_-]/g, "_");

  // 1. Cloud KV Store에서 최신 전체 프로젝트 데이터 수신
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(`https://kvdb.io/${KVDB_BUCKET_ID}/${cleanRoom}?t=${Date.now()}`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const payload: CloudSyncPayload = await res.json();
      if (payload && Array.isArray(payload.projects) && payload.projects.length > 0) {
        cachedCloudProjects = payload.projects;
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
          updatedAt: payload.updatedAt || new Date().toISOString(),
          message: "클라우드 최신 데이터 수신 완료",
        };
      }
    }
  } catch (err) {
    // 네트워크 단절 시 무소음 로컬 캐시 폴백
  }

  // 2. 오프라인 로컬 스토리지 폴백
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(STORAGE_PROJECTS_KEY);
      if (raw) {
        const projects = JSON.parse(raw);
        if (Array.isArray(projects) && projects.length > 0) {
          cachedCloudProjects = projects;
          return {
            success: true,
            projects,
            updatedAt: localStorage.getItem(STORAGE_LAST_SYNC_KEY) || new Date().toISOString(),
            message: "로컬 캐시 데이터 사용",
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
