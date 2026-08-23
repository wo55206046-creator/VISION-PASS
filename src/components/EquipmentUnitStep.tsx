"use client";

import React, { useState } from "react";
import { EquipmentUnit, PartItem, ProjectMaster } from "@/types";
import { PartsTable } from "./PartsTable";
import { PresetModal } from "./PresetModal";
import { CameraOcrModal } from "./CameraOcrModal";
import { exportSemiconductorReportToExcel } from "@/lib/excel-export";
import { DEFAULT_SITES } from "@/lib/default-presets";
import { generateNextSerial, cascadeSerialFromUnit1 } from "@/lib/utils";
import {
  Layers,
  Copy,
  ArrowLeft,
  Barcode,
  CheckCircle2,
  AlertTriangle,
  Cpu,
  Sparkles,
  FileSpreadsheet,
  Building2,
  Edit2,
  Plus,
  X,
} from "lucide-react";

interface EquipmentUnitStepProps {
  project: ProjectMaster;
  onUpdate: (updater: (prev: ProjectMaster) => ProjectMaster) => void;
  onPrev: () => void;
  onBackToPjtList?: () => void;
}

// 사업장별 색상 스타일 결정 (SEC: Cyan, SKH: 옅은 주황색, 기타: 옅은 빨간색)
function getSiteBadgeStyle(site: string) {
  const s = (site || "").toUpperCase();
  if (s.includes("SEC")) {
    return {
      bg: "bg-cyan-950/80 border-cyan-700/70 text-cyan-300",
      icon: "text-cyan-400",
    };
  } else if (s.includes("SKH")) {
    return {
      bg: "bg-amber-950/70 border-amber-600/70 text-amber-300",
      icon: "text-amber-400",
    };
  } else {
    return {
      bg: "bg-rose-950/70 border-rose-600/70 text-rose-300",
      icon: "text-rose-400",
    };
  }
}

export const EquipmentUnitStep: React.FC<EquipmentUnitStepProps> = ({
  project,
  onUpdate,
  onPrev,
  onBackToPjtList,
}) => {
  const [activeUnitIndex, setActiveUnitIndex] = useState(1);
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [ocrTargetPart, setOcrTargetPart] = useState<PartItem | null>(null);
  const [isOcrModalOpen, setIsOcrModalOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingPjt, setEditingPjt] = useState<ProjectMaster | null>(null);

  // 현재 활성화된 호기
  const equipmentUnits = project?.equipmentUnits || [];
  const currentUnit =
    equipmentUnits.find((u) => u.unitIndex === activeUnitIndex) ||
    equipmentUnits[0] || {
      unitIndex: 1,
      equipmentSerial: "",
      parts: [],
    };

  // 현재 호기 부품 목록 업데이트 핸들러
  const handleUpdateCurrentParts = (newParts: PartItem[]) => {
    onUpdate((prev) => ({
      ...prev,
      equipmentUnits: (prev?.equipmentUnits || []).map((u) =>
        u.unitIndex === activeUnitIndex ? { ...u, parts: newParts } : u
      ),
    }));
  };

  // 프리셋에서 신규 부품 추가 핸들러
  const handleAddPresetParts = (newParts: PartItem[]) => {
    const existingParts = currentUnit?.parts || [];
    handleUpdateCurrentParts([...existingParts, ...newParts]);
  };

  // OCR 스캔 시작 모달 열기
  const handleOpenOcrModal = (part: PartItem) => {
    setOcrTargetPart(part);
    setIsOcrModalOpen(true);
  };

  // OCR 스캔 결과 반영
  const handleConfirmOcr = (
    partId: string,
    serial: string,
    isVerified: boolean,
    confidence?: number
  ) => {
    const updated = (currentUnit?.parts || []).map((p) => {
      if (p.id === partId) {
        return {
          ...p,
          detectedSerial: serial,
          isVerified: isVerified,
          scannedAt: new Date().toISOString(),
          confidence: confidence,
        };
      }
      return p;
    });

    handleUpdateCurrentParts(updated);
  };

  // 현재 호기 부품 템플릿을 다른 모든 호기에 일괄 복제
  const handleReplicateToAllUnits = () => {
    if (!currentUnit || currentUnit.parts.length === 0) return;

    onUpdate((prev) => {
      return {
        ...prev,
        equipmentUnits: prev.equipmentUnits.map((unit) => {
          if (unit.unitIndex === activeUnitIndex) return unit;

          // 부품명과 규격을 복사하고 고유 ID 발급, 시리얼은 리셋
          const replicatedParts: PartItem[] = currentUnit.parts.map((p) => ({
            ...p,
            id: "id-" + Math.random().toString(36).substring(2, 9),
            detectedSerial: "",
            isVerified: false,
            scannedAt: undefined,
            confidence: undefined,
          }));

          return {
            ...unit,
            parts: replicatedParts,
          };
        }),
      };
    });

    setCopyFeedback(`1호기 부품 목록(${currentUnit.parts.length}개)이 모든 호기에 일괄 적용되었습니다.`);
    setTimeout(() => setCopyFeedback(null), 4000);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Top Banner & Multi-Unit Tabs */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-cleanroom-850 to-slate-900 p-4 sm:p-5 border border-slate-800 shadow-xl space-y-3.5">
        {/* 1. 최상단 행: 좌측 [03 PJT 부품 시리얼 OCR 인식] & 우측 [Excel] 다운로드 버튼 */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-400 font-mono font-bold text-xs border border-cyan-500/30 shrink-0">
              03
            </span>
            <h2 className="text-base sm:text-lg font-bold text-white tracking-wide">
              PJT 부품 시리얼 OCR 인식
            </h2>
          </div>

          {/* 📊 우측 상단 Excel 다운로드 버튼 */}
          <button
            type="button"
            onClick={async () => {
              try {
                await exportSemiconductorReportToExcel(project);
              } catch (err) {
                console.error(err);
                alert("엑셀 파일 생성 중 오류가 발생했습니다.");
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:brightness-110 px-3.5 py-1.5 text-xs font-extrabold text-slate-950 shadow-glow-emerald transition-all shrink-0 cursor-pointer"
            title="모든 호기의 부품 시리얼 리스트를 엑셀 파일로 다운로드"
          >
            <FileSpreadsheet className="h-4 w-4 stroke-[2.5]" />
            <span>Excel</span>
          </button>
        </div>

        {/* 2. 프로젝트 정보 표시 영역 */}
        <div className="space-y-1.5 text-xs">
          {/* 라인 1: [고객사 배지] PJT: <코드> 동시 표현 */}
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`font-bold flex items-center gap-1 px-2.5 py-0.5 rounded-lg border shadow-sm ${
                getSiteBadgeStyle(project?.site || "").bg
              }`}
            >
              <Building2 className={`h-3.5 w-3.5 ${getSiteBadgeStyle(project?.site || "").icon}`} />
              <span>{project?.site || "고객사 미지정"}</span>
            </span>
            <span className="text-slate-300 font-semibold flex items-center gap-1">
              <span className="text-slate-400">PJT:</span>
              <strong className="text-cyan-300 font-mono font-extrabold text-sm">{project?.pjtCode}</strong>
            </span>
          </div>

          {/* 라인 2: 설비명 한 줄 단독 표시 */}
          <div className="flex items-center gap-1.5 text-slate-300 pt-0.5">
            <span className="text-slate-400 font-medium shrink-0">설비명:</span>
            <strong className="text-white font-bold truncate" title={project?.equipmentName}>
              {project?.equipmentName || "미지정"}
            </strong>
            <span className="text-slate-400 font-mono text-[11px] shrink-0">
              (총 {project?.quantity || 1}대)
            </span>
          </div>
        </div>

        {/* 3. 보조 액션 버튼 행: [프로젝트 정보 수정] [1호기 부품 목록 전체 복제] */}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {/* Quick Edit Project Button */}
          <button
            type="button"
            onClick={() => {
              setEditingPjt(JSON.parse(JSON.stringify(project)));
              setIsEditModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800/90 px-3 py-1.5 text-xs font-semibold text-cyan-300 border border-slate-700 hover:bg-slate-700 hover:text-white transition-all shadow-sm shrink-0 cursor-pointer"
            title="프로젝트 정보 및 Serial NO. 수정"
          >
            <Edit2 className="h-3.5 w-3.5" />
            <span>프로젝트 정보 수정</span>
          </button>

          {/* Replicate Template Button */}
          {(project?.quantity || 1) > 1 && (
            <button
              type="button"
              onClick={handleReplicateToAllUnits}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white transition-all shadow-sm shrink-0 cursor-pointer"
              title="현재 호기의 부품 리스트(부품명/규격)를 나머지 모든 호기에 일괄 복제"
            >
              <Copy className="h-3.5 w-3.5" />
              <span>1호기 부품 목록 전체 복제</span>
            </button>
          )}
        </div>

        {/* 🔢 등록된 설비 Serial NO. 및 호기 선택 탭 (단일 통합) */}
        <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800/80 flex flex-col sm:flex-row sm:items-center gap-2.5 text-xs">
          <span className="text-slate-400 font-bold flex items-center gap-1.5 shrink-0">
            <Barcode className="h-4 w-4 text-cyan-400" />
            <span>호기 선택 (Serial NO.) :</span>
          </span>
          <div className="flex items-center gap-2 font-mono overflow-x-auto no-scrollbar py-0.5 scroll-smooth -mx-1 px-1">
            {project.equipmentUnits.map((u) => {
              const isCurrent = u.unitIndex === activeUnitIndex;
              const verified = u.parts.filter((p) => p.isVerified).length;
              const total = u.parts.length;
              const isAllPass = total > 0 && verified === total;

              return (
                <button
                  key={u.unitIndex}
                  type="button"
                  onClick={() => setActiveUnitIndex(u.unitIndex)}
                  className={`px-3 py-2 sm:py-1.5 rounded-lg border text-xs font-semibold cursor-pointer flex items-center gap-2 transition-all shrink-0 ${
                    isCurrent
                      ? "bg-cyan-500 text-slate-950 font-bold border-cyan-400 shadow-glow-cyan"
                      : "bg-slate-900 border-slate-800 text-slate-300 hover:text-white hover:border-slate-700"
                  }`}
                >
                  <span className={`font-bold ${isCurrent ? "text-slate-950" : "text-slate-300"}`}>
                    {u.unitIndex}호기:
                  </span>
                  <span className={`font-bold ${isCurrent ? "text-slate-950 font-extrabold" : "text-cyan-300"}`}>
                    {u.equipmentSerial || "(미입력)"}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold shrink-0 ${
                      isCurrent
                        ? "bg-slate-950 text-cyan-300"
                        : isAllPass
                        ? "bg-emerald-950 text-emerald-300 border border-emerald-700"
                        : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {isAllPass ? "✓ 완료" : `${verified}/${total}`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Copy Feedback Alert */}
        {copyFeedback && (
          <div className="flex items-center gap-2 rounded-xl bg-cyan-950/80 p-3 text-xs text-cyan-300 border border-cyan-800 animate-fadeIn">
            <Sparkles className="h-4 w-4 text-cyan-400 shrink-0" />
            <span>{copyFeedback}</span>
          </div>
        )}
      </div>

      {/* Parts Table for Current Unit */}
      {currentUnit && (
        <div className="space-y-6">
          <PartsTable
            parts={currentUnit.parts}
            unitIndex={currentUnit.unitIndex}
            onUpdateParts={handleUpdateCurrentParts}
            onOpenOcrModal={handleOpenOcrModal}
            onOpenPresetModal={() => setIsPresetModalOpen(true)}
          />
        </div>
      )}

      {/* Navigation Step Bottom Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-slate-800">
        {onBackToPjtList && (
          <button
            type="button"
            onClick={onBackToPjtList}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-slate-800 px-5 py-2.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition-all border border-slate-700 cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>← 1. PJT List 목록</span>
          </button>
        )}

        <button
          type="button"
          onClick={async () => {
            try {
              await exportSemiconductorReportToExcel(project);
            } catch (err) {
              console.error(err);
            }
          }}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-600 px-6 py-3 text-xs font-extrabold text-slate-950 shadow-glow-cyan hover:opacity-95 transition-all cursor-pointer"
        >
          <FileSpreadsheet className="h-4 w-4 stroke-[2.5]" />
          <span>엑셀 보고서 다운로드 (.xlsx)</span>
        </button>
      </div>

      {/* PJT 양식 Modal (모델별 표준 BOM & 엑셀 업로드 & 동적 양식 관리) */}
      <PresetModal
        isOpen={isPresetModalOpen}
        onClose={() => setIsPresetModalOpen(false)}
        onAddParts={handleAddPresetParts}
        onReplaceParts={handleUpdateCurrentParts}
        currentUnitParts={currentUnit?.parts || []}
      />

      {/* In-Memory Camera OCR Modal */}
      <CameraOcrModal
        isOpen={isOcrModalOpen}
        targetPart={ocrTargetPart}
        unitIndex={activeUnitIndex}
        equipmentSerial={currentUnit?.equipmentSerial}
        onClose={() => {
          setIsOcrModalOpen(false);
          setOcrTargetPart(null);
        }}
        onConfirm={handleConfirmOcr}
      />

      {/* Quick PJT Edit Modal (프로젝트 정보 및 Serial NO. 수정) */}
      {isEditModalOpen && editingPjt && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Edit2 className="h-4 w-4 text-cyan-400" />
                <h3 className="text-base font-bold text-white">프로젝트 정보 및 Serial NO. 수정</h3>
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
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-300 font-bold block">PJT CODE *</label>
                </div>
                <input
                  type="text"
                  placeholder="예: S26-15-01"
                  value={editingPjt.pjtCode}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setEditingPjt({ ...editingPjt, pjtCode: e.target.value.toUpperCase() })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 font-mono font-bold text-cyan-300 uppercase focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-slate-300 font-bold block mb-1">
                  모델명 (인증명) *
                </label>
                <input
                  type="text"
                  value={editingPjt.equipmentName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setEditingPjt({ ...editingPjt, equipmentName: e.target.value })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 font-bold text-white focus:border-cyan-500 focus:outline-none"
                  placeholder="예: NaVi-MG200 (NaVi-MG200H-0224), WOA-683 (WOA-683-0124)"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-slate-300 font-bold block">고객사</label>
                  <span className="text-[10px] text-cyan-400">직접 입력 및 목록 선택 가능</span>
                </div>
                <input
                  type="text"
                  list="edit-modal-site-list-options-step3"
                  value={editingPjt.site}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setEditingPjt({ ...editingPjt, site: e.target.value })
                  }
                  placeholder="예: SKH 이천, SEC 평택"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                />
                <datalist id="edit-modal-site-list-options-step3">
                  {DEFAULT_SITES.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>

              {/* 호기별 Serial NO. 수정 및 호기 추가 */}
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-cyan-300 font-bold block text-[11px]">
                    호기별 설비 Serial NO. 수정 (총 {editingPjt.equipmentUnits.length}대) :
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const nextIdx = editingPjt.equipmentUnits.length + 1;
                      const baseParts = (editingPjt.equipmentUnits[0]?.parts || []).map((p) => ({
                        ...p,
                        id: "id-" + Math.random().toString(36).substring(2, 9),
                        detectedSerial: "",
                        isVerified: false,
                        scannedAt: undefined,
                        confidence: undefined,
                      }));
                      const unit1Serial = editingPjt.equipmentUnits[0]?.equipmentSerial?.trim();
                      const nextSerial = unit1Serial ? cascadeSerialFromUnit1(unit1Serial, nextIdx) : "";
                      const newUnit = {
                        unitIndex: nextIdx,
                        equipmentSerial: nextSerial,
                        parts: baseParts,
                      };
                      const updatedUnits = [...editingPjt.equipmentUnits, newUnit];
                      setEditingPjt({
                        ...editingPjt,
                        quantity: updatedUnits.length,
                        equipmentUnits: updatedUnits,
                      });
                    }}
                    className="px-2.5 py-1 bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 rounded-lg font-bold text-[11px] hover:opacity-90 shadow-sm flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="h-3 w-3 stroke-[3]" />
                    <span>호기 추가</span>
                  </button>
                </div>

                <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                  {editingPjt.equipmentUnits.map((u) => (
                    <div
                      key={u.unitIndex}
                      className="flex items-center gap-2 bg-slate-900/60 p-1.5 rounded-lg border border-slate-800/80"
                    >
                      <span className="w-16 font-mono text-slate-300 shrink-0 text-[11px] font-semibold">
                        {u.unitIndex}호기 S/N:
                      </span>
                      <input
                        type="text"
                        placeholder={`예: SOTSU-SK26-100${u.unitIndex}`}
                        value={u.equipmentSerial}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          const val = e.target.value.toUpperCase();
                          if (u.unitIndex === 1) {
                            const newUnits = editingPjt.equipmentUnits.map((unit) => ({
                              ...unit,
                              equipmentSerial: cascadeSerialFromUnit1(val, unit.unitIndex),
                            }));
                            setEditingPjt({ ...editingPjt, equipmentUnits: newUnits });
                          } else {
                            const newUnits = editingPjt.equipmentUnits.map((unit) =>
                              unit.unitIndex === u.unitIndex ? { ...unit, equipmentSerial: val } : unit
                            );
                            setEditingPjt({ ...editingPjt, equipmentUnits: newUnits });
                          }
                        }}
                        className="flex-1 bg-slate-950 border border-slate-700 rounded-lg p-1.5 font-mono text-cyan-300 uppercase text-xs focus:border-cyan-500 focus:outline-none"
                      />
                      {editingPjt.equipmentUnits.length > 1 && (
                        <button
                          type="button"
                          title="이 호기 삭제"
                          onClick={() => {
                            const filtered = editingPjt.equipmentUnits.filter(
                              (unit) => unit.unitIndex !== u.unitIndex
                            );
                            const reindexed = filtered.map((unit, idx) => ({
                              ...unit,
                              unitIndex: idx + 1,
                            }));
                            setEditingPjt({
                              ...editingPjt,
                              quantity: reindexed.length,
                              equipmentUnits: reindexed,
                            });
                          }}
                          className="p-1 text-slate-500 hover:text-red-400 rounded transition-colors cursor-pointer text-xs"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 font-bold block mb-1">설비 담당자</label>
                  <input
                    type="text"
                    placeholder="예: 홍길동"
                    value={editingPjt.inspectorName}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setEditingPjt({ ...editingPjt, inspectorName: e.target.value })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-slate-300 font-bold block mb-1">검사일자</label>
                  <input
                    type="date"
                    value={editingPjt.inspectionDate}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setEditingPjt({ ...editingPjt, inspectionDate: e.target.value })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="w-1/2 bg-slate-800 text-slate-300 py-2.5 rounded-xl text-xs hover:bg-slate-700 cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!editingPjt) return;
                  onUpdate((prev) => ({
                    ...prev,
                    pjtCode: editingPjt.pjtCode,
                    equipmentName: editingPjt.equipmentName,
                    site: editingPjt.site,
                    quantity: editingPjt.equipmentUnits.length,
                    equipmentUnits: editingPjt.equipmentUnits,
                    inspectorName: editingPjt.inspectorName,
                    inspectionDate: editingPjt.inspectionDate,
                    notes: editingPjt.notes,
                    updatedAt: new Date().toISOString(),
                  }));
                  setIsEditModalOpen(false);
                }}
                className="w-1/2 bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-bold py-2.5 rounded-xl text-xs shadow-glow-cyan hover:opacity-95 cursor-pointer"
              >
                변경사항 저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
