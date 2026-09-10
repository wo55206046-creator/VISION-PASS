/**
 * 🛡️ 삭제된 프로젝트 묘비(Tombstone) 관리 모듈
 * - 사용자가 [삭제]한 프로젝트가 클라우드 실시간 동기화, 과거 로컬 스토리지 스냅샷,
 *   스마트 병합(Smart Merge) 과정에서 다시 부활하는 문제를 100% 원천 차단합니다.
 */

const STORAGE_DELETED_PROJECTS_KEY = "VISION_PASS_DELETED_PROJECT_KEYS_V1";

export const KNOWN_STORAGE_PROJECT_KEYS = [
  "VISION_PASS_PROJECTS_DATA_V8",
  "VISION_PASS_PERMANENT_SERIALS_SNAPSHOT",
  "VISION_PASS_PROJECTS_DATA_V7",
  "VISION_PASS_PROJECTS_DATA_V6",
  "VISION_PASS_PROJECTS_DATA_V5",
  "VISION_PASS_PROJECTS_DATA_V4",
  "VISION_PASS_PROJECTS_DATA_V3",
  "VISION_PASS_PROJECTS_DATA_V2",
  "VISION_PASS_PROJECTS_DATA_V1",
  "VISION_PASS_PROJECTS_V2",
  "VISION_PASS_PROJECTS_V1",
  "VISION_PASS_PROJECTS_DATA",
  "VISION_PASS_PROJECTS",
];

/**
 * 🔍 영구 삭제된 프로젝트 키 목록(ID 및 대문자 PJT CODE) 조회
 */
export function getDeletedProjectKeys(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_DELETED_PROJECTS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return new Set(arr.map((k) => String(k).trim().toUpperCase()));
      }
    }
  } catch {}
  return new Set();
}

/**
 * 🗑️ 프로젝트를 삭제 목록(Tombstone)에 등록
 */
export function markProjectAsDeleted(id?: string, pjtCode?: string): void {
  if (typeof window === "undefined") return;
  try {
    const set = getDeletedProjectKeys();
    if (id && id.trim()) {
      set.add(id.trim().toUpperCase());
    }
    if (pjtCode && pjtCode.trim()) {
      set.add(pjtCode.trim().toUpperCase());
    }
    localStorage.setItem(STORAGE_DELETED_PROJECTS_KEY, JSON.stringify(Array.from(set)));
  } catch (e) {
    console.warn("Failed to save deleted project key", e);
  }
}

/**
 * 📦 다수의 삭제 키 일괄 등록 (클라우드 동기화 패킷 수신 시 활용)
 */
export function markProjectsAsDeletedBulk(keys: string[]): void {
  if (typeof window === "undefined" || !keys || !Array.isArray(keys) || keys.length === 0) return;
  try {
    const set = getDeletedProjectKeys();
    for (const k of keys) {
      if (k && String(k).trim()) {
        set.add(String(k).trim().toUpperCase());
      }
    }
    localStorage.setItem(STORAGE_DELETED_PROJECTS_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

/**
 * ❓ 해당 프로젝트가 삭제 목록에 존재하는지 여부 확인
 */
export function isProjectDeleted(id?: string, pjtCode?: string, deletedKeys?: Set<string>): boolean {
  const set = deletedKeys || getDeletedProjectKeys();
  if (set.size === 0) return false;
  if (id && set.has(id.trim().toUpperCase())) return true;
  if (pjtCode && set.has(pjtCode.trim().toUpperCase())) return true;
  return false;
}

/**
 * 🔄 삭제 목록에서 해제 (사용자가 동일한 PJT 코드로 새로 생성할 때 허용)
 */
export function unmarkProjectAsDeleted(id?: string, pjtCode?: string): void {
  if (typeof window === "undefined") return;
  try {
    const set = getDeletedProjectKeys();
    if (id) set.delete(id.trim().toUpperCase());
    if (pjtCode) set.delete(pjtCode.trim().toUpperCase());
    localStorage.setItem(STORAGE_DELETED_PROJECTS_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

/**
 * 🧹 모든 로컬 스토리지 스냅샷에서 삭제된 프로젝트 항목을 물리적으로 소각
 */
export function cleanStorageFromDeleted(keysToClean?: Set<string>): void {
  if (typeof window === "undefined") return;
  const delKeys = keysToClean || getDeletedProjectKeys();
  if (delKeys.size === 0) return;

  try {
    for (const storageKey of KNOWN_STORAGE_PROJECT_KEYS) {
      const raw = localStorage.getItem(storageKey);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const filtered = parsed.filter((p) => !isProjectDeleted(p.id, p.pjtCode, delKeys));
          if (filtered.length !== parsed.length) {
            localStorage.setItem(storageKey, JSON.stringify(filtered));
          }
        }
      } catch {}
    }
  } catch (e) {
    console.warn("Error cleaning storage from deleted projects", e);
  }
}
