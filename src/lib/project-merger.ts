import { ProjectMaster, EquipmentUnit, PartItem } from "@/types";
import {
  getDeletedProjectKeys,
  isProjectDeleted,
  getDeletedPartKeys,
  isPartDeleted,
  getPartCompositeKey,
} from "./deleted-projects";

export { getPartCompositeKey };

export function mergeProjectLists(
  existingList: ProjectMaster[],
  incomingList: ProjectMaster[],
  deletedKeys?: Set<string>,
  deletedPartKeys?: Set<string>
): ProjectMaster[] {
  const delKeys = deletedKeys || getDeletedProjectKeys();
  const delPartKeys = deletedPartKeys || getDeletedPartKeys();

  if (!existingList || existingList.length === 0) {
    return (incomingList || [])
      .filter((p) => p && !isProjectDeleted(p.id, p.pjtCode, delKeys))
      .map((p) => ({
        ...p,
        equipmentUnits: (p.equipmentUnits || []).map((u) => ({
          ...u,
          parts: (u.parts || []).filter((pt) => !isPartDeleted(pt.id, getPartCompositeKey(pt), delPartKeys)),
        })),
      }));
  }
  if (!incomingList || incomingList.length === 0) {
    return (existingList || [])
      .filter((p) => p && !isProjectDeleted(p.id, p.pjtCode, delKeys))
      .map((p) => ({
        ...p,
        equipmentUnits: (p.equipmentUnits || []).map((u) => ({
          ...u,
          parts: (u.parts || []).filter((pt) => !isPartDeleted(pt.id, getPartCompositeKey(pt), delPartKeys)),
        })),
      }));
  }

  const mergedMap = new Map<string, ProjectMaster>();

  // Helper to find existing project by ID first, then by pjtCode
  const findExisting = (id?: string, code?: string): [string, ProjectMaster] | [null, null] => {
    const idKey = id?.trim().toUpperCase();
    if (idKey && mergedMap.has(idKey)) {
      return [idKey, mergedMap.get(idKey)!];
    }
    const codeKey = code?.trim().toUpperCase();
    if (codeKey) {
      let foundEntry: [string, ProjectMaster] | null = null;
      mergedMap.forEach((p, k) => {
        if (!foundEntry && p.pjtCode?.trim().toUpperCase() === codeKey) {
          foundEntry = [k, p];
        }
      });
      if (foundEntry) return foundEntry;
    }
    return [null, null];
  };

  // 1. 기존 프로젝트 목록 적재 (key: id 최우선, pjtCode 차순위, 삭제된 프로젝트 제외)
  for (const p of existingList) {
    if (!p) continue;
    if (isProjectDeleted(p.id, p.pjtCode, delKeys)) continue;
    const key = (p.id?.trim() || p.pjtCode?.trim() || "").toUpperCase();
    if (!key || delKeys.has(key)) continue;
    mergedMap.set(key, JSON.parse(JSON.stringify(p)));
  }

  // 2. Incoming 프로젝트와 스마트 병합 (기존 입력 시리얼 100% 영구 보존 & 삭제 프로젝트/부활 차단)
  for (const inc of incomingList) {
    if (!inc) continue;
    if (isProjectDeleted(inc.id, inc.pjtCode, delKeys)) continue;
    const incIdKey = inc.id?.trim().toUpperCase();
    const incCodeKey = inc.pjtCode?.trim().toUpperCase();
    if (!incIdKey && !incCodeKey) continue;
    if ((incIdKey && delKeys.has(incIdKey)) || (incCodeKey && delKeys.has(incCodeKey))) continue;

    const [matchedKey, existing] = findExisting(inc.id, inc.pjtCode);
    const key = matchedKey || incIdKey || incCodeKey || "";

    if (!existing) {
      // 삭제 목록에 없는 유효한 신규 프로젝트만 추가
      const sanitizedUnits = (inc.equipmentUnits || []).map((u) => ({
        ...u,
        parts: (u.parts || []).filter((pt) => !isPartDeleted(pt.id, getPartCompositeKey(pt), delPartKeys)),
      }));
      mergedMap.set(key, { ...JSON.parse(JSON.stringify(inc)), equipmentUnits: sanitizedUnits });
      continue;
    }

    // 이미 존재하는 프로젝트면, 내부 부품 시리얼들을 스마트 병합!
    const existingUnits = existing.equipmentUnits || [];
    const incomingUnits = inc.equipmentUnits || [];
    const mergedUnits: EquipmentUnit[] = [];
    const maxUnits = Math.max(existingUnits.length, incomingUnits.length);
    const isExistingNewer = new Date(existing.updatedAt || 0) >= new Date(inc.updatedAt || 0);

    for (let uIdx = 1; uIdx <= maxUnits; uIdx++) {
      const exUnit = existingUnits.find((u) => u.unitIndex === uIdx);
      const incUnit = incomingUnits.find((u) => u.unitIndex === uIdx);

      if (!exUnit && incUnit) {
        const filteredParts = (incUnit.parts || []).filter((pt) => {
          const compKey = getPartCompositeKey(pt);
          return !isPartDeleted(pt.id, compKey, delPartKeys);
        });
        mergedUnits.push({ ...JSON.parse(JSON.stringify(incUnit)), parts: filteredParts });
        continue;
      }
      if (exUnit && !incUnit) {
        const filteredParts = (exUnit.parts || []).filter((pt) => {
          const compKey = getPartCompositeKey(pt);
          return !isPartDeleted(pt.id, compKey, delPartKeys);
        });
        mergedUnits.push({ ...JSON.parse(JSON.stringify(exUnit)), parts: filteredParts });
        continue;
      }
      if (exUnit && incUnit) {
        // 호기 설비 시리얼 결정: 입력되어 있는 쪽 최우선 보존
        const chosenSerial =
          exUnit.equipmentSerial?.trim() || incUnit.equipmentSerial?.trim() || "";

        // ★ 핵심: 어느 쪽이 더 최신인가에 따라 기본 부품 목록(Base Set)을 결정
        // local(existing)이 더 최신인 경우: 사용자가 삭제한 부품은 절대 incoming에서 되살아나지 않음!
        const baseUnit = isExistingNewer ? exUnit : incUnit;
        const secondaryUnit = isExistingNewer ? incUnit : exUnit;

        const partMap = new Map<string, PartItem>();

        // 1) 최신(Base) 부품 목록 먼저 적재 (삭제된 부품 영구 제외)
        for (const pt of baseUnit.parts || []) {
          const ptKey = getPartCompositeKey(pt);
          if (isPartDeleted(pt.id, ptKey, delPartKeys)) continue;
          partMap.set(ptKey, JSON.parse(JSON.stringify(pt)));
        }

        // 2) 보조(Secondary) 부품에서 누락된 시리얼 번호만 안전 병합
        for (const secPt of secondaryUnit.parts || []) {
          const ptKey = getPartCompositeKey(secPt);
          if (isPartDeleted(secPt.id, ptKey, delPartKeys)) continue;

          const basePt = partMap.get(ptKey);
          if (basePt) {
            // 이미 base에 존재하는 부품이면 시리얼 병합 (입력된 시리얼 보존)
            const baseSerial = basePt.detectedSerial?.trim() || "";
            const secSerial = secPt.detectedSerial?.trim() || "";
            const finalSerial = baseSerial || secSerial;
            const finalVerified = Boolean(finalSerial) && (basePt.isVerified || secPt.isVerified);

            basePt.detectedSerial = finalSerial;
            basePt.isVerified = finalVerified;
            basePt.scannedAt = baseSerial ? (basePt.scannedAt || new Date().toISOString()) : (secPt.scannedAt || basePt.scannedAt);
            basePt.confidence = baseSerial ? (basePt.confidence || secPt.confidence) : (secPt.confidence || basePt.confidence);
          } else if (!isExistingNewer) {
            // 원격이 더 최신인데 로컬에만 존재했던 유효 신규 부품인 경우에만 추가 허용
            partMap.set(ptKey, JSON.parse(JSON.stringify(secPt)));
          }
          // ★ isExistingNewer인 경우: 로컬이 더 최신이므로, 로컬에서 삭제된 부품은 절대 secondaryUnit에서 되살아나지 않음!
        }

        mergedUnits.push({
          unitIndex: uIdx,
          equipmentSerial: chosenSerial,
          parts: Array.from(partMap.values()),
        });
      }
    }

    // 프로젝트 메타정보 병합 (더 최신인 쪽의 정보를 최우선 적용하여 작성일/담당자/모델명 임의 변경 방지)
    const newerProj = isExistingNewer ? existing : inc;
    const olderProj = isExistingNewer ? inc : existing;

    const mergedProject: ProjectMaster = {
      ...olderProj,
      ...newerProj,
      id: existing.id || inc.id,
      site: (newerProj.site || olderProj.site || "").trim(),
      pjtCode: (newerProj.pjtCode || olderProj.pjtCode || "").trim(),
      equipmentName: (newerProj.equipmentName || olderProj.equipmentName || "").trim(),
      inspectorName: (newerProj.inspectorName || olderProj.inspectorName || "").trim(),
      inspectionDate: (newerProj.inspectionDate || olderProj.inspectionDate || "").trim(),
      notes: newerProj.notes !== undefined ? newerProj.notes : olderProj.notes,
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

