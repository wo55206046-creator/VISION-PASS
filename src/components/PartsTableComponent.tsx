"use client";

import React, { useState, useMemo, Fragment } from "react";
import { PartItem } from "@/types";
import { generateId, triggerScanFeedback } from "@/lib/utils";
import {
  Plus,
  Camera,
  CheckCircle2,
  AlertCircle,
  Edit2,
  Trash2,
  Copy,
  Check,
  ArrowUp,
  ArrowDown,
  Layers,
  RotateCcw,
  SlidersHorizontal,
  X,
  Save,
  Square,
  GripVertical,
} from "lucide-react";

export interface PartsTableProps {
  parts: PartItem[];
  unitIndex: number;
  onUpdateParts: (newParts: PartItem[]) => void;
  onOpenOcrModal: (part: PartItem) => void;
  onOpenPresetModal?: () => void;
}

// 🏷️ 모듈/섹션 카테고리별 스마트 뱃지 스타일 매핑
function getCategoryBadgeStyle(category?: string) {
  const cat = (category || "").toUpperCase();
  if (cat.includes("MAIN")) {
    return "bg-cyan-950/80 border-cyan-600/70 text-cyan-300";
  } else if (cat.includes("MG") || cat.includes("MODULE")) {
    return "bg-amber-950/80 border-amber-600/70 text-amber-300";
  } else if (cat.includes("WOA") || cat.includes("683") || cat.includes("PUMP")) {
    return "bg-purple-950/80 border-purple-600/70 text-purple-300";
  } else if (cat.includes("COSMOS") || cat.includes("ION") || cat.includes("IC")) {
    return "bg-rose-950/80 border-rose-600/70 text-rose-300";
  } else if (cat.includes("PC") || cat.includes("CONTROLLER") || cat.includes("OPTION")) {
    return "bg-emerald-950/80 border-emerald-600/70 text-emerald-300";
  } else if (cat.includes("VALVE") || cat.includes("MANIFOLD") || cat.includes("SENSOR")) {
    return "bg-sky-950/80 border-sky-600/70 text-sky-300";
  }
  return "bg-slate-800/90 border-slate-700 text-slate-300";
}

export const PartsTable: React.FC<PartsTableProps> = ({
  parts,
  unitIndex,
  onUpdateParts,
  onOpenOcrModal,
  onOpenPresetModal,
}) => {
  // 🔍 1. 필터 상태 (상태 / 모듈)
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "VERIFIED" | "UNVERIFIED">("ALL");

  // ✏️ 2. 시리얼 인라인 편집 상태
  const [editingSerialId, setEditingSerialId] = useState<string | null>(null);
  const [tempSerial, setTempSerial] = useState<string>("");

  // 📋 3. 전체 항목 상세 편집 모달 상태
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingPart, setEditingPart] = useState<PartItem | null>(null);

  // ➕ 4. 신규 부품 수동 추가 모달 상태
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newCategory, setNewCategory] = useState("[ MAIN ]");
  const [newPartName, setNewPartName] = useState("");
  const [newSubSpec, setNewSubSpec] = useState("-");
  const [newSpec, setNewSpec] = useState("");
  const [newSerial, setNewSerial] = useState("");

  const [copiedId, setCopiedId] = useState<string | null>(null);

  // 🖱️ 5. 드래그 앤 드롭 순서 변경 상태
  const [draggedPartId, setDraggedPartId] = useState<string | null>(null);
  const [dragOverPartId, setDragOverPartId] = useState<string | null>(null);

  // 📊 6. 카테고리 고유 목록 추출
  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    parts.forEach((p) => {
      if (p.category && p.category.trim()) {
        set.add(p.category.trim());
      }
    });
    return Array.from(set);
  }, [parts]);

  // 🔍 7. 상태 및 카테고리 필터링된 부품 목록
  const filteredParts = useMemo(() => {
    return parts.filter((part) => {
      // 1) 상태 필터
      if (statusFilter === "VERIFIED" && !part.isVerified) return false;
      if (statusFilter === "UNVERIFIED" && part.isVerified) return false;

      // 2) 카테고리 필터
      if (categoryFilter !== "ALL" && (part.category || "").trim() !== categoryFilter) {
        return false;
      }

      return true;
    });
  }, [parts, statusFilter, categoryFilter]);

  // 📊 8. 검증 진행률 통계
  const totalCount = parts.length;
  const verifiedCount = parts.filter((p) => p.isVerified).length;
  const unverifiedCount = totalCount - verifiedCount;
  const progressPercent = totalCount > 0 ? Math.round((verifiedCount / totalCount) * 100) : 0;
  const isAllVerified = totalCount > 0 && verifiedCount === totalCount;

  // ⚡ 9. 단일 부품 검증 토글
  const handleToggleVerify = (partId: string) => {
    const target = parts.find((p) => p.id === partId);
    const nextState = !target?.isVerified;

    if (nextState) {
      triggerScanFeedback();
    }

    const updated = parts.map((p) => {
      if (p.id === partId) {
        return {
          ...p,
          isVerified: nextState,
          scannedAt: nextState ? p.scannedAt || new Date().toISOString() : p.scannedAt,
        };
      }
      return p;
    });
    onUpdateParts(updated);
  };

  // ✏️ 10. 시리얼 번호 인라인 저장
  const handleSaveInlineSerial = (partId: string) => {
    const trimmed = tempSerial.trim();
    const updated = parts.map((p) => {
      if (p.id === partId) {
        const hasValue = trimmed.length > 0;
        return {
          ...p,
          detectedSerial: trimmed,
          isVerified: hasValue ? true : p.isVerified,
          scannedAt: hasValue ? new Date().toISOString() : p.scannedAt,
        };
      }
      return p;
    });

    if (trimmed.length > 0) {
      triggerScanFeedback();
    }

    onUpdateParts(updated);
    setEditingSerialId(null);
    setTempSerial("");
  };

  // 📋 11. 시리얼 번호 복사
  const handleCopySerial = (partId: string, serial: string) => {
    if (!serial) return;
    navigator.clipboard.writeText(serial);
    setCopiedId(partId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // 🗑️ 12. 단일 부품 삭제
  const handleDeletePart = (partId: string, partName: string) => {
    if (confirm(`[${partName}] 부품을 삭제하시겠습니까?`)) {
      const updated = parts.filter((p) => p.id !== partId);
      onUpdateParts(updated);
    }
  };

  // 📑 13. 단일 부품 복제
  const handleDuplicatePart = (part: PartItem) => {
    const partIndexInParts = parts.findIndex((p) => p.id === part.id);
    const duplicated: PartItem = {
      ...part,
      id: generateId(),
      detectedSerial: "",
      isVerified: false,
      scannedAt: undefined,
      confidence: undefined,
    };
    const updated = [...parts];
    const insertIdx = partIndexInParts !== -1 ? partIndexInParts + 1 : parts.length;
    updated.splice(insertIdx, 0, duplicated);
    onUpdateParts(updated);
  };

  // ⬆️⬇️ 14. 부품 순서 변경 (위 / 아래) - 모듈 필터/검색 상태에서도 보이는 순서대로 정확하게 교체(Swap)
  const handleMovePart = (filteredIndex: number, direction: -1 | 1) => {
    const targetFilteredIndex = filteredIndex + direction;
    if (targetFilteredIndex < 0 || targetFilteredIndex >= filteredParts.length) return;

    const currentPart = filteredParts[filteredIndex];
    const targetPart = filteredParts[targetFilteredIndex];
    if (!currentPart || !targetPart) return;

    const currentIndexInParts = parts.findIndex((p) => p.id === currentPart.id);
    const targetIndexInParts = parts.findIndex((p) => p.id === targetPart.id);

    if (currentIndexInParts === -1 || targetIndexInParts === -1) return;

    const updated = [...parts];
    const temp = updated[currentIndexInParts];
    updated[currentIndexInParts] = updated[targetIndexInParts];
    updated[targetIndexInParts] = temp;

    onUpdateParts(updated);
  };

  // 🖱️ 14-1. 드래그 앤 드롭 순서 변경 핸들러
  const handleDragStart = (e: React.DragEvent, partId: string) => {
    setDraggedPartId(partId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", partId);
  };

  const handleDragOver = (e: React.DragEvent, partId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverPartId !== partId) {
      setDragOverPartId(partId);
    }
  };

  const handleDrop = (e: React.DragEvent, targetPartId: string) => {
    e.preventDefault();
    if (!draggedPartId || draggedPartId === targetPartId) {
      setDraggedPartId(null);
      setDragOverPartId(null);
      return;
    }

    const fromIndex = parts.findIndex((p) => p.id === draggedPartId);
    const toIndex = parts.findIndex((p) => p.id === targetPartId);

    if (fromIndex !== -1 && toIndex !== -1) {
      const updated = [...parts];
      const [movedItem] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, movedItem);
      onUpdateParts(updated);
      triggerScanFeedback();
    }

    setDraggedPartId(null);
    setDragOverPartId(null);
  };

  const handleDragEnd = () => {
    setDraggedPartId(null);
    setDragOverPartId(null);
  };

  // ➕ 15. 신규 부품 수동 등록 (선택된 모듈 그룹의 마지막 위치에 스마트 삽입)
  const handleAddNewPartSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPartName.trim()) {
      alert("품명(부품명)을 입력해주세요.");
      return;
    }
    if (!newSpec.trim()) {
      alert("규격(Spec)을 입력해주세요.");
      return;
    }

    const targetCategory = newCategory.trim() || "[ MAIN ]";
    const newItem: PartItem = {
      id: generateId(),
      category: targetCategory,
      partName: newPartName.trim(),
      subSpec: newSubSpec.trim() || "-",
      spec: newSpec.trim(),
      detectedSerial: newSerial.trim(),
      isVerified: Boolean(newSerial.trim()),
      scannedAt: newSerial.trim() ? new Date().toISOString() : undefined,
    };

    // 🎯 선택된 모듈 그룹의 마지막 위치를 찾아 그 바로 뒤에 삽입
    let insertIndex = -1;
    for (let i = parts.length - 1; i >= 0; i--) {
      const pCat = (parts[i].category || "[ MAIN ]").trim().toUpperCase();
      if (pCat === targetCategory.toUpperCase()) {
        insertIndex = i + 1;
        break;
      }
    }

    let updatedParts: PartItem[];
    if (insertIndex !== -1) {
      updatedParts = [...parts];
      updatedParts.splice(insertIndex, 0, newItem);
    } else {
      updatedParts = [...parts, newItem];
    }

    onUpdateParts(updatedParts);
    setIsAddModalOpen(false);
    setNewPartName("");
    setNewSubSpec("-");
    setNewSpec("");
    setNewSerial("");
  };

  // ✏️ 16. 전체 항목 수정 모달 저장
  const handleSaveEditModal = () => {
    if (!editingPart) return;
    if (!editingPart.partName.trim()) {
      alert("품명을 입력해주세요.");
      return;
    }

    const updated = parts.map((p) =>
      p.id === editingPart.id ? { ...editingPart } : p
    );
    onUpdateParts(updated);
    setIsEditModalOpen(false);
    setEditingPart(null);
  };

  // 🚀 19. 전체 검증 완료 (모든 부품 일괄 PASS)
  const handleVerifyAllParts = () => {
    if (parts.length === 0) return;
    triggerScanFeedback();
    const updated = parts.map((p) => ({
      ...p,
      isVerified: true,
      scannedAt: p.scannedAt || new Date().toISOString(),
    }));
    onUpdateParts(updated);
  };

  // 🔄 20. 전체 검증 초기화 (대기 상태로 리셋)
  const handleResetAllVerification = () => {
    if (parts.length === 0) return;
    if (confirm(`${unitIndex}호기의 모든 부품 검증 상태를 초기화(미검증)하시겠습니까?`)) {
      const updated = parts.map((p) => ({
        ...p,
        isVerified: false,
      }));
      onUpdateParts(updated);
    }
  };

  return (
    <div className="space-y-3">
      {/* 🔍 1. 상태 필터 & 부품 추가 툴바 */}
      <div className="rounded-2xl bg-slate-900/80 p-3 sm:p-3.5 border border-slate-800 space-y-2.5 shadow-md">
        {/* 1행: [좌측 상태 필터 (전체/완료/미검증)] & [우측 + 부품 추가 버튼] */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          {/* 상태 필터 (전체 / 검증완료 / 미검증) */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 shrink-0">
            <button
              type="button"
              onClick={() => setStatusFilter("ALL")}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${statusFilter === "ALL"
                  ? "bg-cyan-500 text-slate-950 font-bold"
                  : "text-slate-400 hover:text-white"
                }`}
            >
              전체 ({parts.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("VERIFIED")}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${statusFilter === "VERIFIED"
                  ? "bg-emerald-500 text-slate-950 font-bold"
                  : "text-slate-400 hover:text-white"
                }`}
            >
              완료 ({verifiedCount})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("UNVERIFIED")}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${statusFilter === "UNVERIFIED"
                  ? "bg-amber-500 text-slate-950 font-bold"
                  : "text-slate-400 hover:text-white"
                }`}
            >
              미검증 ({unverifiedCount})
            </button>
          </div>

          {/* ➕ 우측 [부품 추가] 버튼 */}
          <button
            type="button"
            onClick={() => {
              if (categoryFilter && categoryFilter !== "ALL") {
                setNewCategory(categoryFilter);
              } else if (availableCategories.length > 0) {
                setNewCategory(availableCategories[0]);
              } else {
                setNewCategory("[ MAIN ]");
              }
              setIsAddModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:brightness-110 px-3.5 py-1.5 text-xs font-extrabold text-slate-950 shadow-glow-cyan transition-all cursor-pointer shrink-0"
          >
            <Plus className="h-3.5 w-3.5 stroke-[3]" />
            <span>부품 추가</span>
          </button>
        </div>

        {/* 2행: 카테고리/모듈 필터 탭 (구분선 및 여유 공간 적용) */}
        {availableCategories.length > 0 && (
          <div className="pt-2.5 pb-0.5 border-t border-slate-800/80">
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 px-0.5 text-xs">
              <span className="text-slate-400 font-bold text-[11px] shrink-0 mr-1 flex items-center gap-1">
                <SlidersHorizontal className="h-3 w-3 text-cyan-400" />
                모듈:
              </span>
              <button
                type="button"
                onClick={() => setCategoryFilter("ALL")}
                className={`px-3 py-1 rounded-lg border text-xs font-medium transition-all shrink-0 cursor-pointer ${categoryFilter === "ALL"
                    ? "bg-cyan-950 text-cyan-300 border-cyan-500 font-bold shadow-glow-cyan"
                    : "bg-slate-950/80 border-slate-800 text-slate-400 hover:text-slate-200"
                  }`}
              >
                전체 모든
              </button>
              {availableCategories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-3 py-1 rounded-lg border text-xs font-medium transition-all shrink-0 cursor-pointer ${categoryFilter === cat
                      ? "bg-cyan-950 text-cyan-300 border-cyan-500 font-bold shadow-glow-cyan"
                      : "bg-slate-950/80 border-slate-800 text-slate-400 hover:text-slate-200"
                    }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 📱 모바일 최적화: 한눈에 보이는 시리얼 + OCR 원터치 카드 뷰 (md:hidden) */}
      <div className="block md:hidden space-y-2.5">
        {filteredParts.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-8 text-center text-slate-500">
            <div className="flex flex-col items-center justify-center gap-2">
              <AlertCircle className="h-8 w-8 text-slate-600" />
              <p className="text-xs font-semibold">등록된 부품이 없습니다.</p>
              <div className="flex items-center gap-2 mt-2">
                {onOpenPresetModal && (
                  <button
                    type="button"
                    onClick={onOpenPresetModal}
                    className="px-3 py-1.5 rounded-xl bg-cyan-950 border border-cyan-700 text-cyan-300 font-bold text-xs"
                  >
                    PJT 표준 양식
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setNewCategory(availableCategories[0] || "[ MAIN ]");
                    setIsAddModalOpen(true);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-white font-bold text-xs"
                >
                  + 부품 직접 등록
                </button>
              </div>
            </div>
          </div>
        ) : (
          filteredParts.map((part, index) => {
            const isEditing = editingSerialId === part.id;
            const hasSerial = Boolean(part.detectedSerial && part.detectedSerial.trim());

            // 모듈 카테고리 구분 헤더 및 진행률 계산
            const prevPart = index > 0 ? filteredParts[index - 1] : null;
            const currentCat = part.category || "[ MAIN ]";
            const prevCat = prevPart ? prevPart.category || "[ MAIN ]" : null;
            const showCategoryHeader = !prevPart || currentCat !== prevCat;

            const catParts = parts.filter((p) => (p.category || "[ MAIN ]") === currentCat);
            const totalCatCount = catParts.length;
            const verifiedCatCount = catParts.filter((p) => p.isVerified).length;
            const isCatAllVerified = totalCatCount > 0 && verifiedCatCount === totalCatCount;

            return (
              <Fragment key={`m-${part.id}`}>
                {/* 🏷️ 모듈 구분 배너 및 완료/총 부품 수 진행도 */}
                {showCategoryHeader && (
                  <div className="pt-3 pb-1.5 flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-black tracking-wide border shadow-md ${getCategoryBadgeStyle(
                        part.category
                      )}`}
                    >
                      <Layers className="h-3.5 w-3.5" />
                      <span>{part.category || "[ MAIN ]"}</span>
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 font-mono text-xs font-bold px-2.5 py-0.5 rounded-lg border transition-all ${
                        isCatAllVerified
                          ? "bg-emerald-950/90 text-emerald-300 border-emerald-500/70 shadow-glow-emerald/30"
                          : "bg-slate-950 text-slate-200 border-slate-700/80"
                      }`}
                    >
                      <span>(모듈 부품</span>
                      <span className={verifiedCatCount > 0 ? "text-cyan-300 font-extrabold" : "text-slate-400"}>
                        {verifiedCatCount}
                      </span>
                      <span className="text-slate-400">/{totalCatCount}개)</span>
                    </span>
                  </div>
                )}

                {/* 📋 모바일 부품 카드: 품명 + 규격 + 시리얼 + OCR 버튼 + 원터치 순서 변경 버튼 */}
                <div
                  className={`rounded-2xl border p-3 space-y-2 transition-all ${
                    part.isVerified
                      ? "bg-slate-900/95 border-emerald-500/40 shadow-sm"
                      : "bg-slate-900/80 border-slate-800"
                  }`}
                >
                  {/* 1행: [순번 + ▲▼ 이동 버튼 + 품명] & [우측 PASS + 상세 수정] */}
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      {/* 순번 뱃지 (시인성 강화) */}
                      <span className="font-mono text-xs font-black text-cyan-300 bg-cyan-950/80 px-2 py-0.5 rounded-lg border border-cyan-700/80 shadow-sm shrink-0">
                        #{index + 1}
                      </span>

                      {/* ⬆️⬇️ 원터치 순서 이동 버튼 (위/아래) */}
                      <div className="flex flex-col gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMovePart(index, -1);
                          }}
                          disabled={index === 0}
                          className="p-0.5 text-slate-400 hover:text-cyan-300 disabled:opacity-20 transition-colors"
                          title="위로 이동"
                        >
                          <ArrowUp className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMovePart(index, 1);
                          }}
                          disabled={index === filteredParts.length - 1}
                          className="p-0.5 text-slate-400 hover:text-cyan-300 disabled:opacity-20 transition-colors"
                          title="아래로 이동"
                        >
                          <ArrowDown className="h-3 w-3" />
                        </button>
                      </div>

                      {/* 품명 (글자 크기 확대 및 굵기 강화) */}
                      <span className="font-black text-white text-base sm:text-lg tracking-tight truncate ml-1" title={part.partName}>
                        {part.partName}
                      </span>
                    </div>

                    {/* 검증 버튼 & 관리 메뉴 */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleToggleVerify(part.id)}
                        className={`inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                          part.isVerified
                            ? "bg-emerald-950/90 border-emerald-600 text-emerald-300 shadow-glow-emerald/30"
                            : "bg-slate-950 border-slate-700 text-slate-400 hover:text-white"
                        }`}
                        title={part.isVerified ? "검증 완료" : "미검증"}
                      >
                        {part.isVerified ? (
                          <>
                            <CheckCircle2 className="h-3 w-3 text-emerald-400 stroke-[2.5]" />
                            <span>PASS</span>
                          </>
                        ) : (
                          <>
                            <Square className="h-2.5 w-2.5" />
                            <span>대기</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setEditingPart({ ...part });
                          setIsEditModalOpen(true);
                        }}
                        className="p-1 rounded-md text-slate-400 hover:text-cyan-300 hover:bg-slate-800"
                        title="상세 수정"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* 2행: 규격 (Spec) 및 세부 사양 (깔끔한 1줄 고선명 표출) */}
                  <div className="flex items-center gap-2 text-xs px-0.5 min-w-0">
                    <span className="font-mono font-extrabold text-cyan-300 truncate" title={part.spec}>
                      {part.spec || "-"}
                    </span>
                    {part.subSpec && part.subSpec !== "-" && (
                      <>
                        <span className="text-slate-600 font-bold shrink-0">•</span>
                        <span className="text-slate-200 font-medium truncate" title={part.subSpec}>
                          {part.subSpec}
                        </span>
                      </>
                    )}
                  </div>

                  {/* 3행: [시리얼 번호 인라인 입력/표시] + [📷 원터치 OCR 버튼] */}
                  <div className="flex items-center gap-2 pt-0.5">
                    {/* 시리얼 입력/표시 박스 (flex-1) */}
                    <div className="flex-1 min-w-0 bg-slate-950 rounded-xl border border-slate-800 px-3 py-2 flex items-center justify-between gap-1.5">
                      {isEditing ? (
                        <div className="flex items-center gap-1 w-full">
                          <input
                            type="text"
                            value={tempSerial}
                            onChange={(e) => setTempSerial(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveInlineSerial(part.id);
                              if (e.key === "Escape") setEditingSerialId(null);
                            }}
                            autoFocus
                            placeholder="시리얼 직접 입력..."
                            className="w-full bg-transparent text-sm sm:text-base font-mono font-extrabold text-cyan-300 tracking-wide focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveInlineSerial(part.id)}
                            className="p-1 rounded bg-cyan-500 text-slate-950 hover:brightness-110 shrink-0"
                            title="저장"
                          >
                            <Save className="h-3 w-3 stroke-[2.5]" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingSerialId(null)}
                            className="p-1 rounded bg-slate-800 text-slate-400 hover:text-white shrink-0"
                            title="취소"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : hasSerial ? (
                        <div className="flex items-center w-full min-w-0">
                          <span
                            onClick={() => {
                              setEditingSerialId(part.id);
                              setTempSerial(part.detectedSerial || "");
                            }}
                            className="font-mono text-sm sm:text-base font-extrabold text-cyan-300 tracking-wide truncate cursor-pointer hover:underline"
                            title="클릭하여 시리얼 수정"
                          >
                            {part.detectedSerial}
                          </span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSerialId(part.id);
                            setTempSerial("");
                          }}
                          className="text-slate-500 hover:text-slate-300 text-xs italic font-mono flex items-center gap-1 w-full"
                        >
                          <span>(시리얼 미입력 - 터치하여 작성)</span>
                        </button>
                      )}
                    </div>

                    {/* 📷 원터치 OCR 스캔 버튼 (한눈에 바로 촬영) */}
                    <button
                      type="button"
                      onClick={() => onOpenOcrModal(part)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:brightness-110 px-4 py-2 text-xs font-extrabold text-slate-950 shadow-glow-cyan transition-all cursor-pointer shrink-0 active:scale-95"
                      title="명판 OCR 촬영"
                    >
                      <Camera className="h-3.5 w-3.5 stroke-[2.5]" />
                      <span>OCR 촬영</span>
                    </button>
                  </div>
                </div>
              </Fragment>
            );
          })
        )}
      </div>

      {/* 💻 데스크톱 테이블 뷰 (md:block) */}
      <div className="hidden md:block overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/90 shadow-xl">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-950/80 text-[11px] font-bold text-slate-400">
              <th className="py-3 px-2 text-center w-14">순번</th>
              <th className="py-3 px-3 min-w-[150px]">품명 (Part Name)</th>
              <th className="py-3 px-3 min-w-[130px]">세부 사양</th>
              <th className="py-3 px-3 min-w-[130px]">규격 (Spec)</th>
              <th className="py-3 px-3 min-w-[180px]">시리얼 번호 (S/N)</th>
              <th className="py-3 px-3 text-center w-24">OCR 인식</th>
              <th className="py-3 px-3 text-center w-24">검증</th>
              <th className="py-3 px-3 text-center w-24">관리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {filteredParts.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-500">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <AlertCircle className="h-8 w-8 text-slate-600" />
                    <p className="text-sm font-semibold">등록된 부품이 없습니다.</p>
                    <div className="flex items-center gap-2 mt-2">
                      {onOpenPresetModal && (
                        <button
                          type="button"
                          onClick={onOpenPresetModal}
                          className="px-3 py-1.5 rounded-xl bg-cyan-950 border border-cyan-700 text-cyan-300 font-bold hover:bg-cyan-900 transition-all text-xs"
                        >
                          PJT 표준 양식 불러오기
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (availableCategories.length > 0) {
                            setNewCategory(availableCategories[0]);
                          } else {
                            setNewCategory("[ MAIN ]");
                          }
                          setIsAddModalOpen(true);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-white font-bold hover:bg-slate-700 transition-all text-xs"
                      >
                        + 부품 직접 등록
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              filteredParts.map((part, index) => {
                const isEditing = editingSerialId === part.id;
                const hasSerial = Boolean(part.detectedSerial && part.detectedSerial.trim());

                // 모듈 카테고리 구분 헤더 표시 여부 계산 및 모듈별 진행률
                const prevPart = index > 0 ? filteredParts[index - 1] : null;
                const currentCat = part.category || "[ MAIN ]";
                const prevCat = prevPart ? prevPart.category || "[ MAIN ]" : null;
                const showCategoryHeader = !prevPart || currentCat !== prevCat;

                const catParts = parts.filter((p) => (p.category || "[ MAIN ]") === currentCat);
                const totalCatCount = catParts.length;
                const verifiedCatCount = catParts.filter((p) => p.isVerified).length;
                const isCatAllVerified = totalCatCount > 0 && verifiedCatCount === totalCatCount;

                return (
                  <Fragment key={part.id}>
                    {/* 🏷️ 모듈별 구분 상단 배너 행 */}
                    {showCategoryHeader && (
                      <tr className="bg-slate-950/95 border-y border-slate-800 shadow-sm">
                        <td colSpan={8} className="py-2.5 px-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              <span
                                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-black tracking-wide border shadow-md ${getCategoryBadgeStyle(
                                  part.category
                                )}`}
                              >
                                <Layers className="h-3.5 w-3.5" />
                                <span>{part.category || "[ MAIN ]"}</span>
                              </span>
                              <span
                                className={`inline-flex items-center gap-1 font-mono text-xs font-bold px-2.5 py-0.5 rounded-lg border transition-all ${
                                  isCatAllVerified
                                    ? "bg-emerald-950/90 text-emerald-300 border-emerald-500/70 shadow-glow-emerald/30"
                                    : "bg-slate-900 text-slate-200 border-slate-700/80"
                                }`}
                              >
                                <span>(모듈 부품</span>
                                <span className={verifiedCatCount > 0 ? "text-cyan-300 font-extrabold" : "text-slate-400"}>
                                  {verifiedCatCount}
                                </span>
                                <span className="text-slate-400">/{totalCatCount}개)</span>
                              </span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}

                    <tr
                      draggable
                      onDragStart={(e) => handleDragStart(e, part.id)}
                      onDragOver={(e) => handleDragOver(e, part.id)}
                      onDrop={(e) => handleDrop(e, part.id)}
                      onDragEnd={handleDragEnd}
                      className={`transition-colors select-none ${
                        draggedPartId === part.id
                          ? "opacity-40 bg-slate-800"
                          : dragOverPartId === part.id
                          ? "bg-cyan-950/60 border-y-2 border-cyan-400"
                          : part.isVerified
                          ? "bg-emerald-950/10 hover:bg-slate-800/50"
                          : "hover:bg-slate-800/50"
                      }`}
                    >

                      {/* 2. 드래그 핸들 + 순번 및 순서 이동 버튼 */}
                      <td className="py-2.5 px-2 text-center font-mono text-[11px] text-slate-400">
                        <div className="flex items-center justify-center gap-1">
                          <div
                            className="text-slate-600 hover:text-cyan-400 cursor-grab active:cursor-grabbing p-0.5 shrink-0"
                            title="드래그하여 순서 변경"
                          >
                            <GripVertical className="h-3.5 w-3.5" />
                          </div>
                          <span className="font-bold">{index + 1}</span>
                          <div className="flex flex-col">
                            <button
                              type="button"
                              onClick={() => handleMovePart(index, -1)}
                              disabled={index === 0}
                              className="text-slate-500 hover:text-cyan-300 disabled:opacity-20"
                              title="위로 이동"
                            >
                              <ArrowUp className="h-2.5 w-2.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMovePart(index, 1)}
                              disabled={index === filteredParts.length - 1}
                              className="text-slate-500 hover:text-cyan-300 disabled:opacity-20"
                              title="아래로 이동"
                            >
                              <ArrowDown className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        </div>
                      </td>

                      {/* 3. 품명 (Part Name) */}
                      <td className="py-2.5 px-3 font-extrabold text-base text-white">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate" title={part.partName}>
                            {part.partName}
                          </span>
                        </div>
                      </td>

                      {/* 5. 세부 사양 */}
                      <td className="py-2.5 px-3 text-slate-300">
                        <span className="truncate block max-w-[140px]" title={part.subSpec}>
                          {part.subSpec || "-"}
                        </span>
                      </td>

                      {/* 6. 규격 (Spec) */}
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-300">
                        <span className="truncate block max-w-[150px]" title={part.spec}>
                          {part.spec}
                        </span>
                      </td>

                      {/* 7. 시리얼 번호 (S/N) & 인라인 빠른 수정 */}
                      <td className="py-2.5 px-3">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={tempSerial}
                              onChange={(e) => setTempSerial(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveInlineSerial(part.id);
                                if (e.key === "Escape") setEditingSerialId(null);
                              }}
                              autoFocus
                              placeholder="시리얼 직접 입력..."
                              className="w-full bg-slate-950 border border-cyan-500 rounded-lg px-2.5 py-1 text-sm font-mono font-bold text-cyan-300 tracking-wide focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveInlineSerial(part.id)}
                              className="p-1 rounded-md bg-cyan-500 text-slate-950 hover:brightness-110 shrink-0"
                              title="저장 (Enter)"
                            >
                              <Save className="h-3 w-3 stroke-[2.5]" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingSerialId(null)}
                              className="p-1 rounded-md bg-slate-800 text-slate-400 hover:text-white shrink-0"
                              title="취소 (Esc)"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 group">
                            {hasSerial ? (
                              <span
                                className="font-mono font-extrabold text-sm text-cyan-300 tracking-wide cursor-pointer hover:underline truncate max-w-[200px]"
                                onClick={() => {
                                  setEditingSerialId(part.id);
                                  setTempSerial(part.detectedSerial || "");
                                }}
                                title="클릭하여 시리얼 번호 수정"
                              >
                                {part.detectedSerial}
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingSerialId(part.id);
                                  setTempSerial("");
                                }}
                                className="text-slate-500 hover:text-cyan-400 text-[11px] italic font-mono flex items-center gap-1"
                              >
                                <span>(미입력)</span>
                                <Edit2 className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>

                      {/* 8. OCR 인식 (카메라 스캔 모달 호출) */}
                      <td className="py-2.5 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => onOpenOcrModal(part)}
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-cyan-950/90 hover:bg-cyan-900 border border-cyan-700/80 px-2.5 py-1.5 text-[11px] font-extrabold text-cyan-300 hover:text-white shadow-glow-cyan/50 transition-all cursor-pointer w-full"
                          title="카메라/Gemini AI OCR로 명판 시리얼 인식"
                        >
                          <Camera className="h-3.5 w-3.5 text-cyan-400" />
                          <span>OCR</span>
                        </button>
                      </td>

                      {/* 9. 검증 PASS/대기 토글 버튼 */}
                      <td className="py-2.5 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => handleToggleVerify(part.id)}
                          className={`inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer w-full border ${part.isVerified
                              ? "bg-emerald-950/90 border-emerald-600 text-emerald-300 hover:bg-emerald-900 shadow-sm"
                              : "bg-slate-950 border-slate-700 text-slate-400 hover:text-white hover:border-slate-600"
                            }`}
                          title={part.isVerified ? "검증 완료 (클릭하여 취소)" : "미검증 (클릭하여 완료)"}
                        >
                          {part.isVerified ? (
                            <>
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 stroke-[2.5]" />
                              <span>PASS</span>
                            </>
                          ) : (
                            <>
                              <Square className="h-3 w-3" />
                              <span>대기</span>
                            </>
                          )}
                        </button>
                      </td>

                      {/* 10. 관리 메뉴 (수정 / 복제 / 삭제) */}
                      <td className="py-2.5 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingPart({ ...part });
                              setIsEditModalOpen(true);
                            }}
                            className="p-1 rounded-md text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition-colors"
                            title="상세 수정"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDuplicatePart(part)}
                            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                            title="부품 복제"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeletePart(part.id, part.partName)}
                            className="p-1 rounded-md text-slate-500 hover:text-rose-400 hover:bg-rose-950/50 transition-colors"
                            title="삭제"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ➕ 4. 신규 부품 수동 등록 모달 */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl animate-fadeIn">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Plus className="h-4 w-4 text-cyan-400" />
                <h3 className="text-base font-bold text-white">신규 부품 등록</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAddNewPartSubmit} className="space-y-3.5 text-xs">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-slate-300 font-bold block">
                    모듈 / 섹션 카테고리
                  </label>
                  <span className="text-[10px] text-cyan-400 font-normal">아래 추천 모듈 클릭 시 자동 선택</span>
                </div>

                {/* 🏷️ 현재 프로젝트 추천 모듈 빠른 선택 칩 */}
                <div className="flex items-center gap-1.5 flex-wrap mb-2 p-2 rounded-xl bg-slate-950/60 border border-slate-800">
                  <span className="text-[11px] text-slate-500 font-bold shrink-0">추천:</span>
                  {(availableCategories.length > 0
                    ? availableCategories
                    : ["[ MAIN ]", "[ MG ]", "[ WOA-683 ]", "[ COSMOS-100 ]", "[ PC ]", "[ OPTION ]"]
                  ).map((cat) => {
                    const isSelected = (newCategory || "").trim().toUpperCase() === cat.trim().toUpperCase();
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setNewCategory(cat)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer flex items-center gap-1 ${
                          isSelected
                            ? "bg-cyan-500 text-slate-950 border-cyan-400 shadow-glow-cyan"
                            : "bg-slate-900 border-slate-700/80 text-slate-300 hover:text-white hover:border-slate-500"
                        }`}
                      >
                        <Layers className="h-3 w-3" />
                        <span>{cat}</span>
                      </button>
                    );
                  })}
                </div>

                <input
                  type="text"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="예: [ MAIN ], [ MG ], [ WOA-683 ] (직접 입력도 가능)"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white font-bold placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  💡 선택한 모듈 그룹의 맨 마지막 위치에 부품이 자동으로 정렬 추가됩니다.
                </p>
              </div>

              <div>
                <label className="text-slate-300 font-bold block mb-1">
                  품명 (Part Name) <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={newPartName}
                  onChange={(e) => setNewPartName(e.target.value)}
                  placeholder="예: Syringe Pump, HPLC Pump, PC 등"
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-slate-300 font-bold block mb-1">
                  세부 사양 (Sub Spec)
                </label>
                <input
                  type="text"
                  value={newSubSpec}
                  onChange={(e) => setNewSubSpec(e.target.value)}
                  placeholder="예: 용액 자동화 장치, Thomas-P, 10mL 등"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-slate-300 font-bold block mb-1">
                  규격 (Spec) <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={newSpec}
                  onChange={(e) => setNewSpec(e.target.value)}
                  placeholder="예: C3000, P/N 10013, RAM16G SSD 256G 등"
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-slate-300 font-bold block mb-1">
                  초기 시리얼 번호 (선택)
                </label>
                <input
                  type="text"
                  value={newSerial}
                  onChange={(e) => setNewSerial(e.target.value)}
                  placeholder="시리얼 번호가 이미 있는 경우 입력"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white font-mono placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-semibold hover:bg-slate-700 transition-all cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-extrabold shadow-glow-cyan hover:brightness-110 transition-all cursor-pointer"
                >
                  부품 추가 완료
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ✏️ 5. 부품 상세 수정 모달 */}
      {isEditModalOpen && editingPart && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl animate-fadeIn">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Edit2 className="h-4 w-4 text-cyan-400" />
                <h3 className="text-base font-bold text-white">부품 정보 수정</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-slate-300 font-bold block">
                    모듈 / 섹션 카테고리
                  </label>
                  <span className="text-[10px] text-cyan-400 font-normal">추천 모듈 클릭 시 즉시 변경</span>
                </div>

                {/* 🏷️ 추천 모듈 빠른 선택 칩 */}
                <div className="flex items-center gap-1.5 flex-wrap mb-2 p-2 rounded-xl bg-slate-950/60 border border-slate-800">
                  <span className="text-[11px] text-slate-500 font-bold shrink-0">추천:</span>
                  {(availableCategories.length > 0
                    ? availableCategories
                    : ["[ MAIN ]", "[ MG ]", "[ WOA-683 ]", "[ COSMOS-100 ]", "[ PC ]", "[ OPTION ]"]
                  ).map((cat) => {
                    const isSelected = (editingPart.category || "").trim().toUpperCase() === cat.trim().toUpperCase();
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() =>
                          setEditingPart({ ...editingPart, category: cat })
                        }
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer flex items-center gap-1 ${
                          isSelected
                            ? "bg-cyan-500 text-slate-950 border-cyan-400 shadow-glow-cyan"
                            : "bg-slate-900 border-slate-700/80 text-slate-300 hover:text-white hover:border-slate-500"
                        }`}
                      >
                        <Layers className="h-3 w-3" />
                        <span>{cat}</span>
                      </button>
                    );
                  })}
                </div>

                <input
                  type="text"
                  value={editingPart.category || ""}
                  onChange={(e) =>
                    setEditingPart({ ...editingPart, category: e.target.value })
                  }
                  placeholder="예: [ MAIN ], [ MG ]"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white font-bold focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-slate-300 font-bold block mb-1">
                  품명 (Part Name)
                </label>
                <input
                  type="text"
                  value={editingPart.partName}
                  onChange={(e) =>
                    setEditingPart({ ...editingPart, partName: e.target.value })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-slate-300 font-bold block mb-1">
                  세부 사양 (Sub Spec)
                </label>
                <input
                  type="text"
                  value={editingPart.subSpec || ""}
                  onChange={(e) =>
                    setEditingPart({ ...editingPart, subSpec: e.target.value })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-slate-300 font-bold block mb-1">
                  규격 (Spec)
                </label>
                <input
                  type="text"
                  value={editingPart.spec}
                  onChange={(e) =>
                    setEditingPart({ ...editingPart, spec: e.target.value })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-slate-300 font-bold block mb-1">
                  시리얼 번호 (S/N)
                </label>
                <input
                  type="text"
                  value={editingPart.detectedSerial || ""}
                  onChange={(e) =>
                    setEditingPart({
                      ...editingPart,
                      detectedSerial: e.target.value,
                      isVerified: e.target.value.trim().length > 0 ? true : editingPart.isVerified,
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white font-mono focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="modal-edit-verify"
                  checked={editingPart.isVerified}
                  onChange={(e) =>
                    setEditingPart({ ...editingPart, isVerified: e.target.checked })
                  }
                  className="h-4 w-4 rounded bg-slate-950 border-slate-700 text-cyan-500 focus:ring-0 cursor-pointer"
                />
                <label htmlFor="modal-edit-verify" className="text-slate-300 font-bold cursor-pointer">
                  검증 완료 (PASS) 체크
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-semibold hover:bg-slate-700 transition-all cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleSaveEditModal}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-extrabold shadow-glow-cyan hover:brightness-110 transition-all cursor-pointer"
                >
                  저장 완료
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
