import { ProjectMaster, EquipmentUnit, PartItem } from "@/types";

/**
 * 🛡️ 데이터 영구 보존 스마트 병합(Smart Merge) 엔진
 * - 로컬 데이터와 원격(클라우드) 데이터를 합칠 때, 사용자가 이미 입력/스캔한 시리얼 번호가
 *   빈 값으로 덮어써져 사라지는 문제를 100% 원천 차단합니다.
 */
function getPartCompositeKey(pt: PartItem): string {
  const cat = (pt.category || "").trim().toLowerCase();
  const name = (pt.partName || "").trim().toLowerCase();
  const sub = (pt.subSpec || "").trim().toLowerCase();
  const spec = (pt.spec || "").trim().toLowerCase();
  return `${cat}::${name}::${sub}::${spec}`;
}

export function mergeProjectLists(
  existingList: ProjectMaster[],
  incomingList: ProjectMaster[]
): ProjectMaster[] {
  if (!existingList || existingList.length === 0) return incomingList || [];
  if (!incomingList || incomingList.length === 0) return existingList;

  const mergedMap = new Map<string, ProjectMaster>();

  // 1. 기존 프로젝트 목록 적재 (key: pjtCode 또는 id)
  for (const p of existingList) {
    if (!p) continue;
    const key = (p.pjtCode?.trim() || p.id || "").toUpperCase();
    if (!key) continue;
    mergedMap.set(key, JSON.parse(JSON.stringify(p)));
  }

  // 2. Incoming 프로젝트와 스마트 병합 (기존 입력 시리얼 100% 영구 보존)
  for (const inc of incomingList) {
    if (!inc) continue;
    const key = (inc.pjtCode?.trim() || inc.id || "").toUpperCase();
    if (!key) continue;
    const existing = mergedMap.get(key);

    if (!existing) {
      // 기존에 없던 새로운 프로젝트면 그대로 추가
      mergedMap.set(key, JSON.parse(JSON.stringify(inc)));
      continue;
    }

    // 이미 존재하는 프로젝트면, 내부 부품 시리얼들을 스마트 병합!
    const existingUnits = existing.equipmentUnits || [];
    const incomingUnits = inc.equipmentUnits || [];
    const mergedUnits: EquipmentUnit[] = [];
    const maxUnits = Math.max(existingUnits.length, incomingUnits.length);

    for (let uIdx = 1; uIdx <= maxUnits; uIdx++) {
      const exUnit = existingUnits.find((u) => u.unitIndex === uIdx);
      const incUnit = incomingUnits.find((u) => u.unitIndex === uIdx);

      if (!exUnit && incUnit) {
        mergedUnits.push(JSON.parse(JSON.stringify(incUnit)));
        continue;
      }
      if (exUnit && !incUnit) {
        mergedUnits.push(JSON.parse(JSON.stringify(exUnit)));
        continue;
      }
      if (exUnit && incUnit) {
        // 호기 설비 시리얼 결정: 입력되어 있는 쪽 최우선 보존
        const chosenSerial =
          exUnit.equipmentSerial?.trim() || incUnit.equipmentSerial?.trim() || "";

        // 부품 목록 병합: 복합 키 기반 맵핑
        const partMap = new Map<string, PartItem>();
        // 1) 기존 부품 먼저 적재
        for (const pt of exUnit.parts || []) {
          const ptKey = getPartCompositeKey(pt);
          partMap.set(ptKey, JSON.parse(JSON.stringify(pt)));
        }

        // 2) incoming 부품 병합 (기존에 입력된 시리얼은 절대로 빈 값으로 덮어쓰지 않음)
        for (const incPt of incUnit.parts || []) {
          const ptKey = getPartCompositeKey(incPt);
          const exPt = partMap.get(ptKey);

          if (!exPt) {
            partMap.set(ptKey, JSON.parse(JSON.stringify(incPt)));
          } else {
            // ★ 핵심: 이미 입력된 시리얼 번호는 빈 값으로 절대 덮어쓰지 않음!
            const exSerial = exPt.detectedSerial?.trim() || "";
            const incSerial = incPt.detectedSerial?.trim() || "";

            // 시리얼 우선순위: 기존 시리얼이 있으면 무조건 유지 (incoming이 빈 값이면 절대 덮어쓰지 않음)
            const finalSerial = exSerial || incSerial;
            const finalVerified = Boolean(finalSerial) && (exPt.isVerified || incPt.isVerified);

            const mergedPart: PartItem = {
              ...incPt,
              ...exPt,
              id: exPt.id || incPt.id,
              detectedSerial: finalSerial,
              isVerified: finalVerified,
              scannedAt: exSerial ? (exPt.scannedAt || new Date().toISOString()) : (incPt.scannedAt || exPt.scannedAt),
              confidence: exSerial ? (exPt.confidence || incPt.confidence) : (incPt.confidence || exPt.confidence),
            };
            partMap.set(ptKey, mergedPart);
          }
        }

        mergedUnits.push({
          unitIndex: uIdx,
          equipmentSerial: chosenSerial,
          parts: Array.from(partMap.values()),
        });
      }
    }

    // 프로젝트 메타정보 병합 (기존 ID 유지하여 화면 전환 방지)
    const mergedProject: ProjectMaster = {
      ...inc,
      ...existing,
      id: existing.id || inc.id,
      site: existing.site || inc.site,
      pjtCode: existing.pjtCode || inc.pjtCode,
      equipmentName: existing.equipmentName || inc.equipmentName,
      inspectorName: existing.inspectorName || inc.inspectorName,
      inspectionDate: existing.inspectionDate || inc.inspectionDate,
      quantity: mergedUnits.length,
      equipmentUnits: mergedUnits,
      updatedAt:
        new Date(existing.updatedAt || 0) > new Date(inc.updatedAt || 0)
          ? existing.updatedAt
          : inc.updatedAt || new Date().toISOString(),
    };

    mergedMap.set(key, mergedProject);
  }

  return Array.from(mergedMap.values());
}

/**
 * 프로젝트 목록 전체에서 사용자가 입력/스캔한 유효 시리얼 개수를 카운트
 */
export function countVerifiedSerials(projects: ProjectMaster[]): number {
  if (!projects || !Array.isArray(projects)) return 0;
  let count = 0;
  for (const p of projects) {
    if (p && p.equipmentUnits) {
      for (const u of p.equipmentUnits) {
        if (u && u.parts) {
          for (const pt of u.parts) {
            if (pt && pt.detectedSerial && pt.detectedSerial.trim().length > 0) {
              count++;
            }
          }
        }
      }
    }
  }
  return count;
}

